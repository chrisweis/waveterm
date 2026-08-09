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

export const WorkspaceRail_CompactWidth = 48;
export const WorkspaceRail_ExpandedWidth = 200;

class WorkspaceRailModel {
    private static instance: WorkspaceRailModel | null = null;

    compactAtom!: jotai.Atom<boolean>;
    widthAtom!: jotai.Atom<number>;

    private constructor() {
        // Rail mode is app-wide rather than per-workspace: switching workspaces from the rail
        // must not change the rail itself out from under the click.
        this.compactAtom = jotai.atom((get) => {
            const clientId = ClientModel.getInstance().clientId;
            if (clientId == null) {
                return false;
            }
            return get(getOrefMetaKeyAtom(WOS.makeORef("client", clientId), "layout:workspacerailcompact")) ?? false;
        });
        this.widthAtom = jotai.atom((get) =>
            get(this.compactAtom) ? WorkspaceRail_CompactWidth : WorkspaceRail_ExpandedWidth
        );
    }

    static getInstance(): WorkspaceRailModel {
        if (!WorkspaceRailModel.instance) {
            WorkspaceRailModel.instance = new WorkspaceRailModel();
        }
        return WorkspaceRailModel.instance;
    }

    static resetInstance(): void {
        WorkspaceRailModel.instance = null;
    }

    setCompact(compact: boolean): void {
        const clientId = ClientModel.getInstance().clientId;
        if (clientId == null) {
            return;
        }
        fireAndForget(() =>
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("client", clientId),
                meta: { "layout:workspacerailcompact": compact },
            })
        );
    }

    toggleCompact(): void {
        this.setCompact(!globalStore.get(this.compactAtom));
    }
}

export { WorkspaceRailModel };
