// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Docked blocks are parented to the workspace rather than a tab, so every tab in the workspace shows the same
// instance and closing the tab it was docked from doesn't take it along. The order lives in the workspace's
// dock:blockids meta.

const (
	DockSideLeft  = "left"
	DockSideRight = "right"
)

func DockBlock(ctx context.Context, workspaceId string, blockId string, side string) error {
	if side != DockSideLeft && side != DockSideRight {
		return fmt.Errorf("invalid dock side %q", side)
	}
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		block, err := wstore.DBMustGet[*waveobj.Block](tx.Context(), blockId)
		if err != nil {
			return fmt.Errorf("error getting block: %w", err)
		}
		parentORef := waveobj.ParseORefNoErr(block.ParentORef)
		if parentORef == nil || parentORef.OType != waveobj.OType_Tab {
			return fmt.Errorf("only blocks in a tab can be docked")
		}
		tab, err := wstore.DBMustGet[*waveobj.Tab](tx.Context(), parentORef.OID)
		if err != nil {
			return fmt.Errorf("error getting tab: %w", err)
		}
		ws, err := wstore.DBMustGet[*waveobj.Workspace](tx.Context(), workspaceId)
		if err != nil {
			return fmt.Errorf("error getting workspace: %w", err)
		}
		tab.BlockIds = utilfn.RemoveElemFromSlice(tab.BlockIds, blockId)
		wstore.DBUpdate(tx.Context(), tab)
		block.ParentORef = waveobj.MakeORef(waveobj.OType_Workspace, workspaceId).String()
		if block.Meta == nil {
			block.Meta = make(waveobj.MetaMapType)
		}
		block.Meta[waveobj.MetaKey_DockSide] = side
		wstore.DBUpdate(tx.Context(), block)
		dockIds := utilfn.RemoveElemFromSlice(ws.Meta.GetStringArray(waveobj.MetaKey_DockBlockIds), blockId)
		setDockBlockIds(ws, append(dockIds, blockId))
		wstore.DBUpdate(tx.Context(), ws)
		return nil
	})
}

func UndockBlock(ctx context.Context, tabId string, blockId string) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		block, err := wstore.DBMustGet[*waveobj.Block](tx.Context(), blockId)
		if err != nil {
			return fmt.Errorf("error getting block: %w", err)
		}
		parentORef := waveobj.ParseORefNoErr(block.ParentORef)
		if parentORef == nil || parentORef.OType != waveobj.OType_Workspace {
			return fmt.Errorf("block is not docked")
		}
		tab, err := wstore.DBMustGet[*waveobj.Tab](tx.Context(), tabId)
		if err != nil {
			return fmt.Errorf("error getting tab: %w", err)
		}
		ws, err := wstore.DBMustGet[*waveobj.Workspace](tx.Context(), parentORef.OID)
		if err != nil {
			return fmt.Errorf("error getting workspace: %w", err)
		}
		setDockBlockIds(ws, utilfn.RemoveElemFromSlice(ws.Meta.GetStringArray(waveobj.MetaKey_DockBlockIds), blockId))
		wstore.DBUpdate(tx.Context(), ws)
		block.ParentORef = waveobj.MakeORef(waveobj.OType_Tab, tabId).String()
		wstore.DBUpdate(tx.Context(), block)
		tab.BlockIds = append(tab.BlockIds, blockId)
		wstore.DBUpdate(tx.Context(), tab)
		return nil
	})
}

func setDockBlockIds(ws *waveobj.Workspace, ids []string) {
	if ws.Meta == nil {
		ws.Meta = make(waveobj.MetaMapType)
	}
	if len(ids) == 0 {
		delete(ws.Meta, waveobj.MetaKey_DockBlockIds)
		return
	}
	ws.Meta[waveobj.MetaKey_DockBlockIds] = ids
}
