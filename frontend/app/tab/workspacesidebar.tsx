// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Popover, PopoverButton, PopoverContent } from "@/app/element/popover";
import { Tooltip } from "@/app/element/tooltip";
import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "@/app/store/wos";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn, fireAndForget, useAtomValueSafe } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { waveEventSubscribeSingle } from "../store/wps";
import { activityGlowStyle, useActivityAlphas } from "./activityglow";
import { WorkspaceEditor } from "./workspaceeditor";
import { WorkspaceIcon } from "./workspaceicon";
import { useWorkspaceReorder } from "./workspaceorder";
import { WorkspaceSidebarModel } from "./workspacesidebar-model";
import "./workspacesidebar.scss";
import { WorkspaceSidebarEnv } from "./workspacesidebarenv";

type SidebarEntry = {
    workspaceId: string;
    windowId: string;
};

interface WorkspaceSidebarItemProps {
    entry: SidebarEntry;
    compact: boolean;
    isCurrent: boolean;
    isDragging: boolean;
    dropBefore: boolean;
    dropAfter: boolean;
    activityAlpha: number;
    dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
    onSelect: (workspaceId: string) => void;
    onDeleteWorkspace: (workspaceId: string) => void;
}

const WorkspaceSidebarItem = memo(
    ({
        entry,
        compact,
        isCurrent,
        isDragging,
        dropBefore,
        dropAfter,
        activityAlpha,
        dragProps,
        onSelect,
        onDeleteWorkspace,
    }: WorkspaceSidebarItemProps) => {
        const env = useWaveEnv<WorkspaceSidebarEnv>();
        const [liveWorkspace] = env.wos.useWaveObjectValue<Workspace>(makeORef("workspace", entry.workspaceId));
        // Local echo while the editor is open: every keystroke fires an RPC, and waiting for the
        // object to round-trip back through the store makes the input stutter.
        const [draft, setDraft] = useState<Workspace>(null);
        const [editing, setEditing] = useState(false);

        const applyEdit = useCallback((next: Workspace) => {
            setDraft(next);
            if (next.name === "") {
                return;
            }
            fireAndForget(() =>
                env.services.workspace.UpdateWorkspace(next.oid, next.name, next.icon, next.color, false)
            );
        }, []);

        const applyEmoji = useCallback((next: Workspace, emoji: string) => {
            setDraft({ ...next, emoji });
            fireAndForget(() => env.services.workspace.SetWorkspaceEmoji(next.oid, emoji));
        }, []);

        const workspace = draft ?? liveWorkspace;

        const onContextMenu = useCallback(
            (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (workspace == null) {
                    return;
                }
                env.showContextMenu(
                    [
                        { label: "Edit Workspace...", click: () => setEditing(true) },
                        { type: "separator" },
                        { label: "New Workspace", click: () => env.electron.createWorkspace() },
                        { type: "separator" },
                        { label: "Delete Workspace", click: () => onDeleteWorkspace(workspace.oid) },
                    ],
                    e
                );
            },
            [workspace, onDeleteWorkspace]
        );

        if (workspace == null) {
            return null;
        }

        const isOpen = !!entry.windowId;
        const activityGlow = activityGlowStyle(activityAlpha);

        // The editor is opened only from the context menu, so the popover's anchor carries no
        // pointer events of its own -- it exists purely to give floating-ui something to position
        // against, and must never swallow the click that switches workspaces.
        const editor = (
            <Popover
                className="workspace-sidebar-editor-mount"
                placement="right-start"
                open={editing}
                onOpenChange={(open) => {
                    setEditing(open);
                    if (!open) {
                        setDraft(null);
                    }
                }}
            >
                <PopoverButton className="workspace-sidebar-editor-anchor ghost grey" tabIndex={-1} aria-hidden={true}>
                    {null}
                </PopoverButton>
                <PopoverContent className="workspace-sidebar-editor-popover">
                    <WorkspaceEditor
                        title={workspace.name}
                        icon={workspace.icon}
                        color={workspace.color}
                        emoji={workspace.emoji}
                        focusInput={true}
                        onTitleChange={(name) => applyEdit({ ...workspace, name })}
                        onColorChange={(color) => applyEdit({ ...workspace, color })}
                        onIconChange={(icon) => applyEdit({ ...workspace, icon })}
                        onEmojiChange={(emoji) => applyEmoji(workspace, emoji)}
                        onDeleteWorkspace={() => onDeleteWorkspace(workspace.oid)}
                    />
                </PopoverContent>
            </Popover>
        );

        // Tooltip's `disable` must stay constant here. It renders a plain div when disabled and
        // <TooltipInner> when not, so flipping it mid-drag swaps the component type and React
        // unmounts the row being dragged -- Chromium never fires dragend on a removed node, which
        // strands the drop line and loses the reorder.
        return (
            <Tooltip content={workspace.name} placement="right" openDelay={0} hideOnClick>
                <div
                    className={cn(
                        "workspace-sidebar-item group relative mx-1.5 flex h-9 cursor-pointer items-center rounded-md transition-colors select-none",
                        compact ? "justify-center" : "gap-2.5 px-2",
                        isCurrent ? "bg-hoverbg" : "hover:bg-hover",
                        isDragging && "opacity-40"
                    )}
                    onClick={() => onSelect(workspace.oid)}
                    onContextMenu={onContextMenu}
                    {...dragProps}
                >
                    {activityGlow != null && (
                        <div className="pointer-events-none absolute inset-0 rounded-md" style={activityGlow} />
                    )}
                    {dropBefore && (
                        <div className="pointer-events-none absolute inset-x-0 -top-px h-0.5 rounded-full bg-accent" />
                    )}
                    {dropAfter && (
                        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
                    )}
                    {isCurrent && (
                        <div className="pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
                    )}
                    <WorkspaceIcon
                        icon={workspace.icon}
                        color={workspace.color}
                        emoji={workspace.emoji}
                        className="shrink-0 text-[15px] leading-none"
                    />
                    {!compact && (
                        <>
                            <div className={cn("truncate text-[12px]", isCurrent ? "text-primary" : "text-secondary")}>
                                {workspace.name}
                            </div>
                            {isOpen && !isCurrent && (
                                <i className="fa fa-solid fa-circle ml-auto shrink-0 text-[5px] text-secondary/50" />
                            )}
                        </>
                    )}
                    {compact && isOpen && !isCurrent && (
                        <div className="pointer-events-none absolute bottom-1 right-1 h-1 w-1 rounded-full bg-secondary/60" />
                    )}
                    {editor}
                </div>
            </Tooltip>
        );
    }
);
WorkspaceSidebarItem.displayName = "WorkspaceSidebarItem";

interface SidebarButtonProps {
    icon: string;
    label: string;
    compact: boolean;
    onClick: () => void;
}

const SidebarButton = memo(({ icon, label, compact, onClick }: SidebarButtonProps) => {
    return (
        <Tooltip content={label} placement="right" openDelay={0} hideOnClick disable={!compact}>
            <div
                className={cn(
                    "mx-1.5 flex h-8 cursor-pointer items-center rounded-md text-secondary/70 transition-colors select-none hover:bg-hover hover:text-primary",
                    compact ? "justify-center" : "gap-2.5 px-2"
                )}
                onClick={onClick}
            >
                <i className={cn(icon, "shrink-0 text-[12px]")} />
                {!compact && <div className="truncate text-[12px]">{label}</div>}
            </div>
        </Tooltip>
    );
});
SidebarButton.displayName = "SidebarButton";

// Rendered by workspace.tsx as a sibling of the sidebar, not inside it. The sidebar clips its own
// overflow, and the handle has to straddle the boundary: whatever sits immediately right of the
// sidebar (the panel group's own splitter) paints a resize cursor a few px past the edge, so a
// handle confined to the inside loses every drag that approaches from the content side.
export const WorkspaceSidebarResizeHandle = memo(() => {
    const sidebarModel = WorkspaceSidebarModel.getInstance();
    const compact = useAtomValue(sidebarModel.compactAtom);

    // Listeners go on window rather than the handle: the pointer routinely outruns a thin strip
    // during a fast drag, and losing the move events mid-gesture strands the sidebar half-resized.
    const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = globalStore.get(sidebarModel.expandedWidthAtom);
        const onMove = (ev: PointerEvent) => {
            sidebarModel.setDragWidth(startWidth + (ev.clientX - startX));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            sidebarModel.persistWidth();
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, []);

    if (compact) {
        return null;
    }

    return (
        <div
            className="group absolute top-0 bottom-0 -right-1 z-30 w-3 cursor-col-resize"
            onPointerDown={onResizePointerDown}
        >
            <div className="absolute inset-y-0 right-1 w-0.5 bg-transparent transition-colors group-hover:bg-accent/70" />
        </div>
    );
});
WorkspaceSidebarResizeHandle.displayName = "WorkspaceSidebarResizeHandle";

export const WorkspaceSidebar = memo(() => {
    const env = useWaveEnv<WorkspaceSidebarEnv>();
    const sidebarModel = WorkspaceSidebarModel.getInstance();
    const compact = useAtomValue(sidebarModel.compactAtom);
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const [entries, setEntries] = useState<SidebarEntry[]>([]);

    const updateWorkspaceList = useCallback(async () => {
        const workspaceList = await env.services.workspace.ListWorkspaces();
        if (!workspaceList) {
            return;
        }
        const newEntries: SidebarEntry[] = [];
        for (const entry of workspaceList) {
            // ensure the wave object atom exists so the item can subscribe to live updates
            globalStore.get(env.wos.getWaveObjectAtom(makeORef("workspace", entry.workspaceid)));
            newEntries.push({ workspaceId: entry.workspaceid, windowId: entry.windowid });
        }
        setEntries(newEntries);
    }, []);

    useEffect(
        () =>
            waveEventSubscribeSingle({
                eventType: "workspace:update",
                handler: () => fireAndForget(updateWorkspaceList),
            }),
        []
    );

    useEffect(() => {
        fireAndForget(updateWorkspaceList);
    }, []);

    const onSelect = useCallback((workspaceId: string) => {
        env.electron.switchWorkspace(workspaceId);
    }, []);

    const onDeleteWorkspace = useCallback((workspaceId: string) => {
        env.electron.deleteWorkspace(workspaceId);
    }, []);

    const reorder = useWorkspaceReorder(entries, (entry) => entry.workspaceId);
    const workspaceOrefs = useMemo(
        () => reorder.ordered.map((entry) => makeORef("workspace", entry.workspaceId)),
        [reorder.ordered]
    );
    const activityAlphas = useActivityAlphas(workspaceOrefs);

    // The right edge carries a real resize handle in expanded mode only. Compact mode is a fixed
    // 48px icon strip, so it deliberately shows no edge affordance at all.
    return (
        <div
            className="relative flex h-full flex-col overflow-hidden"
            style={{ backdropFilter: "blur(20px)", background: "rgba(0, 0, 0, 0.35)" }}
        >
            <div
                className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden pt-1.5"
                {...reorder.dragContainerProps}
            >
                {reorder.ordered.map((entry, index) => (
                    <WorkspaceSidebarItem
                        key={entry.workspaceId}
                        entry={entry}
                        compact={compact}
                        isCurrent={activeWorkspace?.oid === entry.workspaceId}
                        isDragging={reorder.dragId === entry.workspaceId}
                        dropBefore={reorder.dropBefore(index)}
                        dropAfter={reorder.dropAfter(index)}
                        activityAlpha={activityAlphas[makeORef("workspace", entry.workspaceId)]}
                        dragProps={reorder.dragItemProps(index)}
                        onSelect={onSelect}
                        onDeleteWorkspace={onDeleteWorkspace}
                    />
                ))}
            </div>
            <div className="flex shrink-0 flex-col gap-0.5 pb-1.5 pt-1">
                <SidebarButton
                    icon="fa fa-solid fa-plus"
                    label="New workspace"
                    compact={compact}
                    onClick={() => env.electron.createWorkspace()}
                />
                <SidebarButton
                    icon={cn("fa fa-solid", compact ? "fa-angles-right" : "fa-angles-left")}
                    label={compact ? "Expand" : "Collapse"}
                    compact={compact}
                    onClick={() => sidebarModel.toggleCompact()}
                />
            </div>
        </div>
    );
});
WorkspaceSidebar.displayName = "WorkspaceSidebar";
