// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package objectservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type ObjectService struct{}

const DefaultTimeout = 2 * time.Second
const ConnContextTimeout = 60 * time.Second

func parseORef(oref string) (*waveobj.ORef, error) {
	fields := strings.Split(oref, ":")
	if len(fields) != 2 {
		return nil, fmt.Errorf("invalid object reference: %q", oref)
	}
	return &waveobj.ORef{OType: fields[0], OID: fields[1]}, nil
}

func (svc *ObjectService) GetObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "get wave object by oref",
		ArgNames: []string{"oref"},
	}
}

func (svc *ObjectService) GetObject(orefStr string) (waveobj.WaveObj, error) {
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, err
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	obj, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	return obj, nil
}

func (svc *ObjectService) GetObjects_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"orefs"},
		ReturnDesc: "objects",
	}
}

func (svc *ObjectService) GetObjects(orefStrArr []string) ([]waveobj.WaveObj, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()

	var orefArr []waveobj.ORef
	for _, orefStr := range orefStrArr {
		orefObj, err := parseORef(orefStr)
		if err != nil {
			return nil, err
		}
		orefArr = append(orefArr, *orefObj)
	}
	return wstore.DBSelectORefs(ctx, orefArr)
}

func (svc *ObjectService) CreateBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames:   []string{"uiContext", "blockDef", "rtOpts"},
		ReturnDesc: "blockId",
	}
}

func (svc *ObjectService) CreateBlock(uiContext waveobj.UIContext, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts) (string, waveobj.UpdatesRtnType, error) {
	if uiContext.ActiveTabId == "" {
		return "", nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)

	blockData, err := wcore.CreateBlock(ctx, uiContext.ActiveTabId, blockDef, rtOpts)
	if err != nil {
		return "", nil, err
	}

	return blockData.OID, waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) DeleteBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "blockId"},
	}
}

func (svc *ObjectService) DeleteBlock(uiContext waveobj.UIContext, blockId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.DeleteBlock(ctx, blockId, true)
	if err != nil {
		return nil, fmt.Errorf("error deleting block: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) DockBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "move a block from the active tab into its workspace's dock on the given side (left or right)",
		ArgNames: []string{"uiContext", "blockId", "side"},
	}
}

func (svc *ObjectService) DockBlock(uiContext waveobj.UIContext, blockId string, side string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, uiContext.ActiveTabId)
	if err != nil {
		return nil, fmt.Errorf("error finding workspace: %w", err)
	}
	err = wcore.DockBlock(ctx, workspaceId, blockId, side)
	if err != nil {
		return nil, err
	}
	return broadcastUpdates(ctx), nil
}

func (svc *ObjectService) CreateDockedBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:       "create a block directly in the active workspace's dock on the given side (left or right)",
		ArgNames:   []string{"uiContext", "blockDef", "rtOpts", "side"},
		ReturnDesc: "blockId",
	}
}

func (svc *ObjectService) CreateDockedBlock(uiContext waveobj.UIContext, blockDef *waveobj.BlockDef, rtOpts *waveobj.RuntimeOpts, side string) (string, waveobj.UpdatesRtnType, error) {
	if uiContext.ActiveTabId == "" {
		return "", nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, uiContext.ActiveTabId)
	if err != nil {
		return "", nil, fmt.Errorf("error finding workspace: %w", err)
	}
	blockData, err := wcore.CreateBlock(ctx, uiContext.ActiveTabId, blockDef, rtOpts)
	if err != nil {
		return "", nil, err
	}
	err = wcore.DockBlock(ctx, workspaceId, blockData.OID, side)
	if err != nil {
		wcore.DeleteBlock(ctx, blockData.OID, false)
		return "", nil, err
	}
	return blockData.OID, broadcastUpdates(ctx), nil
}

func (svc *ObjectService) UndockBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "move a docked block into the active tab (the caller adds it to the layout)",
		ArgNames: []string{"uiContext", "blockId"},
	}
}

func (svc *ObjectService) UndockBlock(uiContext waveobj.UIContext, blockId string) (waveobj.UpdatesRtnType, error) {
	if uiContext.ActiveTabId == "" {
		return nil, fmt.Errorf("no active tab")
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.UndockBlock(ctx, uiContext.ActiveTabId, blockId)
	if err != nil {
		return nil, err
	}
	return broadcastUpdates(ctx), nil
}

func (svc *ObjectService) DeleteDockedBlock_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "blockId"},
	}
}

func (svc *ObjectService) DeleteDockedBlock(uiContext waveobj.UIContext, blockId string) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	err := wcore.DeleteBlock(ctx, blockId, false)
	if err != nil {
		return nil, fmt.Errorf("error deleting block: %w", err)
	}
	return broadcastUpdates(ctx), nil
}

// The dock is drawn by every tab's renderer in the workspace, not just the caller's, so workspace changes are
// pushed to all of them instead of only being returned to the caller.
func broadcastUpdates(ctx context.Context) waveobj.UpdatesRtnType {
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	go func() {
		defer func() {
			panichandler.PanicHandler("ObjectService:broadcastUpdates", recover())
		}()
		wps.Broker.SendUpdateEvents(updates)
	}()
	return updates
}

func (svc *ObjectService) UpdateObjectMeta_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "oref", "meta"},
	}
}

func (svc *ObjectService) UpdateObjectMeta(uiContext waveobj.UIContext, orefStr string, meta waveobj.MetaMapType) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	oref, err := parseORef(orefStr)
	if err != nil {
		return nil, fmt.Errorf("error parsing object reference: %w", err)
	}
	err = wstore.UpdateObjectMeta(ctx, *oref, meta, false)
	if err != nil {
		return nil, fmt.Errorf("error updating %q meta: %w", orefStr, err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func (svc *ObjectService) UpdateObject_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		ArgNames: []string{"uiContext", "waveObj", "returnUpdates"},
	}
}

func (svc *ObjectService) UpdateObject(uiContext waveobj.UIContext, waveObj waveobj.WaveObj, returnUpdates bool) (waveobj.UpdatesRtnType, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	if waveObj == nil {
		return nil, fmt.Errorf("update wavobj is nil")
	}
	oref := waveobj.ORefFromWaveObj(waveObj)
	found, err := wstore.DBExistsORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if !found {
		return nil, fmt.Errorf("object not found: %s", oref)
	}
	err = wstore.DBUpdate(ctx, waveObj)
	if err != nil {
		return nil, fmt.Errorf("error updating object: %w", err)
	}
	if (waveObj.GetOType() == waveobj.OType_Workspace) && (waveObj.(*waveobj.Workspace).Name != "") {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_WorkspaceUpdate})
	}
	if returnUpdates {
		return waveobj.ContextGetUpdatesRtn(ctx), nil
	}
	return nil, nil
}
