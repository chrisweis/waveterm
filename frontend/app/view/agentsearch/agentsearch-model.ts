// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getApi, globalStore } from "@/app/store/global";
import { WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { AgentSearchView } from "./agentsearch";

export type SearchRow = { kind: "wave"; wave: WaveSearchResult } | { kind: "folder"; folder: AgentFolderResult };

export function rowKey(row: SearchRow): string {
    if (row.kind == "wave") {
        return `wave:${row.wave.kind}:${row.wave.workspaceid}:${row.wave.tabid ?? ""}`;
    }
    return `folder:${row.folder.path}`;
}

export class AgentSearchViewModel implements ViewModel {
    viewType = "agentsearch";
    blockId: string;

    viewIcon = jotai.atom<string>("magnifying-glass");
    viewName = jotai.atom<string>("Search");
    viewText = jotai.atom<string>("Wave · Claude sessions · memory");
    noPadding = jotai.atom<boolean>(true);

    queryAtom = jotai.atom<string>("") as jotai.PrimitiveAtom<string>;
    submittedQueryAtom = jotai.atom<string>("") as jotai.PrimitiveAtom<string>;
    scopeToWorkspaceAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
    searchSessionsAtom = jotai.atom<boolean>(true) as jotai.PrimitiveAtom<boolean>;
    searchMemoryAtom = jotai.atom<boolean>(true) as jotai.PrimitiveAtom<boolean>;
    resultAtom = jotai.atom<AgentSearchUpdate>(null) as jotai.PrimitiveAtom<AgentSearchUpdate>;
    searchingAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
    errorAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
    selectedKeyAtom = jotai.atom<string>(null) as jotai.PrimitiveAtom<string>;
    expandedAtom = jotai.atom<Set<string>>(new Set<string>()) as jotai.PrimitiveAtom<Set<string>>;

    rowsAtom: jotai.Atom<SearchRow[]>;

    inputRef: React.RefObject<HTMLInputElement> = { current: null };
    searchEpoch = 0;
    disposed = false;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.rowsAtom = jotai.atom((get) => {
            const res = get(this.resultAtom);
            if (res == null) {
                return [];
            }
            const rows: SearchRow[] = [];
            for (const wave of res.waveresults ?? []) {
                rows.push({ kind: "wave", wave });
            }
            for (const folder of res.folders ?? []) {
                rows.push({ kind: "folder", folder });
            }
            return rows;
        });
    }

    get viewComponent(): ViewComponent {
        return AgentSearchView;
    }

    giveFocus(): boolean {
        if (this.inputRef.current == null) {
            return false;
        }
        this.inputRef.current.focus();
        return true;
    }

    dispose() {
        this.disposed = true;
        this.searchEpoch++;
    }

    setQuery(query: string) {
        globalStore.set(this.queryAtom, query);
    }

    cancelSearch() {
        this.searchEpoch++;
        globalStore.set(this.searchingAtom, false);
    }

    setOption(optAtom: jotai.PrimitiveAtom<boolean>, value: boolean) {
        globalStore.set(optAtom, value);
        if (globalStore.get(this.resultAtom) == null) {
            return;
        }
        fireAndForget(() => this.runSearch());
    }

    async runSearch() {
        const query = globalStore.get(this.queryAtom).trim();
        if (query == "") {
            this.cancelSearch();
            globalStore.set(this.resultAtom, null);
            globalStore.set(this.submittedQueryAtom, "");
            return;
        }
        const epoch = ++this.searchEpoch;
        globalStore.set(this.submittedQueryAtom, query);
        globalStore.set(this.searchingAtom, true);
        globalStore.set(this.errorAtom, null);
        globalStore.set(this.selectedKeyAtom, null);
        globalStore.set(this.expandedAtom, new Set<string>());
        const data: CommandAgentSearchData = {
            query,
            workspaceid: globalStore.get(atoms.workspaceId),
            scopetoworkspace: globalStore.get(this.scopeToWorkspaceAtom),
            searchsessions: globalStore.get(this.searchSessionsAtom),
            searchmemory: globalStore.get(this.searchMemoryAtom),
        };
        const gen = RpcApi.AgentSearchCommand(TabRpcClient, data);
        try {
            let next = await gen.next();
            while (!next.done) {
                if (epoch != this.searchEpoch) {
                    // passing true to the stream generator sends a cancel so the backend stops scanning
                    await gen.next(true);
                    return;
                }
                const update = next.value as AgentSearchUpdate;
                if (update != null) {
                    globalStore.set(this.resultAtom, update);
                    if (update.error) {
                        globalStore.set(this.errorAtom, update.error);
                    }
                }
                next = await gen.next();
            }
        } catch (e) {
            if (epoch == this.searchEpoch) {
                globalStore.set(this.errorAtom, String(e?.message ?? e));
            }
        } finally {
            if (epoch == this.searchEpoch) {
                globalStore.set(this.searchingAtom, false);
            }
        }
    }

    moveSelection(delta: number) {
        const rows = globalStore.get(this.rowsAtom);
        if (rows.length == 0) {
            return;
        }
        const curKey = globalStore.get(this.selectedKeyAtom);
        const curIdx = rows.findIndex((r) => rowKey(r) == curKey);
        let nextIdx = curIdx == -1 ? (delta > 0 ? 0 : rows.length - 1) : curIdx + delta;
        nextIdx = Math.max(0, Math.min(rows.length - 1, nextIdx));
        globalStore.set(this.selectedKeyAtom, rowKey(rows[nextIdx]));
    }

    activateSelected(): boolean {
        const curKey = globalStore.get(this.selectedKeyAtom);
        const row = globalStore.get(this.rowsAtom).find((r) => rowKey(r) == curKey);
        if (row == null) {
            return false;
        }
        if (row.kind == "wave") {
            this.switchTo(row.wave);
        } else {
            this.toggleExpanded(rowKey(row));
        }
        return true;
    }

    toggleExpanded(key: string) {
        const next = new Set(globalStore.get(this.expandedAtom));
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        globalStore.set(this.expandedAtom, next);
    }

    switchTo(res: WaveSearchResult) {
        const curWsId = globalStore.get(atoms.workspaceId);
        if (res.workspaceid == curWsId) {
            if (res.tabid) {
                getApi().setActiveTab(res.tabid);
            }
            return;
        }
        fireAndForget(async () => {
            // switching workspaces tears down this tab's renderer, so the target tab is recorded on the
            // workspace first; the switch then opens the workspace on its active tab
            if (res.tabid) {
                await WorkspaceService.SetActiveTab(res.workspaceid, res.tabid);
            }
            getApi().switchWorkspace(res.workspaceid);
        });
    }

    openFiles(path: string) {
        fireAndForget(() => createBlock({ meta: { view: "preview", file: path } }));
    }

    openTerminal(path: string) {
        fireAndForget(() => createBlock({ meta: { view: "term", controller: "shell", "cmd:cwd": path } }));
    }

    copyPath(path: string) {
        fireAndForget(() => navigator.clipboard.writeText(path));
    }
}
