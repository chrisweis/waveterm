// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import * as React from "react";
import { type AgentSearchViewModel, rowKey } from "./agentsearch-model";

const SnippetsCollapsed = 2;

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

function ActionButton({
    icon,
    label,
    title,
    onClick,
}: {
    icon: string;
    label?: string;
    title: string;
    onClick: () => void;
}) {
    return (
        <button
            className="flex cursor-pointer items-center gap-1.5 rounded bg-white/6 px-2 py-1 text-[11px] text-secondary transition-colors hover:bg-white/12 hover:text-primary"
            title={title}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
        >
            <i className={`fa fa-solid fa-${icon}`} />
            {label}
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
                    <span className="truncate font-mono text-[11px] text-muted">
                        <Highlight text={res.path} query={query} />
                    </span>
                )}
            </div>
            <span className={cn("ml-auto shrink-0 text-[11px]", selected ? "text-accent" : "text-muted")}>
                {selected ? "Switch ↵" : "Switch"}
            </span>
        </div>
    );
}

function FolderResultCard({
    model,
    folder,
    query,
    selected,
    expanded,
    scoped,
}: {
    model: AgentSearchViewModel;
    folder: AgentFolderResult;
    query: string;
    selected: boolean;
    expanded: boolean;
    scoped: boolean;
}) {
    const key = rowKey({ kind: "folder", folder });
    const snippets = folder.snippets ?? [];
    const shown = expanded ? snippets : snippets.slice(0, SnippetsCollapsed);
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
    const displayPath = folder.global ? `${folder.path}  (global memory)` : folder.path;
    return (
        <div
            className={cn(rowClass(selected), "group flex flex-col gap-2 p-3")}
            onClick={() => {
                model.toggleExpanded(key);
            }}
        >
            <div className="flex items-center gap-2">
                <i className="fa fa-solid fa-folder text-warning" />
                <span className="min-w-0 truncate font-mono text-[13px] font-medium text-primary" title={folder.path}>
                    {displayPath}
                </span>
                {folder.inworkspace && !scoped && <Chip className="bg-accent/18 text-accenthover">open in tab</Chip>}
                {folder.missing && <Chip className="bg-error/20 text-error">not found on disk</Chip>}
                {!folder.missing && (
                    <div
                        className={cn(
                            "ml-auto flex shrink-0 items-center gap-1.5",
                            selected ? "visible" : "invisible group-hover:visible"
                        )}
                    >
                        <ActionButton
                            icon="folder-open"
                            label="Files"
                            title="Open in Files"
                            onClick={() => model.openFiles(folder.path)}
                        />
                        <ActionButton
                            icon="terminal"
                            label="Terminal"
                            title="New terminal here"
                            onClick={() => model.openTerminal(folder.path)}
                        />
                        <ActionButton icon="copy" title="Copy path" onClick={() => model.copyPath(folder.path)} />
                    </div>
                )}
            </div>
            <div className="text-[11px] text-muted">{meta.join(" · ")}</div>
            {shown.map((s, idx) => (
                <div key={idx} className="flex items-start gap-2">
                    <Chip
                        className={cn("font-mono text-[10px]", s.kind == "memory" ? "text-warning" : "text-secondary")}
                    >
                        {s.kind}
                    </Chip>
                    <span className="min-w-0 break-words text-[12px] text-secondary">
                        <Highlight text={s.text} query={query} />
                    </span>
                </div>
            ))}
            {snippets.length > SnippetsCollapsed && (
                <div className="flex items-center gap-1 text-[11px] text-accent">
                    <i className={cn("fa fa-solid text-[9px]", expanded ? "fa-chevron-down" : "fa-chevron-right")} />
                    {expanded ? "Show fewer" : `Show ${snippets.length - SnippetsCollapsed} more`}
                </div>
            )}
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
            <div className="text-[11px]">
                <span className="font-medium text-secondary">{summary}</span>
                <span className="text-muted"> · {detail}</span>
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
            e.preventDefault();
            if (searching) {
                model.cancelSearch();
                return;
            }
            model.setQuery("");
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

    return (
        <div className="flex h-full w-full flex-col gap-3 overflow-hidden p-3.5">
            <div
                className={cn(
                    "flex h-[34px] shrink-0 items-center gap-2 rounded-md border bg-black/25 px-2.5",
                    "border-white/16 focus-within:border-accent/90"
                )}
            >
                <i className="fa fa-solid fa-magnifying-glass text-[12px] text-muted" />
                <input
                    ref={model.inputRef}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-muted"
                    placeholder="Search workspaces, tabs, Claude sessions and memory…"
                    value={query}
                    onChange={(e) => model.setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                />
                <span className="shrink-0 font-mono text-[11px] text-muted">
                    {searching ? "searching…" : "Enter ↵"}
                </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-primary">
                    <input
                        type="checkbox"
                        className="cursor-pointer accent-[var(--color-accent)]"
                        checked={scoped}
                        onChange={(e) => model.setOption(model.scopeToWorkspaceAtom, e.target.checked)}
                    />
                    Only this workspace
                </label>
                {scoped && res?.scopepaths != null && (
                    <span className="text-[12px] text-muted">({plural(res.scopepaths.length, "folder")})</span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
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
            </div>
            {scoped && (res?.scopepaths?.length ?? 0) > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted">Scope:</span>
                    {res.scopepaths.map((p) => (
                        <Chip key={p} className="font-mono text-[10px]">
                            {p}
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
                                onClick={() => model.setOption(model.scopeToWorkspaceAtom, false)}
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
                                    scoped={scoped}
                                />
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
};
