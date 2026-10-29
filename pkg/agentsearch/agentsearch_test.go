// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsearch

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func makeFakeClaude(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	cwd := filepath.Join(root, "work", "hockey")
	cwdJson := strings.ReplaceAll(cwd, `\`, `\\`)
	session := strings.Join([]string{
		`{"type":"mode","sessionId":"s1"}`,
		`{"type":"user","cwd":"` + cwdJson + `","timestamp":"2026-10-24T10:00:00Z","message":{"role":"user","content":"pull the Roster from the league site"}}`,
		`{"type":"assistant","cwd":"` + cwdJson + `","timestamp":"2026-10-24T10:01:00Z","message":{"role":"assistant","content":[{"type":"text","text":"Updated roster.csv and the roster page."},{"type":"tool_use","name":"Read","input":{"file":"roster.csv"}}]}}`,
		`{"type":"user","cwd":"` + cwdJson + `","timestamp":"2026-10-24T10:02:00Z","message":{"role":"user","content":[{"type":"tool_result","content":"roster roster roster"}]}}`,
	}, "\n") + "\n"
	writeFile(t, filepath.Join(root, "projects", "enc-hockey", "s1.jsonl"), session)
	writeFile(t, filepath.Join(root, "projects", "enc-hockey", "memory", "notes.md"), "roster.csv is the source of truth\n")
	writeFile(t, filepath.Join(root, "memory", "global.md"), "Prefers roster views sorted by number\n")
	writeFile(t, filepath.Join(root, "projects", "enc-other", "s2.jsonl"), `{"type":"user","cwd":"/elsewhere","message":{"role":"user","content":"nothing here"}}`+"\n")
	return root, cwd
}

func runToDone(t *testing.T, data wshrpc.CommandAgentSearchData) wshrpc.AgentSearchUpdate {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var last wshrpc.AgentSearchUpdate
	for resp := range Search(ctx, data) {
		if resp.Error != nil {
			t.Fatal(resp.Error)
		}
		last = resp.Response
	}
	if !last.Done {
		t.Fatalf("search did not finish: %+v", last)
	}
	return last
}

func TestSearchClaude(t *testing.T) {
	root, cwd := makeFakeClaude(t)
	t.Setenv("CLAUDE_CONFIG_DIR", root)
	res := runToDone(t, wshrpc.CommandAgentSearchData{Query: "ROSTER", SearchSessions: true, SearchMemory: true})
	if len(res.Folders) != 2 {
		t.Fatalf("expected 2 folders (project + global), got %+v", res.Folders)
	}
	proj := res.Folders[0]
	if folderKey(proj.Path) != folderKey(cwd) {
		t.Fatalf("expected folder %q, got %q", cwd, proj.Path)
	}
	// 1 user text + 2 assistant text + 1 memory; tool_use input and tool_result are ignored
	if proj.Matches != 4 || proj.Sessions != 1 || proj.MemoryFiles != 1 {
		t.Fatalf("unexpected counts: %+v", proj)
	}
	if !res.Folders[1].Global {
		t.Fatalf("expected global memory folder second: %+v", res.Folders[1])
	}
	memOnly := runToDone(t, wshrpc.CommandAgentSearchData{Query: "roster", SearchMemory: true})
	if memOnly.SessionFiles != 0 || len(memOnly.Folders) != 2 {
		t.Fatalf("memory-only search: %+v", memOnly)
	}
}

func TestSearchWindowsPathQuery(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows path escaping")
	}
	root := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", root)
	writeFile(t, filepath.Join(root, "projects", "p", "s.jsonl"),
		`{"type":"user","cwd":"C:\\Dev\\x","message":{"role":"user","content":"look in C:\\Dev\\Dev-Sandbox please"}}`+"\n")
	res := runToDone(t, wshrpc.CommandAgentSearchData{Query: `c:\dev\dev-sandbox`, SearchSessions: true})
	if len(res.Folders) != 1 || res.Folders[0].Matches != 1 {
		t.Fatalf("expected the escaped path to match: %+v", res.Folders)
	}
}

func TestPathInScope(t *testing.T) {
	home := homeDir()
	repo := filepath.Join(home, "repo")
	cases := []struct {
		folder string
		scope  string
		want   bool
	}{
		{repo, repo, true},
		{filepath.Join(repo, "sub"), repo, true},
		{repo, filepath.Join(repo, "sub"), true},
		{filepath.Join(home, "repo2"), repo, false},
		{home, repo, false},
	}
	for _, c := range cases {
		if got := pathInScope(c.folder, []string{c.scope}); got != c.want {
			t.Errorf("pathInScope(%q, %q) = %v, want %v", c.folder, c.scope, got, c.want)
		}
	}
	if runtime.GOOS == "windows" && folderKey("/c/Dev/x") != folderKey(`C:\dev\X`) {
		t.Errorf("git-bash and windows paths should share a key")
	}
}

func TestSnippet(t *testing.T) {
	text := strings.Repeat("a ", 100) + "Needle\n\n  here" + strings.Repeat(" b", 100)
	n, snip := countAndSnippet(text, "needle")
	if n != 1 || !strings.HasPrefix(snip, "…") || !strings.HasSuffix(snip, "…") || !strings.Contains(snip, "Needle here") {
		t.Fatalf("bad snippet %d %q", n, snip)
	}
}

func TestRealDataTiming(t *testing.T) {
	q := os.Getenv("AGENTSEARCH_REAL_QUERY")
	if q == "" {
		t.Skip("set AGENTSEARCH_REAL_QUERY to time a search over the real ~/.claude")
	}
	res := runToDone(t, wshrpc.CommandAgentSearchData{Query: q, SearchSessions: true, SearchMemory: true})
	t.Logf("%d files (%d sessions, %d memory) in %dms, %d folders", res.FilesTotal, res.SessionFiles, res.MemoryFiles, res.ElapsedMs, len(res.Folders))
	for i, f := range res.Folders {
		if i >= 5 {
			break
		}
		t.Logf("  %s  matches=%d sessions=%d mem=%d", f.Path, f.Matches, f.Sessions, f.MemoryFiles)
	}
}

func TestWalkEncoded(t *testing.T) {
	root := t.TempDir()
	want := filepath.Join(root, "Dev-Sandbox", "claude.sandbox", "hockey-analysis")
	if err := os.MkdirAll(want, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "Dev", "Sandbox"), 0755); err != nil {
		t.Fatal(err)
	}
	rootEnc := encodeProjectName(root)
	target := encodeProjectName(want)
	if got := walkEncoded(root, rootEnc, target, 0); got != want {
		t.Fatalf("walkEncoded = %q, want %q", got, want)
	}
}

func TestTabsForFolder(t *testing.T) {
	home := homeDir()
	repo := filepath.Join(home, "repo")
	tabs := []tabRef{
		{res: wshrpc.WaveSearchResult{TabId: "other"}, paths: []string{filepath.Join(home, "elsewhere")}},
		{res: wshrpc.WaveSearchResult{TabId: "sub"}, paths: []string{home, filepath.Join(repo, "sub")}},
	}
	got := tabsForFolder(repo, tabs)
	if len(got) != 1 || got[0].TabId != "sub" || got[0].Path != filepath.Join(repo, "sub") {
		t.Fatalf("tabsForFolder = %+v", got)
	}
}
