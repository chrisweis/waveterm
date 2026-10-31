// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SubBlock } from "@/app/block/block";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, getBlockComponentModel, globalStore, WOS } from "@/app/store/global";
import { cn, makeIconClass, useAtomValueSafe } from "@/util/util";
import * as jotai from "jotai";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
    DockDefaultWidth,
    DockMinVisibleTab,
    DockMinWidth,
    DockModel,
    DockSide,
    getBlockDockSide,
    getDockEntryInfo,
} from "./dock-model";

type WidgetBarMode = "normal" | "compact" | "supercompact";

function useWidgetList(): WidgetConfigType[] {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    return useMemo(() => Object.values(fullConfig?.widgets ?? {}), [fullConfig?.widgets]);
}

function useDockedBlock(blockId: string): Block {
    const [block] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    return block;
}

function dockedBlockMenu(blockId: string, viewModel?: ViewModel): ContextMenuItem[] {
    const model = DockModel.getInstance();
    const side = model.sideOf(blockId);
    const menu: ContextMenuItem[] = [];
    const extraItems = viewModel?.getSettingsMenuItems?.();
    if (extraItems?.length > 0) {
        menu.push(...extraItems, { type: "separator" });
    }
    menu.push(
        side == "right"
            ? { label: "Dock to Left", click: () => model.moveToSide(blockId, "left") }
            : { label: "Dock to Right", click: () => model.moveToSide(blockId, "right") },
        { label: "Move to Tab Layout", click: () => model.undockBlock(blockId) },
        { type: "separator" },
        { label: "Close", click: () => model.closeBlock(blockId) }
    );
    return menu;
}

function showDockedBlockMenu(blockId: string, e: React.MouseEvent) {
    ContextMenuModel.getInstance().showContextMenu(
        dockedBlockMenu(blockId, getBlockComponentModel(blockId)?.viewModel),
        e
    );
}

function HeaderButton({
    icon,
    title,
    active,
    onClick,
}: {
    icon: string;
    title: string;
    active?: boolean;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    return (
        <button
            className={cn(
                "flex h-6 w-6 cursor-pointer items-center justify-center rounded text-[12px] transition-colors hover:bg-hover",
                active ? "text-accent" : "text-secondary hover:text-primary"
            )}
            title={title}
            aria-label={title}
            onClick={onClick}
        >
            <i className={makeIconClass(icon, true)} />
        </button>
    );
}

const DockedBlockHeader = memo(
    ({ blockId, viewModel, side }: { blockId: string; viewModel: ViewModel; side: DockSide }) => {
        const model = DockModel.getInstance();
        const pinned = useAtomValue(model.pinnedAtom);
        const block = useDockedBlock(blockId);
        const widgets = useWidgetList();
        const viewIcon = useAtomValueSafe(viewModel?.viewIcon);
        const viewName = useAtomValueSafe(viewModel?.viewName);
        const viewText = useAtomValueSafe(viewModel?.viewText);
        const info = getDockEntryInfo(block, widgets);
        const icon = typeof viewIcon == "string" ? viewIcon : info.icon;
        const name = viewName || info.label;
        return (
            <div
                className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3"
                onContextMenu={(e) => {
                    e.preventDefault();
                    showDockedBlockMenu(blockId, e);
                }}
            >
                <i className={cn(makeIconClass(icon, true), "text-[13px] text-secondary")} />
                <span className="shrink-0 text-[13px] font-medium text-primary">{name}</span>
                {typeof viewText == "string" && viewText && (
                    <span className="min-w-0 truncate text-[12px] text-muted">{viewText}</span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <HeaderButton icon="cog" title="Settings" onClick={(e) => showDockedBlockMenu(blockId, e)} />
                    <HeaderButton
                        icon="thumbtack"
                        title={
                            pinned
                                ? "Pinned open: stays open when you click elsewhere (click to unpin)"
                                : "Pin open: keep the panel open when you click elsewhere"
                        }
                        active={pinned}
                        onClick={() => model.setPinned(!pinned)}
                    />
                    <HeaderButton
                        icon={side == "right" ? "angles-right" : "angles-left"}
                        title="Collapse (Esc)"
                        onClick={() => model.collapse(side)}
                    />
                </div>
            </div>
        );
    }
);
DockedBlockHeader.displayName = "DockedBlockHeader";

const DockedBlock = memo(({ blockId, visible, side }: { blockId: string; visible: boolean; side: DockSide }) => {
    const model = DockModel.getInstance();
    const nodeModel = useMemo<BlockNodeModel>(
        () => ({
            blockId,
            isFocused: jotai.atom((get) => {
                const openIds = get(model.openIdsAtom);
                return openIds.left == blockId || openIds.right == blockId;
            }),
            isMagnified: jotai.atom(false),
            onClose: () => model.closeBlock(blockId),
            focusNode: () => model.open(blockId),
            toggleMagnify: () => {},
        }),
        [blockId]
    );
    // Docking unmounts the block's layout copy in the same commit that mounts this one. Its cleanup unregisters and
    // disposes the view model, so rendering SubBlock right away would adopt the still-registered model and then have
    // it disposed underneath it (fatal for terminals). Waiting one effect lets that cleanup run first.
    const [ready, setReady] = useState(false);
    useEffect(() => {
        setReady(true);
    }, []);
    // SubBlock registers the view model while rendering, so it can only be read back after that render
    const [viewModel, setViewModel] = useState<ViewModel>(null);
    useEffect(() => {
        if (!ready) {
            return;
        }
        setViewModel(getBlockComponentModel(blockId)?.viewModel ?? null);
    }, [blockId, ready]);
    useEffect(() => {
        if (!visible || !ready) {
            return;
        }
        // waits for the slide-in to make the panel visible; focus() on a hidden element is ignored
        const timer = setTimeout(() => getBlockComponentModel(blockId)?.viewModel?.giveFocus?.(), 60);
        return () => clearTimeout(timer);
    }, [visible, blockId, ready]);
    return (
        <div className={cn("absolute inset-0 flex flex-col", !visible && "invisible")}>
            <DockedBlockHeader blockId={blockId} viewModel={viewModel} side={side} />
            <div className="block relative min-h-0 flex-1 rounded-none">
                {ready && <SubBlock nodeModel={nodeModel} />}
            </div>
        </div>
    );
});
DockedBlock.displayName = "DockedBlock";

function clampWidth(width: number, containerWidth: number): number {
    const max = Math.max(DockMinWidth, containerWidth - DockMinVisibleTab);
    return Math.max(DockMinWidth, Math.min(max, width));
}

export const DockPanel = memo(({ side }: { side: DockSide }) => {
    const model = DockModel.getInstance();
    const openIds = useAtomValue(model.openIdsAtom);
    const mountedIds = useAtomValue(model.mountedIdsAtom);
    const dockIds = useAtomValue(model.dockIdsAtom);
    const sideIds = useAtomValue(model.sideIdsAtoms[side]);
    const pinned = useAtomValue(model.pinnedAtom);
    const dragWidth = useAtomValue(model.dragWidthAtom);
    const openId = openIds[side];
    const openBlock = useDockedBlock(openId);
    const panelRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const parent = panelRef.current?.parentElement;
        if (parent == null) {
            return;
        }
        const observer = new ResizeObserver(() => setContainerWidth(parent.clientWidth));
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);

    // A block closed or moved back to a tab from another tab's renderer disappears from the dock list here too.
    // This checks the whole list rather than this side's, since a block moving sides is briefly on neither.
    useEffect(() => {
        if (openId != null && !dockIds.includes(openId)) {
            model.collapse(side);
        }
    }, [dockIds, openId]);

    useEffect(() => {
        if (openId == null || pinned) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Element;
            if (target?.closest?.(`[data-dock-panel="${side}"], .dock-entry, .modal-wrapper`)) {
                return;
            }
            model.collapse(side);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [openId, pinned]);

    const savedWidth = openBlock?.meta?.["dock:width"] || DockDefaultWidth;
    const liveWidth = dragWidth != null && dragWidth.blockId == openId ? dragWidth.width : savedWidth;
    const width = clampWidth(liveWidth, containerWidth);

    const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
        if (openId == null) {
            return;
        }
        e.preventDefault();
        const blockId = openId;
        const startX = e.clientX;
        const startWidth = width;
        let lastWidth = startWidth;
        const onMove = (ev: PointerEvent) => {
            const delta = side == "right" ? startX - ev.clientX : ev.clientX - startX;
            lastWidth = clampWidth(startWidth + delta, containerWidth);
            globalStore.set(model.dragWidthAtom, { blockId, width: lastWidth });
        };
        const onUp = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.body.style.cursor = "";
            model.saveWidth(blockId, lastWidth);
            // hold the dragged width until the saved meta comes back, so the panel doesn't flash back to the old size
            setTimeout(() => globalStore.set(model.dragWidthAtom, null), 500);
        };
        document.body.style.cursor = "ew-resize";
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    };

    const open = openId != null && sideIds.includes(openId);
    const shownIds = mountedIds.filter((id) => sideIds.includes(id));
    const resizeHandle = (
        <div
            className="w-1.5 shrink-0 cursor-ew-resize bg-transparent transition-colors hover:bg-accent/40"
            title="Drag to resize"
            onPointerDown={startResize}
        />
    );
    return (
        <div
            ref={panelRef}
            data-dock-panel={side}
            className={cn(
                "absolute top-0 bottom-0 z-[60] flex transition-[transform,visibility] duration-150 ease-out",
                side == "right" ? "right-0" : "left-0",
                open
                    ? "visible translate-x-0"
                    : cn("invisible pointer-events-none", side == "right" ? "translate-x-full" : "-translate-x-full")
            )}
            style={{ width, maxWidth: "100%" }}
            onKeyDown={(e) => {
                if (e.key != "Escape" || e.defaultPrevented) {
                    return;
                }
                e.preventDefault();
                model.collapse(side);
            }}
        >
            {side == "right" && resizeHandle}
            <div
                className={cn(
                    "relative flex min-w-0 flex-1 flex-col border-border bg-background",
                    side == "right"
                        ? "border-l shadow-[-8px_0_24px_rgba(0,0,0,0.45)]"
                        : "border-r shadow-[8px_0_24px_rgba(0,0,0,0.45)]"
                )}
            >
                {shownIds.map((id) => (
                    <DockedBlock key={id} blockId={id} visible={id == openId} side={side} />
                ))}
            </div>
            {side == "left" && resizeHandle}
        </div>
    );
});
DockPanel.displayName = "DockPanel";

const DockEntry = memo(({ blockId, mode, side }: { blockId: string; mode: WidgetBarMode; side: DockSide }) => {
    const model = DockModel.getInstance();
    const openIds = useAtomValue(model.openIdsAtom);
    const block = useDockedBlock(blockId);
    const widgets = useWidgetList();
    if (block == null) {
        return null;
    }
    const info = getDockEntryInfo(block, widgets);
    const isOpen = openIds[getBlockDockSide(block)] == blockId;
    return (
        <Tooltip
            content={`${info.label} (docked ${side}): click to ${isOpen ? "collapse" : "expand"}; right-click for options`}
            placement={side == "right" ? "left" : "right"}
            divClassName={cn(
                "dock-entry relative flex flex-col justify-center items-center w-full py-1.5 overflow-hidden rounded-sm cursor-pointer hover:bg-hoverbg hover:text-white",
                side == "right" ? "pr-0.5" : "pl-0.5",
                mode === "supercompact" ? "text-sm" : "text-lg",
                isOpen ? "bg-hover text-white" : "text-secondary"
            )}
            divOnClick={() => model.toggle(blockId)}
        >
            <div
                className="flex w-full flex-col items-center"
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showDockedBlockMenu(blockId, e);
                }}
            >
                <span
                    className={cn(
                        "absolute top-1.5 bottom-1.5 w-[3px]",
                        side == "right" ? "left-0 rounded-r" : "right-0 rounded-l",
                        isOpen ? "bg-accent" : "bg-accent/40"
                    )}
                />
                <div style={{ color: info.color }}>
                    <i className={makeIconClass(info.icon, true, { defaultIcon: "browser" })} />
                </div>
                {mode === "normal" && (
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                        {info.label}
                    </div>
                )}
            </div>
        </Tooltip>
    );
});
DockEntry.displayName = "DockEntry";

// Right-docked entries live at the top of the widgets bar, above the widgets that create blocks.
export const DockEntries = memo(({ mode }: { mode: WidgetBarMode }) => {
    const rightIds = useAtomValue(DockModel.getInstance().sideIdsAtoms.right);
    if (rightIds.length == 0) {
        return null;
    }
    return (
        <div className={cn("flex flex-col", mode === "supercompact" && "grid grid-cols-2")}>
            {rightIds.map((id) => (
                <DockEntry key={id} blockId={id} mode={mode} side="right" />
            ))}
            <div className="col-span-2 mx-2 my-1 h-px bg-border" />
        </div>
    );
});
DockEntries.displayName = "DockEntries";

const DockSidebarRow = memo(({ blockId, compact }: { blockId: string; compact: boolean }) => {
    const model = DockModel.getInstance();
    const openIds = useAtomValue(model.openIdsAtom);
    const block = useDockedBlock(blockId);
    const widgets = useWidgetList();
    if (block == null) {
        return null;
    }
    const info = getDockEntryInfo(block, widgets);
    const isOpen = openIds.left == blockId;
    return (
        <Tooltip
            content={`${info.label}: click to ${isOpen ? "collapse" : "expand"}; right-click for options`}
            placement="right"
            openDelay={compact ? 0 : 600}
            hideOnClick
            divClassName={cn(
                "dock-entry relative mx-1.5 flex h-8 cursor-pointer items-center rounded-md transition-colors select-none hover:bg-hover",
                compact ? "justify-center" : "gap-2.5 px-2",
                isOpen ? "bg-hover text-primary" : "text-secondary"
            )}
            divOnClick={() => model.toggle(blockId)}
        >
            <div
                className={cn("flex min-w-0 flex-1 items-center", compact ? "justify-center" : "gap-2.5")}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showDockedBlockMenu(blockId, e);
                }}
            >
                <span
                    className={cn(
                        "absolute top-1.5 right-0 bottom-1.5 w-[3px] rounded-l",
                        isOpen ? "bg-accent" : "bg-accent/40"
                    )}
                />
                <i
                    className={cn(makeIconClass(info.icon, true, { defaultIcon: "browser" }), "shrink-0 text-[12px]")}
                    style={{ color: info.color }}
                />
                {!compact && <div className="truncate text-[12px]">{info.label}</div>}
            </div>
        </Tooltip>
    );
});
DockSidebarRow.displayName = "DockSidebarRow";

// Left-docked entries sit at the top of the workspace sidebar's column, mirroring the right-docked ones at the top of
// the widgets bar (same edge marker facing the tab, same divider), so they take no extra width.
export const DockSidebarSection = memo(({ compact }: { compact: boolean }) => {
    const leftIds = useAtomValue(DockModel.getInstance().sideIdsAtoms.left);
    if (leftIds.length == 0) {
        return null;
    }
    return (
        <div className="flex shrink-0 flex-col gap-0.5 pt-1.5">
            {leftIds.map((id) => (
                <DockSidebarRow key={id} blockId={id} compact={compact} />
            ))}
            <div className="mx-2 mt-1 h-px bg-border" />
        </div>
    );
});
DockSidebarSection.displayName = "DockSidebarSection";

// A slim strip on the given edge of the tab area, used only when that side's usual home (the workspace sidebar on
// the left, the widgets bar on the right) is turned off, so docked panels still have something to open them from.
export const DockStrip = memo(({ side }: { side: DockSide }) => {
    const ids = useAtomValue(DockModel.getInstance().sideIdsAtoms[side]);
    if (ids.length == 0) {
        return null;
    }
    return (
        <div className={cn("flex w-10 shrink-0 flex-col gap-0.5 py-1 select-none", side == "left" && "pl-0.5")}>
            {ids.map((id) => (
                <DockEntry key={id} blockId={id} mode="compact" side={side} />
            ))}
        </div>
    );
});
DockStrip.displayName = "DockStrip";
