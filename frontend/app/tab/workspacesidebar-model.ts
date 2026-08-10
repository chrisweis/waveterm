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

class WorkspaceSidebarModel {
    private static instance: WorkspaceSidebarModel | null = null;

    compactAtom!: jotai.Atom<boolean>;
    widthAtom!: jotai.Atom<number>;

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
        this.widthAtom = jotai.atom((get) =>
            get(this.compactAtom) ? WorkspaceSidebar_CompactWidth : WorkspaceSidebar_ExpandedWidth
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
}

export { WorkspaceSidebarModel };
