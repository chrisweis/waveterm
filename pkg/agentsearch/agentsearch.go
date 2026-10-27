// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentsearch finds which folders (and which Wave workspaces/tabs) a keyword was worked on in,
// by searching Wave's own objects and AI coding-agent history on disk (currently Claude Code).
package agentsearch

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	SnippetKindSession = "session"
	SnippetKindMemory  = "memory"

	MaxSnippetsPerFolder = 5
	MaxStoredSnippets    = 40
	UpdateInterval       = 250 * time.Millisecond
	MinQueryLen          = 2
)

type searchFile struct {
	path      string
	folder    string
	global    bool
	missing   bool
	isSession bool
}

type folderAgg struct {
	result   wshrpc.AgentFolderResult
	snippets []wshrpc.AgentSnippet
}

type searchState struct {
	lock     sync.Mutex
	folders  map[string]*folderAgg
	searched atomic.Int64
}

func (s *searchState) addFileResult(f searchFile, matches int, lastTs int64, snippets []wshrpc.AgentSnippet) {
	s.lock.Lock()
	defer s.lock.Unlock()
	key := folderKey(f.folder)
	agg := s.folders[key]
	if agg == nil {
		agg = &folderAgg{result: wshrpc.AgentFolderResult{Path: f.folder, Global: f.global, Missing: f.missing}}
		s.folders[key] = agg
	}
	agg.result.Matches += matches
	if f.isSession {
		agg.result.Sessions++
	} else {
		agg.result.MemoryFiles++
	}
	if lastTs > agg.result.LastActive {
		agg.result.LastActive = lastTs
	}
	agg.snippets = append(agg.snippets, snippets...)
	if len(agg.snippets) > MaxStoredSnippets {
		sortSnippetsNewestFirst(agg.snippets)
		agg.snippets = agg.snippets[:MaxStoredSnippets]
	}
}

func (s *searchState) snapshot(wsPaths []string) []wshrpc.AgentFolderResult {
	s.lock.Lock()
	defer s.lock.Unlock()
	rtn := make([]wshrpc.AgentFolderResult, 0, len(s.folders))
	for _, agg := range s.folders {
		res := agg.result
		snips := make([]wshrpc.AgentSnippet, len(agg.snippets))
		copy(snips, agg.snippets)
		sortSnippetsNewestFirst(snips)
		if len(snips) > MaxSnippetsPerFolder {
			snips = snips[:MaxSnippetsPerFolder]
		}
		res.Snippets = snips
		res.InWorkspace = !res.Global && pathInScope(res.Path, wsPaths)
		rtn = append(rtn, res)
	}
	sort.Slice(rtn, func(i, j int) bool {
		if rtn[i].Matches != rtn[j].Matches {
			return rtn[i].Matches > rtn[j].Matches
		}
		return rtn[i].LastActive > rtn[j].LastActive
	})
	return rtn
}

func sortSnippetsNewestFirst(snips []wshrpc.AgentSnippet) {
	sort.SliceStable(snips, func(i, j int) bool { return snips[i].Ts > snips[j].Ts })
}

// Search streams AgentSearchUpdates on the returned channel until the search completes or ctx is canceled.
func Search(ctx context.Context, data wshrpc.CommandAgentSearchData) chan wshrpc.RespOrErrorUnion[wshrpc.AgentSearchUpdate] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentSearchUpdate])
	go func() {
		defer func() {
			panichandler.PanicHandler("agentsearch.Search", recover())
		}()
		defer close(rtn)
		runSearch(ctx, data, rtn)
	}()
	return rtn
}

func sendUpdate(ctx context.Context, ch chan wshrpc.RespOrErrorUnion[wshrpc.AgentSearchUpdate], update wshrpc.AgentSearchUpdate) bool {
	select {
	case ch <- wshrpc.RespOrErrorUnion[wshrpc.AgentSearchUpdate]{Response: update}:
		return true
	case <-ctx.Done():
		return false
	}
}

func runSearch(ctx context.Context, data wshrpc.CommandAgentSearchData, ch chan wshrpc.RespOrErrorUnion[wshrpc.AgentSearchUpdate]) {
	startTime := time.Now()
	query := strings.TrimSpace(data.Query)
	if len(query) < MinQueryLen {
		sendUpdate(ctx, ch, wshrpc.AgentSearchUpdate{Done: true, Error: fmt.Sprintf("enter at least %d characters", MinQueryLen)})
		return
	}
	wsPaths := getWorkspacePaths(ctx, data.WorkspaceId)
	var scopePaths []string
	if data.ScopeToWorkspace {
		scopePaths = wsPaths
	}
	waveResults := searchWave(ctx, query, data.WorkspaceId, data.ScopeToWorkspace)
	files := collectClaudeFiles(data.SearchSessions, data.SearchMemory)
	var sessionCount, memoryCount int
	var scopedFiles []searchFile
	for _, f := range files {
		if data.ScopeToWorkspace && (f.global || !pathInScope(f.folder, scopePaths)) {
			continue
		}
		if f.isSession {
			sessionCount++
		} else {
			memoryCount++
		}
		scopedFiles = append(scopedFiles, f)
	}
	state := &searchState{folders: make(map[string]*folderAgg)}
	makeUpdate := func(done bool) wshrpc.AgentSearchUpdate {
		return wshrpc.AgentSearchUpdate{
			WaveResults:   waveResults,
			Folders:       state.snapshot(wsPaths),
			ScopePaths:    scopePaths,
			FilesSearched: int(state.searched.Load()),
			FilesTotal:    len(scopedFiles),
			SessionFiles:  sessionCount,
			MemoryFiles:   memoryCount,
			ElapsedMs:     time.Since(startTime).Milliseconds(),
			Done:          done,
		}
	}
	if !sendUpdate(ctx, ch, makeUpdate(len(scopedFiles) == 0)) || len(scopedFiles) == 0 {
		return
	}
	m := makeMatcher(query)
	jobs := make(chan searchFile)
	var wg sync.WaitGroup
	numWorkers := runtime.NumCPU()
	if numWorkers > 8 {
		numWorkers = 8
	}
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				panichandler.PanicHandler("agentsearch.worker", recover())
			}()
			for f := range jobs {
				if ctx.Err() != nil {
					continue
				}
				searchOneFile(f, m, state)
				state.searched.Add(1)
			}
		}()
	}
	workersDone := make(chan struct{})
	go func() {
		defer func() {
			panichandler.PanicHandler("agentsearch.feeder", recover())
		}()
		defer close(workersDone)
		for _, f := range scopedFiles {
			select {
			case jobs <- f:
			case <-ctx.Done():
			}
			if ctx.Err() != nil {
				break
			}
		}
		close(jobs)
		wg.Wait()
	}()
	ticker := time.NewTicker(UpdateInterval)
	defer ticker.Stop()
	for {
		select {
		case <-workersDone:
			sendUpdate(ctx, ch, makeUpdate(true))
			return
		case <-ticker.C:
			if !sendUpdate(ctx, ch, makeUpdate(false)) {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func searchOneFile(f searchFile, m *matcher, state *searchState) {
	var matches int
	var lastTs int64
	var snippets []wshrpc.AgentSnippet
	var err error
	if f.isSession {
		matches, lastTs, snippets, err = searchSessionFile(f.path, m)
	} else {
		matches, lastTs, snippets, err = searchMemoryFile(f.path, m)
	}
	if err != nil || matches == 0 {
		return
	}
	state.addFileResult(f, matches, lastTs, snippets)
}

// folderKey compares paths the way the OS does, so "C:\Dev" and "/c/Dev" (git-bash style cwd) group together.
func folderKey(p string) string {
	p = normalizePath(p)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.ToLower(p)
	}
	return p
}

func normalizePath(p string) string {
	if p == "" {
		return p
	}
	if runtime.GOOS == "windows" && len(p) >= 3 && p[0] == '/' && p[2] == '/' && isAsciiLetter(p[1]) {
		p = strings.ToUpper(p[1:2]) + ":" + p[2:]
	}
	if runtime.GOOS == "windows" && len(p) == 2 && p[0] == '/' && isAsciiLetter(p[1]) {
		p = strings.ToUpper(p[1:2]) + ":\\"
	}
	return filepath.Clean(p)
}

func isAsciiLetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isUnder(child string, parent string) bool {
	if child == parent {
		return true
	}
	if !strings.HasSuffix(parent, string(filepath.Separator)) {
		parent += string(filepath.Separator)
	}
	return strings.HasPrefix(child, parent)
}

// pathInScope matches a folder against the workspace's tab paths in both directions: a session run in a
// subfolder of a tab's path, and a session run in the repo root while a tab is cd'ed into a subfolder.
// The upward direction excludes the home dir and volume roots, which would otherwise match everything.
func pathInScope(folder string, scopePaths []string) bool {
	fk := folderKey(folder)
	homeKey := folderKey(homeDir())
	for _, sp := range scopePaths {
		sk := folderKey(sp)
		if isUnder(fk, sk) {
			return true
		}
		if fk != homeKey && !isVolumeRoot(fk) && isUnder(sk, fk) {
			return true
		}
	}
	return false
}

func isVolumeRoot(p string) bool {
	return filepath.Dir(p) == p
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}
