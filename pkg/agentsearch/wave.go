// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsearch

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	WaveResultKindWorkspace = "workspace"
	WaveResultKindTab       = "tab"
)

type tabInfo struct {
	tab   *waveobj.Tab
	paths []string
}

type workspaceInfo struct {
	ws   *waveobj.Workspace
	tabs []tabInfo
}

// isListedWorkspace mirrors wcore.ListWorkspaces: workspaces without a name/icon/color are unsaved, so they only
// show up in search when they are the caller's own workspace.
func isListedWorkspace(ws *waveobj.Workspace) bool {
	return ws.Name != "" && ws.Icon != "" && ws.Color != ""
}

func loadWorkspaces(ctx context.Context, currentWsId string) []workspaceInfo {
	workspaces, err := wstore.DBGetAllObjsByType[*waveobj.Workspace](ctx, waveobj.OType_Workspace)
	if err != nil {
		return nil
	}
	var rtn []workspaceInfo
	for _, ws := range workspaces {
		if ws.OID != currentWsId && !isListedWorkspace(ws) {
			continue
		}
		rtn = append(rtn, loadWorkspaceInfo(ctx, ws))
	}
	return rtn
}

func loadWorkspaceInfo(ctx context.Context, ws *waveobj.Workspace) workspaceInfo {
	info := workspaceInfo{ws: ws}
	tabs, _ := wstore.DBSelectMap[*waveobj.Tab](ctx, ws.TabIds)
	for _, tabId := range ws.TabIds {
		tab := tabs[tabId]
		if tab == nil {
			continue
		}
		info.tabs = append(info.tabs, tabInfo{tab: tab, paths: getTabPaths(ctx, tab)})
	}
	return info
}

// getTabPaths returns the local folders a tab is "in": each terminal's cwd and each Files view's directory.
// Remote connections are skipped since their paths can't match local agent history.
func getTabPaths(ctx context.Context, tab *waveobj.Tab) []string {
	blocks, _ := wstore.DBSelectMap[*waveobj.Block](ctx, tab.BlockIds)
	seen := make(map[string]bool)
	var rtn []string
	for _, blockId := range tab.BlockIds {
		block := blocks[blockId]
		if block == nil {
			continue
		}
		conn := block.Meta.GetString(waveobj.MetaKey_Connection, "")
		if conn != "" && conn != wshrpc.LocalConnName {
			continue
		}
		var p string
		switch block.Meta.GetString(waveobj.MetaKey_View, "") {
		case "term":
			p = block.Meta.GetString(waveobj.MetaKey_CmdCwd, "")
		case "preview":
			p = block.Meta.GetString(waveobj.MetaKey_File, "")
		}
		p = resolveLocalDir(p)
		if p == "" || seen[folderKey(p)] {
			continue
		}
		seen[folderKey(p)] = true
		rtn = append(rtn, p)
	}
	return rtn
}

func resolveLocalDir(p string) string {
	if p == "" {
		return ""
	}
	p = normalizePath(wavebase.ExpandHomeDirSafe(p))
	if !filepath.IsAbs(p) {
		return ""
	}
	if info, err := os.Stat(p); err == nil && !info.IsDir() {
		p = filepath.Dir(p)
	}
	return p
}

func getWorkspacePaths(ctx context.Context, workspaceId string) []string {
	if workspaceId == "" {
		return nil
	}
	ws, err := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
	if err != nil || ws == nil {
		return nil
	}
	info := loadWorkspaceInfo(ctx, ws)
	seen := make(map[string]bool)
	var rtn []string
	for _, t := range info.tabs {
		for _, p := range t.paths {
			if seen[folderKey(p)] {
				continue
			}
			seen[folderKey(p)] = true
			rtn = append(rtn, p)
		}
	}
	sort.Strings(rtn)
	return rtn
}

// searchWave matches the query against workspace names, tab names, and the folders open in each tab.
// Workspaces come first, then tabs; the caller's current workspace sorts ahead of the others.
func searchWave(ctx context.Context, query string, currentWsId string, scopeToWorkspace bool) []wshrpc.WaveSearchResult {
	lq := strings.ToLower(query)
	var wsResults, tabResults []wshrpc.WaveSearchResult
	for _, wi := range loadWorkspaces(ctx, currentWsId) {
		if scopeToWorkspace && wi.ws.OID != currentWsId {
			continue
		}
		isCurrent := wi.ws.OID == currentWsId
		if wi.ws.Name != "" && strings.Contains(strings.ToLower(wi.ws.Name), lq) {
			wsResults = append(wsResults, wshrpc.WaveSearchResult{
				Kind:          WaveResultKindWorkspace,
				WorkspaceId:   wi.ws.OID,
				WorkspaceName: wi.ws.Name,
				NumTabs:       len(wi.tabs),
				Current:       isCurrent,
			})
		}
		for _, ti := range wi.tabs {
			nameMatch := strings.Contains(strings.ToLower(ti.tab.Name), lq)
			matchedPath := ""
			for _, p := range ti.paths {
				if strings.Contains(strings.ToLower(p), lq) {
					matchedPath = p
					break
				}
			}
			if !nameMatch && matchedPath == "" {
				continue
			}
			if matchedPath == "" && len(ti.paths) > 0 {
				matchedPath = ti.paths[0]
			}
			tabResults = append(tabResults, wshrpc.WaveSearchResult{
				Kind:          WaveResultKindTab,
				WorkspaceId:   wi.ws.OID,
				WorkspaceName: wi.ws.Name,
				TabId:         ti.tab.OID,
				TabName:       ti.tab.Name,
				Path:          matchedPath,
				Current:       isCurrent,
			})
		}
	}
	byCurrentThenName := func(rs []wshrpc.WaveSearchResult) {
		sort.SliceStable(rs, func(i, j int) bool {
			if rs[i].Current != rs[j].Current {
				return rs[i].Current
			}
			return strings.ToLower(rs[i].WorkspaceName) < strings.ToLower(rs[j].WorkspaceName)
		})
	}
	byCurrentThenName(wsResults)
	byCurrentThenName(tabResults)
	return append(wsResults, tabResults...)
}
