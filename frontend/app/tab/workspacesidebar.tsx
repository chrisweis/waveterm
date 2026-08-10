// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Popover, PopoverButton, PopoverContent } from "@/app/element/popover";
import { Tooltip } from "@/app/element/tooltip";
import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "@/app/store/wos";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn, fireAndForget, useAtomValueSafe } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";
import { waveEventSubscribeSingle } from "../store/wps";
import { WorkspaceEditor } from "./workspaceeditor";
import { WorkspaceIcon } from "./workspaceicon";
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
    onSelect: (workspaceId: string) => void;
    onDeleteWorkspace: (workspaceId: string) => void;
}

const WorkspaceSidebarItem = memo(
    ({ entry, compact, isCurrent, onSelect, onDeleteWorkspace }: WorkspaceSidebarItemProps) => {
        const env = useWaveEnv<WorkspaceSidebarEnv>();
        const [liveWorkspace] = env.wos.useWaveObjectValue<Workspace>(makeORef("workspace", entry.workspaceId));
        // Local echo while the editor is open: every keystroke fires an RPC, and waiting for the
        // object to round-trip back through the store makes the input stutter.
        const [draft, setDraft] = useState<Workspace>(null);

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

        const togglePinned = useCallback((next: Workspace) => {
            fireAndForget(() => env.services.workspace.SetWorkspacePinned(next.oid, !next.pinned));
        }, []);

        const workspace = draft ?? liveWorkspace;
        if (workspace == null) {
            return null;
        }

        const isOpen = !!entry.windowId;
        const isPinned = !!workspace.pinned;

        const editButton = (
            <Popover placement="right-start" onDismiss={() => setDraft(null)}>
                <PopoverButton
                    as="div"
                    className={cn(
                        // "ghost grey" is load-bearing: Button falls back to a solid green pill
                        // when the className carries no category/color class.
                        "workspace-sidebar-edit-btn ghost grey",
                        "cursor-pointer rounded text-[10px] opacity-0 transition-opacity group-hover:opacity-100",
                        compact ? "absolute right-0 top-0 h-3.5 w-3.5 bg-hoverbg" : "h-4 w-4"
                    )}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    <i className="fa fa-solid fa-pencil" />
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

        return (
            <Tooltip content={workspace.name} placement="right" openDelay={0} hideOnClick>
                <div
                    className={cn(
                        "workspace-sidebar-item group relative mx-1.5 flex h-9 cursor-pointer items-center rounded-md transition-colors select-none",
                        compact ? "justify-center" : "gap-2.5 px-2",
                        isCurrent ? "bg-hoverbg" : "hover:bg-hover"
                    )}
                    onClick={() => onSelect(workspace.oid)}
                >
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
                            <div className="ml-auto flex shrink-0 items-center gap-1">
                                <i
                                    className={cn(
                                        "fa fa-thumbtack cursor-pointer text-[10px] transition-opacity hover:text-primary",
                                        isPinned
                                            ? "fa-solid text-secondary/70 opacity-100"
                                            : "fa-regular text-secondary/70 opacity-0 group-hover:opacity-100"
                                    )}
                                    title={isPinned ? "Unpin workspace" : "Pin workspace"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        togglePinned(workspace);
                                    }}
                                />
                                {editButton}
                                {isOpen && !isCurrent && (
                                    <i className="fa fa-solid fa-circle text-[5px] text-secondary/50" />
                                )}
                            </div>
                        </>
                    )}
                    {compact && editButton}
                    {compact && isOpen && !isCurrent && (
                        <div className="pointer-events-none absolute bottom-1 right-1 h-1 w-1 rounded-full bg-secondary/60" />
                    )}
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

    // No right border on the container below: a divider line there reads as a drag handle, and the
    // sidebar is deliberately fixed-width. The darker background provides the separation instead.
    return (
        <div
            className="flex h-full flex-col overflow-hidden"
            style={{ backdropFilter: "blur(20px)", background: "rgba(0, 0, 0, 0.35)" }}
        >
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden pt-1.5">
                {entries.map((entry) => (
                    <WorkspaceSidebarItem
                        key={entry.workspaceId}
                        entry={entry}
                        compact={compact}
                        isCurrent={activeWorkspace?.oid === entry.workspaceId}
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
