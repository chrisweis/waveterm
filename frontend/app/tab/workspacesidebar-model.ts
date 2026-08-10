// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getOrefMetaKeyAtom } from "@/store/global";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";

export const WorkspaceSidebar_CompactWidth = 48;
export const WorkspaceSidebar_ExpandedWidth = 200;
export const WorkspaceSidebar_MinExpandedWidth = 140;
export const WorkspaceSidebar_MaxExpandedWidth = 400;

export function clampSidebarWidth(w: number): number {
    return Math.max(WorkspaceSidebar_MinExpandedWidth, Math.min(w, WorkspaceSidebar_MaxExpandedWidth));
}

class WorkspaceSidebarModel {
    private static instance: WorkspaceSidebarModel | null = null;

    compactAtom!: jotai.Atom<boolean>;
    widthAtom!: jotai.Atom<number>;
    // Live width during a drag. Also survives the drag as this session's value, so releasing the
    // mouse doesn't flash back to the old width while the meta write round-trips.
    localWidthAtom!: jotai.PrimitiveAtom<number>;
    expandedWidthAtom!: jotai.Atom<number>;

    private constructor() {
        // Sidebar mode is app-wide rather than per-workspace: switching workspaces from the sidebar
        // must not change the sidebar itself out from under the click.
        this.compactAtom = jotai.atom((get) => {
            const clientId = ClientModel.getInstance().clientId;
            if (clientId == null) {
                return false;
            }
            return get(getOrefMetaKeyAtom(WOS.makeORef("client", clientId), "layout:workspacesidebarcompact")) ?? false;
        });
        this.localWidthAtom = jotai.atom(null) as jotai.PrimitiveAtom<number>;
        this.expandedWidthAtom = jotai.atom((get) => {
            const local = get(this.localWidthAtom);
            if (local != null) {
                return clampSidebarWidth(local);
            }
            const clientId = ClientModel.getInstance().clientId;
            if (clientId == null) {
                return WorkspaceSidebar_ExpandedWidth;
            }
            const saved = get(getOrefMetaKeyAtom(WOS.makeORef("client", clientId), "layout:workspacesidebarwidth"));
            if (saved == null || saved <= 0) {
                return WorkspaceSidebar_ExpandedWidth;
            }
            return clampSidebarWidth(saved);
        });
        this.widthAtom = jotai.atom((get) =>
            get(this.compactAtom) ? WorkspaceSidebar_CompactWidth : get(this.expandedWidthAtom)
        );
    }

    static getInstance(): WorkspaceSidebarModel {
        if (!WorkspaceSidebarModel.instance) {
            WorkspaceSidebarModel.instance = new WorkspaceSidebarModel();
        }
        return WorkspaceSidebarModel.instance;
    }

    static resetInstance(): void {
        WorkspaceSidebarModel.instance = null;
    }

    setCompact(compact: boolean): void {
        const clientId = ClientModel.getInstance().clientId;
        if (clientId == null) {
            return;
        }
        fireAndForget(() =>
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("client", clientId),
                meta: { "layout:workspacesidebarcompact": compact },
            })
        );
    }

    toggleCompact(): void {
        this.setCompact(!globalStore.get(this.compactAtom));
    }

    setDragWidth(width: number): void {
        globalStore.set(this.localWidthAtom, clampSidebarWidth(width));
    }

    persistWidth(): void {
        const clientId = ClientModel.getInstance().clientId;
        if (clientId == null) {
            return;
        }
        const width = globalStore.get(this.expandedWidthAtom);
        fireAndForget(() =>
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("client", clientId),
                meta: { "layout:workspacesidebarwidth": width },
            })
        );
    }
}

export { WorkspaceSidebarModel };
