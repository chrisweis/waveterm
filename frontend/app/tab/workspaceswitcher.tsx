// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
} from "@/element/expandablemenu";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { atom, useAtom, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { CSSProperties, forwardRef, useCallback, useEffect, useMemo } from "react";
import WorkspaceSVG from "../asset/workspace.svg";
import { IconButton } from "../element/iconbutton";
import { makeORef } from "../store/wos";
import { waveEventSubscribeSingle } from "../store/wps";
import { activityGlowStyle, useActivityAlphas } from "./activityglow";
import { WorkspaceEditor } from "./workspaceeditor";
import { WorkspaceIcon } from "./workspaceicon";
import { useWorkspaceReorder } from "./workspaceorder";
import "./workspaceswitcher.scss";

export type WorkspaceSwitcherEnv = WaveEnvSubset<{
    electron: {
        deleteWorkspace: WaveEnv["electron"]["deleteWorkspace"];
        createWorkspace: WaveEnv["electron"]["createWorkspace"];
        switchWorkspace: WaveEnv["electron"]["switchWorkspace"];
    };
    atoms: {
        workspace: WaveEnv["atoms"]["workspace"];
    };
    services: {
        workspace: WaveEnv["services"]["workspace"];
    };
    wos: WaveEnv["wos"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

type WorkspaceListEntry = {
    windowId: string;
    workspace: Workspace;
};

type WorkspaceList = WorkspaceListEntry[];
const workspaceMapAtom = atom<WorkspaceList>([]);
const editingWorkspaceAtom = atom<string>();
const WorkspaceSwitcher = forwardRef<HTMLDivElement>((_, ref) => {
    const env = useWaveEnv<WorkspaceSwitcherEnv>();
    const [workspaceEntries, setWorkspaceList] = useAtom(workspaceMapAtom);
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const setEditingWorkspace = useSetAtom(editingWorkspaceAtom);
    const reorder = useWorkspaceReorder(workspaceEntries, (entry) => entry.workspace.oid);
    const workspaceOrefs = useMemo(
        () => reorder.ordered.map((entry) => makeORef("workspace", entry.workspace.oid)),
        [reorder.ordered]
    );
    const activityAlphas = useActivityAlphas(workspaceOrefs);

    // The popover content (and this scroll container) mounts fresh on each open. Reset the
    // viewport to the top so the list always opens at the first workspace.
    const scrollableRef = useCallback((instance: OverlayScrollbarsComponentRef) => {
        if (!instance) {
            return;
        }
        requestAnimationFrame(() => {
            const viewport = instance.osInstance()?.elements().viewport;
            if (viewport) {
                viewport.scrollTop = 0;
            }
        });
    }, []);

    const updateWorkspaceList = useCallback(async () => {
        const workspaceList = await env.services.workspace.ListWorkspaces();
        if (!workspaceList) {
            return;
        }
        const newList: WorkspaceList = [];
        for (const entry of workspaceList) {
            // This just ensures that the atom exists for easier setting of the object
            globalStore.get(env.wos.getWaveObjectAtom(makeORef("workspace", entry.workspaceid)));
            const workspace = await env.services.workspace.GetWorkspace(entry.workspaceid);
            // Ordering keys off workspace.oid, so an entry that failed to fetch has to be dropped
            // rather than carried as a null and dereferenced later.
            if (workspace == null) {
                continue;
            }
            newList.push({ windowId: entry.windowid, workspace });
        }
        setWorkspaceList(newList);
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

    const onDeleteWorkspace = useCallback((workspaceId: string) => {
        env.electron.deleteWorkspace(workspaceId);
    }, []);

    const updateEntry = useCallback((next: WorkspaceListEntry) => {
        setWorkspaceList((prev) => prev.map((entry) => (entry.workspace.oid === next.workspace.oid ? next : entry)));
    }, []);

    const isActiveWorkspaceSaved = !!(activeWorkspace.name && activeWorkspace.icon);

    const workspaceIcon = isActiveWorkspaceSaved ? (
        <WorkspaceIcon
            icon={activeWorkspace.icon}
            color={activeWorkspace.color}
            emoji={activeWorkspace.emoji}
            fw={false}
        />
    ) : (
        <WorkspaceSVG />
    );

    const saveWorkspace = () => {
        fireAndForget(async () => {
            await env.services.workspace.UpdateWorkspace(activeWorkspace.oid, "", "", "", true);
            await updateWorkspaceList();
            setEditingWorkspace(activeWorkspace.oid);
        });
    };

    return (
        <Popover
            className="workspace-switcher-popover"
            placement="bottom-start"
            onDismiss={() => setEditingWorkspace(null)}
            ref={ref}
        >
            <PopoverButton
                className="workspace-switcher-button grey"
                as="div"
                onClick={() => {
                    fireAndForget(updateWorkspaceList);
                }}
            >
                <span className="workspace-icon">{workspaceIcon}</span>
            </PopoverButton>
            <PopoverContent className="workspace-switcher-content">
                <div className="title">{isActiveWorkspaceSaved ? "Switch workspace" : "Open workspace"}</div>
                <OverlayScrollbarsComponent
                    ref={scrollableRef}
                    className={"scrollable"}
                    options={{ scrollbars: { autoHide: "leave" } }}
                >
                    <ExpandableMenu noIndent singleOpen>
                        {reorder.ordered.map((entry, index) => (
                            <WorkspaceSwitcherItem
                                key={entry.workspace.oid}
                                entry={entry}
                                updateEntry={updateEntry}
                                isDragging={reorder.dragId === entry.workspace.oid}
                                dropBefore={reorder.dropBefore(index)}
                                dropAfter={reorder.dropAfter(index)}
                                activityAlpha={activityAlphas[makeORef("workspace", entry.workspace.oid)]}
                                dragProps={reorder.dragItemProps(index)}
                                onDeleteWorkspace={onDeleteWorkspace}
                            />
                        ))}
                    </ExpandableMenu>
                </OverlayScrollbarsComponent>

                <div className="actions">
                    {isActiveWorkspaceSaved ? (
                        <ExpandableMenuItem onClick={() => env.electron.createWorkspace()}>
                            <ExpandableMenuItemLeftElement>
                                <i className="fa-sharp fa-solid fa-plus"></i>
                            </ExpandableMenuItemLeftElement>
                            <div className="content">Create new workspace</div>
                        </ExpandableMenuItem>
                    ) : (
                        <ExpandableMenuItem onClick={() => saveWorkspace()}>
                            <ExpandableMenuItemLeftElement>
                                <i className="fa-sharp fa-solid fa-floppy-disk"></i>
                            </ExpandableMenuItemLeftElement>
                            <div className="content">Save workspace</div>
                        </ExpandableMenuItem>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
});

const WorkspaceSwitcherItem = ({
    entry,
    updateEntry,
    isDragging,
    dropBefore,
    dropAfter,
    activityAlpha,
    dragProps,
    onDeleteWorkspace,
}: {
    entry: WorkspaceListEntry;
    updateEntry: (entry: WorkspaceListEntry) => void;
    isDragging: boolean;
    dropBefore: boolean;
    dropAfter: boolean;
    activityAlpha: number;
    dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
    onDeleteWorkspace: (workspaceId: string) => void;
}) => {
    const env = useWaveEnv<WorkspaceSwitcherEnv>();
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const [editingWorkspace, setEditingWorkspace] = useAtom(editingWorkspaceAtom);

    const workspace = entry.workspace;
    const isCurrentWorkspace = activeWorkspace.oid === workspace.oid;

    const setWorkspace = useCallback(
        (newWorkspace: Workspace) => {
            updateEntry({ ...entry, workspace: newWorkspace });
            if (newWorkspace.name != "") {
                fireAndForget(() =>
                    env.services.workspace.UpdateWorkspace(
                        workspace.oid,
                        newWorkspace.name,
                        newWorkspace.icon,
                        newWorkspace.color,
                        false
                    )
                );
            }
        },
        [entry]
    );

    const setEmoji = useCallback(
        (emoji: string) => {
            updateEntry({ ...entry, workspace: { ...workspace, emoji } });
            fireAndForget(() => env.services.workspace.SetWorkspaceEmoji(workspace.oid, emoji));
        },
        [entry]
    );

    const isActive = !!entry.windowId;
    const editIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: "edit",
        icon: "pencil",
        title: "Edit workspace",
        click: (e) => {
            e.stopPropagation();
            if (editingWorkspace === workspace.oid) {
                setEditingWorkspace(null);
            } else {
                setEditingWorkspace(workspace.oid);
            }
        },
    };
    const windowIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: clsx("window", { hidden: !isActive }),
        noAction: true,
        icon: isCurrentWorkspace ? "check" : "window",
        title: isCurrentWorkspace ? "This is your current workspace" : "This workspace is open",
    };

    const isEditing = editingWorkspace === workspace.oid;
    const activityGlow = activityGlowStyle(activityAlpha);

    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            env.showContextMenu(
                [
                    { label: "Edit Workspace...", click: () => setEditingWorkspace(workspace.oid) },
                    { type: "separator" },
                    { label: "New Workspace", click: () => env.electron.createWorkspace() },
                    { type: "separator" },
                    { label: "Delete Workspace", click: () => onDeleteWorkspace(workspace.oid) },
                ],
                e
            );
        },
        [workspace.oid, onDeleteWorkspace]
    );

    return (
        <ExpandableMenuItemGroup
            key={workspace.oid}
            isOpen={isEditing}
            className={clsx({ "is-current": isCurrentWorkspace })}
        >
            <ExpandableMenuItemGroupTitle
                onClick={() => {
                    env.electron.switchWorkspace(workspace.oid);
                    // Create a fake escape key event to close the popover
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
                }}
            >
                <div
                    className={clsx("menu-group-title-wrapper", { dragging: isDragging })}
                    style={
                        {
                            "--workspace-color": workspace.color,
                        } as CSSProperties
                    }
                    onContextMenu={onContextMenu}
                    {...dragProps}
                >
                    {!isCurrentWorkspace && activityGlow != null && (
                        <div className="activity-glow" style={activityGlow} />
                    )}
                    {dropBefore && <div className="drop-indicator before" />}
                    {dropAfter && <div className="drop-indicator after" />}
                    <ExpandableMenuItemLeftElement>
                        <WorkspaceIcon
                            className="left-icon"
                            icon={workspace.icon}
                            color={workspace.color}
                            emoji={workspace.emoji}
                        />
                    </ExpandableMenuItemLeftElement>
                    <div className="label">{workspace.name}</div>
                    <ExpandableMenuItemRightElement>
                        <div className="icons">
                            <IconButton decl={editIconDecl} />
                            <IconButton decl={windowIconDecl} />
                        </div>
                    </ExpandableMenuItemRightElement>
                </div>
            </ExpandableMenuItemGroupTitle>
            <ExpandableMenuItem>
                <WorkspaceEditor
                    title={workspace.name}
                    icon={workspace.icon}
                    color={workspace.color}
                    emoji={workspace.emoji}
                    focusInput={isEditing}
                    onTitleChange={(title) => setWorkspace({ ...workspace, name: title })}
                    onColorChange={(color) => setWorkspace({ ...workspace, color })}
                    onIconChange={(icon) => setWorkspace({ ...workspace, icon })}
                    onEmojiChange={setEmoji}
                    onDeleteWorkspace={() => onDeleteWorkspace(workspace.oid)}
                />
            </ExpandableMenuItem>
        </ExpandableMenuItemGroup>
    );
};

export { WorkspaceSwitcher };
