// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getApi, getSettingsKeyAtom, globalStore, WOS } from "@/app/store/global";
import { BlockService, WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import { AgentSearchView } from "./agentsearch";

const ShellStartTimeoutMs = 10000;
const ShellPollMs = 150;

export type TermCmdMode = "run" | "paste";

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
    settingsOpenAtom = jotai.atom<boolean>(false) as jotai.PrimitiveAtom<boolean>;
    termCmdAtom = getSettingsKeyAtom("agentsearch:termcmd");
    termCmdModeAtom: jotai.Atom<TermCmdMode>;

    rowsAtom: jotai.Atom<SearchRow[]>;

    inputRef: React.RefObject<HTMLInputElement> = { current: null };
    searchEpoch = 0;
    disposed = false;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.termCmdModeAtom = jotai.atom((get) =>
            get(getSettingsKeyAtom("agentsearch:termcmdmode")) == "paste" ? "paste" : "run"
        );
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

    getSettingsMenuItems(): ContextMenuItem[] {
        const cmd = globalStore.get(this.termCmdAtom) ?? "";
        const mode = globalStore.get(this.termCmdModeAtom);
        return [
            {
                label: cmd ? "Edit Terminal Command..." : "Set Terminal Command...",
                sublabel: cmd || undefined,
                click: () => globalStore.set(this.settingsOpenAtom, true),
            },
            {
                label: "Terminal Command Mode",
                type: "submenu",
                submenu: [
                    {
                        label: "Run Command",
                        type: "checkbox",
                        checked: mode == "run",
                        click: () => this.saveTermSettings(cmd, "run"),
                    },
                    {
                        label: "Paste Command (Don't Run)",
                        type: "checkbox",
                        checked: mode == "paste",
                        click: () => this.saveTermSettings(cmd, "paste"),
                    },
                ],
            },
        ];
    }

    saveTermSettings(cmd: string, mode: TermCmdMode) {
        fireAndForget(() =>
            RpcApi.SetConfigCommand(TabRpcClient, {
                "agentsearch:termcmd": cmd.trim(),
                "agentsearch:termcmdmode": mode,
            })
        );
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
        this.openTerminalWithCmd(path, (globalStore.get(this.termCmdAtom) ?? "").trim());
    }

    resumeSession(path: string, sessionId: string) {
        this.openTerminalWithCmd(path, makeResumeCmd(globalStore.get(this.termCmdAtom) ?? "", sessionId));
    }

    openTerminalWithCmd(path: string, cmd: string) {
        const mode = globalStore.get(this.termCmdModeAtom);
        fireAndForget(async () => {
            const initScripts = cmd ? makeInitScripts(cmd, mode) : {};
            const blockId = await createBlock({
                meta: { view: "term", controller: "shell", "cmd:cwd": path, ...initScripts },
            });
            if (!cmd) {
                return;
            }
            await clearInitScriptsOnceStarted(blockId, Object.keys(initScripts));
            if (mode == "paste") {
                await pasteWhenReady(blockId, cmd);
            }
        });
    }

    copyPath(path: string) {
        fireAndForget(() => navigator.clipboard.writeText(path));
    }
}

function psQuote(s: string): string {
    return "'" + s.split("'").join("''") + "'";
}

function shQuote(s: string): string {
    return "'" + s.split("'").join(`'\\''`) + "'";
}

// Typing the command into the pty races shell startup: Windows PowerShell has no shell integration to say when the
// prompt is up, and input sent while Wave's startup script is still running gets swallowed. Init scripts run inside
// startup instead, so "run" is deterministic. For "paste", pwsh and zsh can prefill the first prompt's edit buffer
// from the init script; bash and fish can't, so pasteWhenReady types it once their integration reports the prompt.
function makeInitScripts(cmd: string, mode: TermCmdMode): MetaType {
    if (mode == "run") {
        return { "cmd:initscript": cmd };
    }
    return {
        "cmd:initscript.pwsh": `$null = Register-EngineEvent -SourceIdentifier PowerShell.OnIdle -MaxTriggerCount 1 -Action { [Microsoft.PowerShell.PSConsoleReadLine]::Insert(${psQuote(cmd)}) }`,
        "cmd:initscript.zsh": `print -z -- ${shQuote(cmd)}`,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// The init script is read from block meta each time the shell starts, so it's removed once this shell is running;
// otherwise every restart of the terminal (including reopening Wave) would run the command again.
async function clearInitScriptsOnceStarted(blockId: string, keys: string[]) {
    const deadline = Date.now() + ShellStartTimeoutMs;
    while (Date.now() < deadline) {
        const status = await BlockService.GetControllerStatus(blockId).catch((): BlockControllerRuntimeStatus => null);
        if (status?.shellprocstatus == "running" || status?.shellprocstatus == "done") {
            break;
        }
        await sleep(ShellPollMs);
    }
    const meta: MetaType = {};
    for (const key of keys) {
        meta[key] = null;
    }
    await RpcApi.SetMetaCommand(TabRpcClient, { oref: WOS.makeORef("block", blockId), meta });
}

async function pasteWhenReady(blockId: string, cmd: string) {
    const oref = WOS.makeORef("block", blockId);
    const deadline = Date.now() + ShellStartTimeoutMs;
    while (Date.now() < deadline) {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, { oref }).catch((): ObjRTInfo => null);
        if (rtInfo?.["shell:state"] == "ready") {
            const shellType = rtInfo["shell:type"];
            if (shellType == "bash" || shellType == "fish") {
                await RpcApi.ControllerInputCommand(TabRpcClient, {
                    blockid: blockId,
                    inputdata64: stringToBase64(cmd),
                });
            }
            return;
        }
        await sleep(ShellPollMs);
    }
}

// Builds on the configured command so its flags (e.g. --dangerously-skip-permissions) carry over to the resume.
// A command that isn't claude at all can't take a session id, so that falls back to a plain resume.
export function makeResumeCmd(termCmd: string, sessionId: string): string {
    const cmd = termCmd.trim();
    if (/(^|\s)(-r|--resume)$/.test(cmd)) {
        return `${cmd} ${sessionId}`;
    }
    if (/^claude(\s|$)/.test(cmd)) {
        return `${cmd} --resume ${sessionId}`;
    }
    return `claude --resume ${sessionId}`;
}
