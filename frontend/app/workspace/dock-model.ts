// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { blockViewToIcon, blockViewToName } from "@/app/block/blockutil";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { ObjectService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    getLayoutModelForStaticTab,
    LayoutTreeActionType,
    LayoutTreeInsertNodeAction,
    newLayoutNode,
} from "@/layout/index";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";

export const DockDefaultWidth = 560;
export const DockMinWidth = 340;
// keeps a strip of the tab visible beside the panel, so there is always something to click to dismiss it
export const DockMinVisibleTab = 120;

export type DockSide = "left" | "right";
export type DockEntryInfo = { icon: string; label: string; color?: string };

function getDockedBlock(get: jotai.Getter, blockId: string): Block {
    return get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
}

export function getBlockDockSide(block: Block): DockSide {
    return block?.meta?.["dock:side"] == "left" ? "left" : "right";
}

export class DockModel {
    private static instance: DockModel = null;

    // one panel can be open per side
    openIdsAtom = jotai.atom<Record<DockSide, string>>({ left: null, right: null }) as jotai.PrimitiveAtom<
        Record<DockSide, string>
    >;
    // Panels stay mounted after their first open, so reopening is instant and keeps scroll, input, and terminal state.
    mountedIdsAtom = jotai.atom<string[]>([]) as jotai.PrimitiveAtom<string[]>;
    dragWidthAtom = jotai.atom<{ blockId: string; width: number }>(null) as jotai.PrimitiveAtom<{
        blockId: string;
        width: number;
    }>;

    dockIdsAtom: jotai.Atom<string[]>;
    pinnedAtom: jotai.Atom<boolean>;
    sideIdsAtoms: Record<DockSide, jotai.Atom<string[]>>;

    private constructor() {
        this.dockIdsAtom = jotai.atom((get) => {
            const ids = get(atoms.workspace)?.meta?.["dock:blockids"];
            return Array.isArray(ids) ? ids : [];
        });
        this.pinnedAtom = jotai.atom((get) => !!get(atoms.workspace)?.meta?.["dock:pinned"]);
        const makeSideAtom = (side: DockSide) =>
            jotai.atom((get) =>
                get(this.dockIdsAtom).filter((id) => getBlockDockSide(getDockedBlock(get, id)) == side)
            );
        this.sideIdsAtoms = { left: makeSideAtom("left"), right: makeSideAtom("right") };
    }

    static getInstance(): DockModel {
        if (DockModel.instance == null) {
            DockModel.instance = new DockModel();
        }
        return DockModel.instance;
    }

    isDocked(blockId: string): boolean {
        return globalStore.get(this.dockIdsAtom).includes(blockId);
    }

    sideOf(blockId: string): DockSide {
        return getBlockDockSide(globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId))));
    }

    isOpen(blockId: string): boolean {
        return globalStore.get(this.openIdsAtom)[this.sideOf(blockId)] == blockId;
    }

    // side is passed when the block's dock:side meta is still in flight, so the panel opens where it is headed
    open(blockId: string, side?: DockSide) {
        const mounted = globalStore.get(this.mountedIdsAtom);
        if (!mounted.includes(blockId)) {
            globalStore.set(this.mountedIdsAtom, [...mounted, blockId]);
        }
        globalStore.set(this.openIdsAtom, {
            ...globalStore.get(this.openIdsAtom),
            [side ?? this.sideOf(blockId)]: blockId,
        });
    }

    toggle(blockId: string) {
        if (this.isOpen(blockId)) {
            this.collapse(this.sideOf(blockId));
            return;
        }
        this.open(blockId);
    }

    collapse(side?: DockSide) {
        if (side == null) {
            globalStore.set(this.openIdsAtom, { left: null, right: null });
            return;
        }
        globalStore.set(this.openIdsAtom, { ...globalStore.get(this.openIdsAtom), [side]: null });
    }

    // Actions taken from inside a docked panel (opening a terminal, switching tabs) land in the tab behind it, so
    // the panel gets out of the way unless the user pinned it open.
    collapseIfUnpinned() {
        if (globalStore.get(this.pinnedAtom)) {
            return;
        }
        this.collapse();
    }

    setPinned(pinned: boolean) {
        this.setMeta(this.workspaceORef(), { "dock:pinned": pinned || null });
    }

    saveWidth(blockId: string, width: number) {
        this.setMeta(WOS.makeORef("block", blockId), { "dock:width": Math.round(width) });
    }

    moveToSide(blockId: string, side: DockSide) {
        const wasOpen = this.isOpen(blockId);
        if (wasOpen) {
            this.collapse(this.sideOf(blockId));
        }
        fireAndForget(async () => {
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", blockId),
                meta: { "dock:side": side },
            });
            if (wasOpen) {
                this.open(blockId, side);
            }
        });
    }

    dockBlock(blockId: string, side: DockSide) {
        fireAndForget(async () => {
            await ObjectService.DockBlock(blockId, side);
            getLayoutModelForStaticTab().detachBlock(blockId);
            this.open(blockId);
        });
    }

    createDockedBlock(blockDef: BlockDef, side: DockSide) {
        fireAndForget(async () => {
            const blockId = await ObjectService.CreateDockedBlock(blockDef, { termsize: { rows: 25, cols: 80 } }, side);
            this.open(blockId);
        });
    }

    undockBlock(blockId: string) {
        this.forget(blockId);
        fireAndForget(async () => {
            await ObjectService.UndockBlock(blockId);
            const insertAction: LayoutTreeInsertNodeAction = {
                type: LayoutTreeActionType.InsertNode,
                node: newLayoutNode(undefined, undefined, undefined, { blockId }),
                magnified: false,
                focused: true,
            };
            getLayoutModelForStaticTab().treeReducer(insertAction);
        });
    }

    closeBlock(blockId: string) {
        this.forget(blockId);
        fireAndForget(() => ObjectService.DeleteDockedBlock(blockId));
    }

    private forget(blockId: string) {
        const openIds = globalStore.get(this.openIdsAtom);
        if (openIds.left == blockId || openIds.right == blockId) {
            globalStore.set(this.openIdsAtom, {
                left: openIds.left == blockId ? null : openIds.left,
                right: openIds.right == blockId ? null : openIds.right,
            });
        }
        globalStore.set(
            this.mountedIdsAtom,
            globalStore.get(this.mountedIdsAtom).filter((id) => id != blockId)
        );
    }

    private workspaceORef(): string {
        const wsId = globalStore.get(atoms.workspaceId);
        return wsId ? WOS.makeORef("workspace", wsId) : null;
    }

    private setMeta(oref: string, meta: MetaType) {
        if (!oref) {
            return;
        }
        fireAndForget(() => RpcApi.SetMetaCommand(TabRpcClient, { oref, meta }));
    }
}

export function getDockEntryInfo(block: Block, widgets: WidgetConfigType[]): DockEntryInfo {
    const meta = block?.meta ?? {};
    const view = meta.view ?? "";
    const widget = widgets.find(
        (w) => w.blockdef?.meta?.view == view && w.blockdef?.meta?.controller == meta.controller
    );
    const icon = meta["frame:icon"] || widget?.icon || blockViewToIcon(view);
    const label = meta["frame:title"] || widget?.label || blockViewToName(view);
    return { icon, label, color: widget?.color };
}
