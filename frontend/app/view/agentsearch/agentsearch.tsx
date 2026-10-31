// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import * as React from "react";
import { type AgentSearchViewModel, rowKey, type TermCmdMode } from "./agentsearch-model";

const SnippetsCollapsed = 2;

// Paths are told apart by their last segment, so that is what stays readable when space runs out; the parent is
// dimmed and truncated from the left.
function splitPath(path: string): { parent: string; name: string } {
    const trimmed = path.replace(/[\\/]+$/, "");
    const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    if (idx < 0) {
        return { parent: "", name: trimmed || path };
    }
    return { parent: trimmed.slice(0, idx + 1), name: trimmed.slice(idx + 1) };
}

function PathLabel({ path, suffix }: { path: string; suffix?: string }) {
    const { parent, name } = splitPath(path);
    return (
        <span className="flex min-w-0 items-baseline gap-1.5 font-mono" title={path}>
            <span className="shrink-0 text-[13px] font-medium text-primary">{name}</span>
            {suffix && <span className="shrink-0 text-[11px] text-muted">{suffix}</span>}
            {parent && (
                <span className="min-w-0 truncate text-[11px] text-muted [direction:rtl]">{"‎" + parent + "‎"}</span>
            )}
        </span>
    );
}

function formatDate(ms: number): string {
    if (!ms) {
        return null;
    }
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function plural(n: number, word: string, pluralWord?: string): string {
    return `${n} ${n == 1 ? word : (pluralWord ?? word + "s")}`;
}

function Highlight({ text, query }: { text: string; query: string }) {
    if (!text || !query) {
        return <>{text}</>;
    }
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const parts: React.ReactNode[] = [];
    let pos = 0;
    let idx = lowerText.indexOf(lowerQuery);
    while (idx >= 0) {
        if (idx > pos) {
            parts.push(text.slice(pos, idx));
        }
        parts.push(
            <span key={idx} className="text-warning font-semibold">
                {text.slice(idx, idx + query.length)}
            </span>
        );
        pos = idx + query.length;
        idx = lowerText.indexOf(lowerQuery, pos);
    }
    if (pos < text.length) {
        parts.push(text.slice(pos));
    }
    return <>{parts}</>;
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <span className={cn("shrink-0 rounded-full bg-white/8 px-2 py-px text-[11px] text-secondary", className)}>
            {children}
        </span>
    );
}

function ToggleChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
    return (
        <button
            className={cn(
                "cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] transition-colors",
                on ? "bg-white/12 text-primary" : "bg-transparent text-muted line-through hover:bg-white/6"
            )}
            onClick={onClick}
        >
            {label}
        </button>
    );
}

// collapseLabel drops the text below the widget's wide breakpoint so the row keeps fitting, leaving the icon and its
// tooltip; labels that are the button's only content (tab names) always show.
function ActionButton({
    icon,
    label,
    title,
    collapseLabel,
    onClick,
}: {
    icon: string;
    label?: string;
    title: string;
    collapseLabel?: boolean;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    return (
        <button
            className="flex h-[24px] min-w-[24px] cursor-pointer items-center justify-center gap-1.5 rounded bg-white/6 px-1.5 text-[11px] text-secondary transition-colors hover:bg-white/14 hover:text-primary"
            title={title}
            aria-label={title}
            onClick={(e) => {
                e.stopPropagation();
                onClick(e);
            }}
        >
            <i className={`fa fa-solid fa-${icon}`} />
            {label && <span className={cn("truncate", collapseLabel && "hidden @[640px]:inline")}>{label}</span>}
        </button>
    );
}

function SegmentButton({
    icon,
    label,
    title,
    on,
    onClick,
}: {
    icon: string;
    label: string;
    title: string;
    on: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={cn(
                "flex cursor-pointer items-center gap-1.5 px-2 py-0.5 text-[11px] transition-colors",
                on ? "bg-white/14 text-primary" : "text-muted hover:bg-white/6 hover:text-secondary"
            )}
            title={title}
            aria-pressed={on}
            onClick={onClick}
        >
            <i className={`fa fa-solid fa-${icon}`} />
            <span className="hidden @[420px]:inline">{label}</span>
        </button>
    );
}

function SectionHeader({ label, count, note }: { label: string; count: number; note?: string }) {
    return (
        <div className="flex items-center gap-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <span>{label}</span>
            <span className="font-normal">{count}</span>
            {note && <span className="ml-auto font-normal normal-case">{note}</span>}
        </div>
    );
}

function rowClass(selected: boolean): string {
    return cn(
        "rounded-md border bg-white/[0.035] transition-colors cursor-pointer hover:bg-white/[0.06]",
        selected ? "border-accent/60 bg-white/[0.07]" : "border-white/8"
    );
}

function WaveResultRow({
    model,
    res,
    query,
    selected,
}: {
    model: AgentSearchViewModel;
    res: WaveSearchResult;
    query: string;
    selected: boolean;
}) {
    const isWorkspace = res.kind == "workspace";
    const name = isWorkspace ? res.workspacename : res.tabname;
    const where = isWorkspace
        ? `workspace · ${plural(res.numtabs ?? 0, "tab")}`
        : `tab · ${res.workspacename || "this workspace"}`;
    return (
        <div
            className={cn(rowClass(selected), "flex items-center gap-2.5 px-2.5 py-2")}
            onClick={() => model.switchTo(res)}
        >
            <i
                className={cn(
                    "fa fa-solid w-4 text-center",
                    isWorkspace ? "fa-layer-group text-accent" : "fa-window-maximize text-secondary"
                )}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-primary">
                        <Highlight text={name || "(unnamed)"} query={query} />
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{where}</span>
                    {res.current && <Chip className="bg-accent/18 text-accenthover">current</Chip>}
                </div>
                {res.path && (
                    <span className="truncate font-mono text-[11px] text-muted [direction:rtl]" title={res.path}>
                        {"‎"}
                        <Highlight text={res.path} query={query} />
                        {"‎"}
                    </span>
                )}
            </div>
            <span className={cn("ml-auto shrink-0 text-[11px]", selected ? "text-accent" : "text-muted")}>
                {selected ? "Switch ↵" : "Switch"}
            </span>
        </div>
    );
}

function showTabsMenu(model: AgentSearchViewModel, tabs: WaveSearchResult[], e: React.MouseEvent) {
    const menu: ContextMenuItem[] = tabs.map((t) => ({
        label: t.current ? t.tabname : `${t.tabname} · ${t.workspacename}`,
        sublabel: t.path,
        click: () => model.switchTo(t),
    }));
    ContextMenuModel.getInstance().showContextMenu(menu, e);
}

function FolderActions({
    model,
    folder,
    termCmd,
    showTabs,
}: {
    model: AgentSearchViewModel;
    folder: AgentFolderResult;
    termCmd: string;
    showTabs: boolean;
}) {
    const tabs = folder.tabs ?? [];
    return (
        <div className="ml-auto flex shrink-0 items-center gap-1">
            {showTabs && tabs.length > 0 && (
                <ActionButton
                    icon="window-maximize"
                    label={tabs.length > 1 ? String(tabs.length) : undefined}
                    title={
                        tabs.length == 1
                            ? `Switch to tab "${tabs[0].tabname}"`
                            : `Open in one of ${tabs.length} tabs already in this folder`
                    }
                    onClick={(e) => (tabs.length == 1 ? model.switchTo(tabs[0]) : showTabsMenu(model, tabs, e))}
                />
            )}
            <ActionButton
                icon="folder-open"
                label="Files"
                collapseLabel
                title="Open in Files"
                onClick={() => model.openFiles(folder.path)}
            />
            <ActionButton
                icon="terminal"
                label="Terminal"
                collapseLabel
                title={termCmd ? `New terminal here: ${termCmd}` : "New terminal here"}
                onClick={() => model.openTerminal(folder.path)}
            />
            {folder.lastsession && (
                <ActionButton
                    icon="rotate-left"
                    label="Resume"
                    collapseLabel
                    title="Resume the most recent matching Claude session"
                    onClick={() => model.resumeSession(folder.path, folder.lastsession)}
                />
            )}
            <ActionButton icon="copy" title="Copy path" onClick={() => model.copyPath(folder.path)} />
        </div>
    );
}

function FolderResultCard({
    model,
    folder,
    query,
    selected,
    expanded,
    compact,
    open,
    termCmd,
}: {
    model: AgentSearchViewModel;
    folder: AgentFolderResult;
    query: string;
    selected: boolean;
    expanded: boolean;
    compact: boolean;
    open: boolean;
    termCmd: string;
}) {
    const key = rowKey({ kind: "folder", folder });
    const snippets = folder.snippets ?? [];
    const tabs = folder.tabs ?? [];
    const shown = expanded ? snippets : snippets.slice(0, SnippetsCollapsed);
    const showDetails = !compact || open;
    const meta: string[] = [plural(folder.matches, "match", "matches")];
    if (folder.sessions) {
        meta.push(plural(folder.sessions, "session"));
    }
    if (folder.memoryfiles) {
        meta.push(plural(folder.memoryfiles, "memory file"));
    }
    const last = formatDate(folder.lastactive);
    if (last) {
        meta.push(`last active ${last}`);
    }
    return (
        <div
            className={cn(rowClass(selected), "flex flex-col", compact ? "gap-1.5 px-2.5 py-1.5" : "gap-2 p-3")}
            aria-expanded={compact ? open : undefined}
            onClick={() => (compact ? model.toggleCard(key) : model.toggleExpanded(key))}
        >
            <div className="flex min-h-[24px] items-center gap-2">
                {compact && (
                    <i
                        className={cn(
                            "fa fa-solid w-2.5 text-[9px] text-muted",
                            open ? "fa-chevron-down" : "fa-chevron-right"
                        )}
                    />
                )}
                <i className="fa fa-solid fa-folder text-warning" />
                <PathLabel path={folder.path} suffix={folder.global ? "(global memory)" : undefined} />
                {compact && (
                    <span className="shrink-0 text-[11px] text-muted" title={meta.join(" · ")}>
                        {folder.matches}
                    </span>
                )}
                {folder.missing && <Chip className="bg-error/20 text-error">not found on disk</Chip>}
                {!folder.missing && (
                    <FolderActions model={model} folder={folder} termCmd={termCmd} showTabs={compact && !open} />
                )}
            </div>
            {showDetails && <div className="text-[11px] text-muted">{meta.join(" · ")}</div>}
            {showDetails && tabs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted">Open in tab:</span>
                    {tabs.map((t) => (
                        <ActionButton
                            key={t.tabid}
                            icon="window-maximize"
                            label={t.current ? t.tabname : `${t.tabname} · ${t.workspacename}`}
                            title={`Switch to tab "${t.tabname}"${t.path ? ` (${t.path})` : ""}`}
                            onClick={() => model.switchTo(t)}
                        />
                    ))}
                </div>
            )}
            {showDetails &&
                shown.map((s, idx) => (
                    <div key={idx} className="group/snip flex items-start gap-2">
                        <Chip
                            className={cn(
                                "font-mono text-[10px]",
                                s.kind == "memory" ? "text-warning" : "text-secondary"
                            )}
                        >
                            {s.kind}
                        </Chip>
                        <span className="min-w-0 flex-1 break-words text-[12px] text-secondary">
                            <Highlight text={s.text} query={query} />
                        </span>
                        {s.sessionid && !folder.missing && (
                            <button
                                className="invisible shrink-0 cursor-pointer text-[11px] text-accent group-hover/snip:visible hover:underline"
                                title={`Resume session ${s.sessionid}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    model.resumeSession(folder.path, s.sessionid);
                                }}
                            >
                                Resume
                            </button>
                        )}
                    </div>
                ))}
            {showDetails && snippets.length > SnippetsCollapsed && (
                <div
                    className="flex cursor-pointer items-center gap-1 self-start text-[11px] text-accent hover:underline"
                    onClick={(e) => {
                        e.stopPropagation();
                        model.toggleExpanded(key);
                    }}
                >
                    <i className={cn("fa fa-solid text-[9px]", expanded ? "fa-chevron-down" : "fa-chevron-right")} />
                    {expanded ? "Show fewer" : `Show ${snippets.length - SnippetsCollapsed} more`}
                </div>
            )}
        </div>
    );
}

function TermCmdSettings({ model }: { model: AgentSearchViewModel }) {
    const savedCmd = useAtomValue(model.termCmdAtom) ?? "";
    const savedMode = useAtomValue(model.termCmdModeAtom);
    const [cmd, setCmd] = React.useState(savedCmd);
    const [mode, setMode] = React.useState<TermCmdMode>(savedMode);
    const close = () => {
        globalStore.set(model.settingsOpenAtom, false);
        model.giveFocus();
    };
    const save = () => {
        model.saveTermSettings(cmd, mode);
        close();
    };
    const modes: [TermCmdMode, string][] = [
        ["run", "Run the command"],
        ["paste", "Paste it without running"],
    ];
    return (
        <div className="flex shrink-0 flex-col gap-2 rounded-md border border-white/12 bg-white/[0.035] p-3">
            <div className="text-[12px] font-medium text-primary">Terminal command</div>
            <div className="text-[11px] text-muted">
                Typed into the new terminal when you click Terminal on a result. Leave empty for a plain shell. Resume
                reuses a claude command with the session id added, keeping your flags.
            </div>
            <input
                autoFocus
                className="h-[30px] rounded border border-white/16 bg-black/25 px-2 font-mono text-[12px] text-primary outline-none placeholder:text-muted focus:border-accent/90"
                placeholder="e.g. claude --dangerously-skip-permissions --chrome -r"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key == "Enter") {
                        e.preventDefault();
                        save();
                    } else if (e.key == "Escape") {
                        e.preventDefault();
                        close();
                    }
                }}
                spellCheck={false}
            />
            <div className="flex flex-wrap items-center gap-4">
                {modes.map(([value, label]) => (
                    <label key={value} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-primary">
                        <input
                            type="radio"
                            className="cursor-pointer accent-[var(--color-accent)]"
                            checked={mode == value}
                            onChange={() => setMode(value)}
                        />
                        {label}
                    </label>
                ))}
                <div className="ml-auto flex items-center gap-1.5">
                    <button
                        className="cursor-pointer rounded px-3 py-1 text-[12px] text-secondary transition-colors hover:bg-white/8"
                        onClick={close}
                    >
                        Cancel
                    </button>
                    <button
                        className="cursor-pointer rounded bg-accent/80 px-3 py-1 text-[12px] font-semibold text-primary transition-colors hover:bg-accent"
                        onClick={save}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

function StatusLine({ res, searching }: { res: AgentSearchUpdate; searching: boolean }) {
    const waveCount = res.waveresults?.length ?? 0;
    const folderCount = res.folders?.length ?? 0;
    const matchCount = (res.folders ?? []).reduce((acc, f) => acc + f.matches, 0);
    const summary = `${plural(waveCount, "workspace/tab", "workspaces/tabs")} · ${plural(folderCount, "folder")} · ${plural(matchCount, "match", "matches")}`;
    const detail = searching
        ? `searching… ${res.filessearched} of ${res.filestotal} files`
        : `${plural(res.sessionfiles, "session")} + ${plural(res.memoryfiles, "memory file")} searched in ${(res.elapsedms / 1000).toFixed(1)}s`;
    const pct = res.filestotal > 0 ? Math.round((100 * res.filessearched) / res.filestotal) : 100;
    return (
        <div className="flex flex-col gap-1.5">
            {searching && (
                <div className="h-1 w-full overflow-hidden rounded-sm bg-white/8">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
            )}
            <div className="text-[11px]" title={`${summary} · ${detail}`}>
                <span className="font-medium text-secondary">{summary}</span>
                <span className={cn("text-muted", !searching && "hidden @[560px]:inline")}> · {detail}</span>
            </div>
        </div>
    );
}

export const AgentSearchView: React.FC<ViewComponentProps<AgentSearchViewModel>> = ({ model }) => {
    const query = useAtomValue(model.queryAtom);
    const submittedQuery = useAtomValue(model.submittedQueryAtom);
    const scoped = useAtomValue(model.scopeToWorkspaceAtom);
    const searchSessions = useAtomValue(model.searchSessionsAtom);
    const searchMemory = useAtomValue(model.searchMemoryAtom);
    const res = useAtomValue(model.resultAtom);
    const searching = useAtomValue(model.searchingAtom);
    const error = useAtomValue(model.errorAtom);
    const selectedKey = useAtomValue(model.selectedKeyAtom);
    const expanded = useAtomValue(model.expandedAtom);
    const openCards = useAtomValue(model.openCardsAtom);
    const compact = useAtomValue(model.compactAtom);
    const scopeListOpen = useAtomValue(model.scopeListOpenAtom);
    const settingsOpen = useAtomValue(model.settingsOpenAtom);
    const termCmd = useAtomValue(model.termCmdAtom) ?? "";
    const selectedRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: "nearest" });
    }, [selectedKey]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key == "Enter") {
            e.preventDefault();
            if (query.trim() == submittedQuery && !searching && model.activateSelected()) {
                return;
            }
            model.runSearch();
            return;
        }
        if (e.key == "Escape") {
            // with nothing left to cancel or clear, Escape is left unhandled so a docked panel can collapse
            if (searching) {
                e.preventDefault();
                model.cancelSearch();
                return;
            }
            if (query != "") {
                e.preventDefault();
                model.setQuery("");
            }
            return;
        }
        if (e.key == "ArrowDown" || e.key == "ArrowUp") {
            e.preventDefault();
            model.moveSelection(e.key == "ArrowDown" ? 1 : -1);
        }
    };

    const waveResults = res?.waveresults ?? [];
    const folders = res?.folders ?? [];
    const noResults = res != null && !searching && !error && waveResults.length == 0 && folders.length == 0;
    const wrapSelected = (key: string, node: React.ReactNode) => (
        <div key={key} ref={key == selectedKey ? selectedRef : undefined}>
            {node}
        </div>
    );

    const scopePaths = scoped ? (res?.scopepaths ?? []) : [];
    return (
        <div className="@container flex h-full w-full flex-col gap-2.5 overflow-hidden p-3">
            <div
                className={cn(
                    "flex h-[34px] shrink-0 items-center gap-2 rounded-md border bg-black/25 pr-1 pl-2.5",
                    "border-white/16 focus-within:border-accent/90"
                )}
            >
                <i className="fa fa-solid fa-magnifying-glass text-[12px] text-muted" />
                <input
                    ref={model.inputRef}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-muted"
                    placeholder="Search tabs, Claude sessions and memory…"
                    value={query}
                    onChange={(e) => model.setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                />
                {searching ? (
                    <button
                        className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded px-2.5 text-[12px] text-secondary transition-colors hover:bg-white/10 hover:text-primary"
                        title="Stop searching (Esc)"
                        onClick={() => model.cancelSearch()}
                    >
                        <i className="fa fa-solid fa-spinner fa-spin text-[11px]" />
                        Stop
                    </button>
                ) : (
                    <button
                        className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded bg-accent/80 px-2.5 text-[12px] font-semibold text-primary transition-colors hover:bg-accent"
                        title="Search (Enter)"
                        onClick={() => {
                            model.runSearch();
                            model.giveFocus();
                        }}
                    >
                        Search
                        <span className="hidden font-mono text-[11px] font-normal opacity-80 @[420px]:inline">↵</span>
                    </button>
                )}
            </div>
            {settingsOpen && <TermCmdSettings model={model} />}
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex items-center gap-1.5">
                    <label
                        className="flex cursor-pointer items-center gap-1.5 text-[12px] text-primary"
                        title="Only search folders that tabs in this workspace are using. Remembered for this workspace."
                    >
                        <input
                            type="checkbox"
                            className="cursor-pointer accent-[var(--color-accent)]"
                            checked={scoped}
                            onChange={(e) => model.setScopeToWorkspace(e.target.checked)}
                        />
                        <span className="hidden @[380px]:inline">Only this workspace</span>
                        <span className="@[380px]:hidden">This workspace</span>
                    </label>
                    {scopePaths.length > 0 && (
                        <button
                            className="flex cursor-pointer items-center gap-1 rounded px-1 text-[11px] text-muted transition-colors hover:bg-white/6 hover:text-secondary"
                            title={scopeListOpen ? "Hide the scoped folders" : "Show which folders are searched"}
                            aria-expanded={scopeListOpen}
                            onClick={() => model.toggleScopeList()}
                        >
                            {plural(scopePaths.length, "folder")}
                            <i
                                className={cn(
                                    "fa fa-solid text-[8px]",
                                    scopeListOpen ? "fa-chevron-up" : "fa-chevron-down"
                                )}
                            />
                        </button>
                    )}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <ToggleChip
                            label="Sessions"
                            on={searchSessions}
                            onClick={() => model.setOption(model.searchSessionsAtom, !searchSessions)}
                        />
                        <ToggleChip
                            label="Memory"
                            on={searchMemory}
                            onClick={() => model.setOption(model.searchMemoryAtom, !searchMemory)}
                        />
                    </div>
                    <div className="flex overflow-hidden rounded border border-white/12" role="group">
                        <SegmentButton
                            icon="list"
                            label="Folders"
                            title="Folders only: one line per folder, click one to see its matches. Remembered for this workspace."
                            on={compact}
                            onClick={() => model.setCompact(true)}
                        />
                        <SegmentButton
                            icon="align-left"
                            label="Details"
                            title="Show matching text under every folder. Remembered for this workspace."
                            on={!compact}
                            onClick={() => model.setCompact(false)}
                        />
                    </div>
                </div>
            </div>
            {scopeListOpen && scopePaths.length > 0 && (
                <div className="flex max-h-[76px] shrink-0 flex-wrap items-center gap-1 overflow-y-auto">
                    {scopePaths.map((p) => (
                        <Chip key={p} className="max-w-full truncate font-mono text-[10px]">
                            <span title={p}>{splitPath(p).name}</span>
                        </Chip>
                    ))}
                </div>
            )}
            {res != null && !error && <StatusLine res={res} searching={searching} />}
            {error && <div className="text-[12px] text-error">{error}</div>}
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {res == null && !searching && (
                    <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                        <div className="text-[13px] font-medium text-secondary">
                            Find the workspace, tab, or folder where you worked on a topic
                        </div>
                        <div className="text-[11px] text-muted">
                            Searches workspace and tab names, then Claude Code sessions and memory
                        </div>
                    </div>
                )}
                {noResults && (
                    <div className="flex flex-col items-center gap-2.5 py-7 text-center">
                        <div className="text-[13px] font-medium text-secondary">
                            {scoped ? "No matches in this workspace" : "No matches"}
                        </div>
                        {scoped && (
                            <button
                                className="cursor-pointer rounded bg-accent/80 px-3 py-1.5 text-[12px] font-semibold text-primary transition-colors hover:bg-accent"
                                onClick={() => model.setScopeToWorkspace(false)}
                            >
                                Search all workspaces
                            </button>
                        )}
                    </div>
                )}
                {waveResults.length > 0 && (
                    <>
                        <SectionHeader
                            label="Wave — workspaces & tabs"
                            count={waveResults.length}
                            note={scoped ? "this workspace" : "all workspaces"}
                        />
                        {waveResults.map((w) => {
                            const key = rowKey({ kind: "wave", wave: w });
                            return wrapSelected(
                                key,
                                <WaveResultRow
                                    model={model}
                                    res={w}
                                    query={submittedQuery}
                                    selected={key == selectedKey}
                                />
                            );
                        })}
                    </>
                )}
                {folders.length > 0 && (
                    <>
                        <SectionHeader
                            label="Claude sessions & memory"
                            count={folders.length}
                            note="grouped by folder"
                        />
                        {folders.map((f) => {
                            const key = rowKey({ kind: "folder", folder: f });
                            return wrapSelected(
                                key,
                                <FolderResultCard
                                    model={model}
                                    folder={f}
                                    query={submittedQuery}
                                    selected={key == selectedKey}
                                    expanded={expanded.has(key)}
                                    compact={compact}
                                    open={openCards.has(key)}
                                    termCmd={termCmd}
                                />
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
};
