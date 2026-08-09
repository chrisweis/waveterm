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
import { atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { splitAtom } from "jotai/utils";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { CSSProperties, forwardRef, useCallback, useEffect } from "react";
import WorkspaceSVG from "../asset/workspace.svg";
import { IconButton } from "../element/iconbutton";
import { makeORef } from "../store/wos";
import { waveEventSubscribeSingle } from "../store/wps";
import { WorkspaceEditor } from "./workspaceeditor";
import { WorkspaceIcon } from "./workspaceicon";
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
}>;

type WorkspaceListEntry = {
    windowId: string;
    workspace: Workspace;
};

type WorkspaceList = WorkspaceListEntry[];
const workspaceMapAtom = atom<WorkspaceList>([]);
const workspaceSplitAtom = splitAtom(workspaceMapAtom);
const editingWorkspaceAtom = atom<string>();
const WorkspaceSwitcher = forwardRef<HTMLDivElement>((_, ref) => {
    const env = useWaveEnv<WorkspaceSwitcherEnv>();
    const setWorkspaceList = useSetAtom(workspaceMapAtom);
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const workspaceList = useAtomValue(workspaceSplitAtom);
    const setEditingWorkspace = useSetAtom(editingWorkspaceAtom);

    // The popover content (and this scroll container) mounts fresh on each open. Reset the
    // viewport to the top so the pinned workspaces at the top of the list are shown first.
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
            newList.push({
                windowId: entry.windowid,
                workspace: await env.services.workspace.GetWorkspace(entry.workspaceid),
            });
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
                        {workspaceList.map((entry, i) => (
                            <WorkspaceSwitcherItem key={i} entryAtom={entry} onDeleteWorkspace={onDeleteWorkspace} />
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
    entryAtom,
    onDeleteWorkspace,
}: {
    entryAtom: PrimitiveAtom<WorkspaceListEntry>;
    onDeleteWorkspace: (workspaceId: string) => void;
}) => {
    const env = useWaveEnv<WorkspaceSwitcherEnv>();
    const activeWorkspace = useAtomValueSafe(env.atoms.workspace);
    const [workspaceEntry, setWorkspaceEntry] = useAtom(entryAtom);
    const [editingWorkspace, setEditingWorkspace] = useAtom(editingWorkspaceAtom);

    const workspace = workspaceEntry.workspace;
    const isCurrentWorkspace = activeWorkspace.oid === workspace.oid;

    const setWorkspace = useCallback((newWorkspace: Workspace) => {
        setWorkspaceEntry({ ...workspaceEntry, workspace: newWorkspace });
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
    }, []);

    const setEmoji = useCallback((emoji: string) => {
        setWorkspaceEntry({ ...workspaceEntry, workspace: { ...workspace, emoji } });
        fireAndForget(() => env.services.workspace.SetWorkspaceEmoji(workspace.oid, emoji));
    }, []);

    const isActive = !!workspaceEntry.windowId;
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

    const isPinned = !!workspace.pinned;
    const pinIconDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        className: clsx("pin", { pinned: isPinned }),
        icon: isPinned ? "solid@thumbtack" : "regular@thumbtack",
        title: isPinned ? "Unpin workspace" : "Pin workspace",
        click: (e) => {
            e.stopPropagation();
            fireAndForget(() => env.services.workspace.SetWorkspacePinned(workspace.oid, !isPinned));
        },
    };

    const isEditing = editingWorkspace === workspace.oid;

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
                    className="menu-group-title-wrapper"
                    style={
                        {
                            "--workspace-color": workspace.color,
                        } as CSSProperties
                    }
                >
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
                            <IconButton decl={pinIconDecl} />
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
