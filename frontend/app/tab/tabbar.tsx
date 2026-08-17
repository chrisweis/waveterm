// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { deleteLayoutModelForTab } from "@/layout/index";
import { isMacOSTahoeOrLater } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { OverlayScrollbars } from "overlayscrollbars";
import { createRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "throttle-debounce";
import { makeORef } from "../store/wos";
import { useActivityAlphas } from "./activityglow";
import { Tab } from "./tab";
import "./tabbar.scss";
import { TabBarEnv } from "./tabbarenv";
import { UpdateStatusBanner } from "./updatebanner";
import { WorkspaceSwitcher } from "./workspaceswitcher";

const TabDefaultWidth = 130;
const TabMinWidth = 100;
// Autosize bounds. The floor is below TabMinWidth on purpose -- the whole point of autosize is that
// a tab called "sh" need not reserve room for a name it doesn't have. There is no natural-width
// ceiling: a lone tab with a long name is allowed to be wide, and the fitting pass below is what
// reins tabs in once they have to compete for space.
const TabAutoMinWidth = 70;
// Room around the name for padding, badges and the close button.
const TabAutoChrome = 46;
const MacOSTrafficLightsWidth = 74;
const MacOSTahoeTrafficLightsWidth = 80;

const OSOptions = {
    overflow: {
        x: "scroll",
        y: "hidden",
    },
    scrollbars: {
        theme: "os-theme-dark",
        visibility: "auto",
        autoHide: "leave",
        autoHideDelay: 1300,
        autoHideSuspend: false,
        dragScroll: true,
        clickScroll: false,
        pointers: ["mouse", "touch", "pen"],
    },
};

// Expand every tab to its natural width when they all fit; otherwise cap them at the largest width
// that does fit, so short names keep their size and only the long ones give up room. This is why the
// answer is not simply "available / count": that shrinks a tab called "sh" just as hard as one with a
// sentence in it. Exported for tests -- the previous sizing model shipped broken because its maths
// was only ever exercised by eye.
export function fitTabWidths(
    naturals: number[],
    available: number,
    minWidth = TabAutoMinWidth,
    protectedIndex = -1
): number[] {
    // A tab being renamed is exempt from shrinking: the whole point of expanding it is to show what
    // is being typed, which competing for space would undo. It takes what it needs off the top and
    // the rest share the remainder.
    if (protectedIndex >= 0 && protectedIndex < naturals.length && naturals.length > 1) {
        const reserved = Math.min(naturals[protectedIndex], available);
        const rest = naturals.filter((_w, i) => i !== protectedIndex);
        const fittedRest = fitTabWidths(rest, Math.max(0, available - reserved), minWidth);
        const rtn: number[] = [];
        let restIdx = 0;
        for (let i = 0; i < naturals.length; i++) {
            rtn.push(i === protectedIndex ? reserved : fittedRest[restIdx++]);
        }
        return rtn;
    }
    const total = naturals.reduce((acc, w) => acc + w, 0);
    if (total <= available || naturals.length === 0) {
        return naturals;
    }
    const ascending = [...naturals].sort((a, b) => a - b);
    let consumed = 0;
    let cap = Infinity;
    for (let i = 0; i < ascending.length; i++) {
        const remainingCount = ascending.length - i;
        if (consumed + ascending[i] * remainingCount >= available) {
            cap = (available - consumed) / remainingCount;
            break;
        }
        consumed += ascending[i];
    }
    if (!isFinite(cap)) {
        return naturals;
    }
    return naturals.map((w) => Math.max(minWidth, Math.min(w, cap)));
}

interface TabBarProps {
    workspace: Workspace;
    noTabs?: boolean;
}

const WaveAIButton = memo(({ divRef }: { divRef?: React.RefObject<HTMLDivElement> }) => {
    const env = useWaveEnv<TabBarEnv>();
    const aiPanelOpen = useAtomValue(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
    const hideAiButton = useAtomValue(env.getSettingsKeyAtom("app:hideaibutton"));

    const onClick = () => {
        const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
    };

    if (hideAiButton) {
        return null;
    }

    return (
        <Tooltip
            content="Toggle Wave AI Panel"
            placement="bottom"
            hideOnClick
            divClassName={`flex h-[22px] px-3.5 justify-end mb-1 items-center rounded-md mr-1 box-border cursor-pointer bg-hover hover:bg-hoverbg transition-colors text-[12px] ${aiPanelOpen ? "text-accent" : "text-secondary"}`}
            divStyle={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            divOnClick={onClick}
            divRef={divRef}
        >
            <i className="fa fa-sparkles" />
        </Tooltip>
    );
});
WaveAIButton.displayName = "WaveAIButton";

function strArrayIsEqual(a: string[], b: string[]) {
    // null check
    if (a == null && b == null) {
        return true;
    }
    if (a == null || b == null) {
        return false;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

const TabBar = memo(({ workspace, noTabs }: TabBarProps) => {
    const env = useWaveEnv<TabBarEnv>();
    const [tabIds, setTabIds] = useState<string[]>([]);
    const [dragStartPositions, setDragStartPositions] = useState<number[]>([]);
    const [draggingTab, setDraggingTab] = useState<string>();
    const [tabsLoaded, setTabsLoaded] = useState({});
    const [newTabId, setNewTabId] = useState<string | null>(null);

    const tabbarWrapperRef = useRef<HTMLDivElement>(null);
    const tabBarRef = useRef<HTMLDivElement>(null);
    const tabsWrapperRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<React.RefObject<HTMLDivElement>[]>([]);
    const addBtnRef = useRef<HTMLButtonElement>(null);
    const draggingRemovedRef = useRef(false);
    const draggingTabDataRef = useRef({
        tabId: "",
        ref: { current: null },
        tabStartX: 0,
        tabStartIndex: 0,
        tabIndex: 0,
        initialOffsetX: null,
        totalScrollOffset: null,
        dragged: false,
    });
    const osInstanceRef = useRef<OverlayScrollbars>(null);
    const draggerLeftRef = useRef<HTMLDivElement>(null);
    const rightContainerRef = useRef<HTMLDivElement>(null);
    const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
    const waveAIButtonRef = useRef<HTMLDivElement>(null);
    const appMenuButtonRef = useRef<HTMLDivElement>(null);
    const tabWidthRef = useRef<number>(TabDefaultWidth);
    const measureCtxRef = useRef<CanvasRenderingContext2D>(null);
    if (measureCtxRef.current == null && typeof document !== "undefined") {
        measureCtxRef.current = document.createElement("canvas").getContext("2d");
    }
    // Keyed by tab id, not index: a drag reorders tabIds in place, so index-keyed widths would
    // follow the slot rather than the tab and every tab after the drop would be laid out wrong.
    const tabWidthsRef = useRef<Record<string, number>>({});
    const scrollableRef = useRef<boolean>(false);
    const prevAllLoadedRef = useRef<boolean>(false);
    const activeTabId = useAtomValue(env.atoms.staticTabId);
    const isFullScreen = useAtomValue(env.atoms.isFullScreen);
    const zoomFactor = useAtomValue(env.atoms.zoomFactorAtom);
    const showMenuBar = useAtomValue(env.getSettingsKeyAtom("window:showmenubar"));
    const confirmClose = useAtomValue(env.getSettingsKeyAtom("tab:confirmclose")) ?? false;
    const hideAiButton = useAtomValue(env.getSettingsKeyAtom("app:hideaibutton"));
    const workspaceSidebarEnabled = useAtomValue(env.getSettingsKeyAtom("app:workspacesidebar")) ?? false;
    const autoSizeTabs = useAtomValue(env.getSettingsKeyAtom("tab:autosize")) ?? false;
    const [tabsTotalWidth, setTabsTotalWidth] = useState(0);
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);

    let prevDelta: number;
    let prevDragDirection: string;

    // Update refs when tabIds change
    useEffect(() => {
        tabRefs.current = tabIds.map((_, index) => tabRefs.current[index] || createRef());
    }, [tabIds]);

    useEffect(() => {
        if (!workspace) {
            return;
        }
        const newTabIdsArr = workspace.tabids ?? [];

        const areEqual = strArrayIsEqual(tabIds, newTabIdsArr);

        if (!areEqual) {
            setTabIds(newTabIdsArr);
        }
    }, [workspace, tabIds]);

    const getWidthForId = (tabId: string) => tabWidthsRef.current[tabId] ?? tabWidthRef.current;

    const getTotalWidth = (ids: string[]) => ids.reduce((acc, id) => acc + getWidthForId(id), 0);

    const getOffsetForIndex = (ids: string[], index: number) => getTotalWidth(ids.slice(0, index));

    // Measured on a canvas rather than by reflowing the real element. .name is absolutely positioned
    // and stretched across the tab, so it has no intrinsic width to read; the alternative is widening
    // it to max-content per tab per layout pass, which both thrashes layout and risks leaving a live
    // element mid-edit in a mutated state.
    const measureNaturalTabWidth = (tabEl: HTMLElement): number => {
        const nameEl = tabEl.querySelector<HTMLElement>(".name");
        if (nameEl == null) {
            return TabDefaultWidth;
        }
        const ctx = measureCtxRef.current;
        if (ctx == null) {
            return TabDefaultWidth;
        }
        const style = getComputedStyle(nameEl);
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const textWidth = ctx.measureText(nameEl.textContent ?? "").width;
        return Math.max(TabAutoMinWidth, textWidth + TabAutoChrome);
    };

    const saveTabsPosition = useCallback(() => {
        const tabs = tabRefs.current;
        if (tabs === null) return;

        const newStartPositions: number[] = [];
        let cumulativeLeft = 0; // Start from the left edge

        tabRefs.current.forEach((ref) => {
            if (ref.current) {
                newStartPositions.push(cumulativeLeft);
                cumulativeLeft += ref.current.getBoundingClientRect().width; // Add each tab's actual width to the cumulative position
            }
        });

        setDragStartPositions(newStartPositions);
    }, []);

    const setSizeAndPosition = (animate?: boolean) => {
        const tabBar = tabBarRef.current;
        if (tabBar === null) return;

        const getOuterWidth = (el: HTMLElement): number => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
        };

        const tabbarWrapperWidth = tabbarWrapperRef.current.getBoundingClientRect().width;
        const windowDragLeftWidth = draggerLeftRef.current.getBoundingClientRect().width;
        const rightContainerWidth = rightContainerRef.current?.getBoundingClientRect().width ?? 0;
        const addBtnWidth = getOuterWidth(addBtnRef.current);
        const appMenuButtonWidth = appMenuButtonRef.current?.getBoundingClientRect().width ?? 0;
        const workspaceSwitcherWidth = workspaceSwitcherRef.current?.getBoundingClientRect().width ?? 0;
        const waveAIButtonWidth =
            !hideAiButton && waveAIButtonRef.current != null ? getOuterWidth(waveAIButtonRef.current) : 0;

        const nonTabElementsWidth =
            windowDragLeftWidth +
            rightContainerWidth +
            addBtnWidth +
            appMenuButtonWidth +
            workspaceSwitcherWidth +
            waveAIButtonWidth;
        const spaceForTabs = tabbarWrapperWidth - nonTabElementsWidth;

        const numberOfTabs = tabIds.length;

        // Compute the ideal width per tab by dividing the available space by the number of tabs
        let idealTabWidth = spaceForTabs / numberOfTabs;

        // Apply min/max constraints
        idealTabWidth = Math.max(TabMinWidth, Math.min(idealTabWidth, TabDefaultWidth));

        // Still needed under autosize: it is the fallback width for any tab not yet measured.
        if (idealTabWidth !== tabWidthRef.current) {
            tabWidthRef.current = idealTabWidth;
        }

        // Resolved by tab id rather than array position. handleMouseMove splices tabIds in place
        // during a drag while tabRefs keeps its original order, so tabRefs[i] and tabIds[i] can
        // describe different tabs -- any relayout mid-drag would then write each tab's width and
        // offset onto a different tab.
        const elemById = new Map<string, HTMLDivElement>();
        tabRefs.current.forEach((ref) => {
            const refTabId = ref.current?.dataset.tabId;
            if (refTabId != null) {
                elemById.set(refTabId, ref.current);
            }
        });

        // TabV marks the name it is editing with .focused. Reading it from the DOM avoids threading
        // rename state up through every tab just so the bar can size one of them.
        const editingIndex = tabIds.findIndex((id) => elemById.get(id)?.querySelector(".name.focused") != null);

        const widths: Record<string, number> = {};
        if (autoSizeTabs) {
            const naturals = tabIds.map((id) => {
                const el = elemById.get(id);
                return el == null ? TabDefaultWidth : measureNaturalTabWidth(el);
            });
            const fitted = fitTabWidths(naturals, spaceForTabs, TabAutoMinWidth, editingIndex);
            tabIds.forEach((id, index) => {
                widths[id] = fitted[index];
            });
        } else if (editingIndex >= 0) {
            // Applies with autosize off too. Typing into a tab you cannot read is the same problem
            // either way, and the widening lasts only as long as the rename does.
            const editingTabId = tabIds[editingIndex];
            const editingEl = elemById.get(editingTabId);
            if (editingEl != null) {
                widths[editingTabId] = Math.min(
                    Math.max(idealTabWidth, measureNaturalTabWidth(editingEl)),
                    Math.max(idealTabWidth, spaceForTabs)
                );
            }
        }
        tabWidthsRef.current = widths;

        const totalWidth = getTotalWidth(tabIds);

        // Determine if the tab bar needs to be scrollable
        const newScrollable = totalWidth > spaceForTabs;

        // Apply the calculated width and position to all tabs
        let layoutOffset = 0;
        tabIds.forEach((id) => {
            const el = elemById.get(id);
            const width = getWidthForId(id);
            if (el != null) {
                if (animate) {
                    el.classList.add("animate");
                } else {
                    el.classList.remove("animate");
                }
                el.style.width = `${width}px`;
                el.style.transform = `translate3d(${layoutOffset}px,0,0)`;
                el.style.opacity = "1";
            }
            layoutOffset += width;
        });

        // Second pass on purpose. .name is centred, and centred text with text-overflow clips at
        // both ends, so a name wider than its tab renders as little more than the ellipsis -- it
        // reads as a blank tab. Reading scrollWidth forces a reflow, so it has to happen after every
        // width above is set, or each tab would trigger its own layout.
        //
        // A data attribute, not a class: React renders .name's className (it flips `focused` on
        // every rename), so it would rewrite the attribute and silently drop a class added here.
        // React does not manage attributes it never rendered, so this one survives.
        tabRefs.current.forEach((ref) => {
            const nameEl = ref.current?.querySelector<HTMLElement>(".name");
            if (nameEl != null) {
                nameEl.dataset.overflowing = String(nameEl.scrollWidth > nameEl.clientWidth + 1);
            }
        });

        setTabsTotalWidth(totalWidth);

        // Update the state with the new scrollable state if it has changed
        if (newScrollable !== scrollableRef.current) {
            scrollableRef.current = newScrollable;
        }

        // Initialize/destroy overlay scrollbars
        if (newScrollable) {
            osInstanceRef.current = OverlayScrollbars(tabBarRef.current, { ...(OSOptions as any) });
        } else {
            if (osInstanceRef.current) {
                osInstanceRef.current.destroy();
            }
        }
    };

    const saveTabsPositionDebounced = useCallback(
        debounce(100, () => saveTabsPosition()),
        [saveTabsPosition]
    );

    const handleResizeTabs = useCallback(() => {
        setSizeAndPosition();
        saveTabsPositionDebounced();
    }, [tabIds, newTabId, isFullScreen, autoSizeTabs, workspaceSidebarEnabled]);

    // update layout on reinit version
    const reinitVersion = useAtomValue(env.atoms.reinitVersion);
    useEffect(() => {
        if (reinitVersion > 0) {
            setSizeAndPosition();
        }
    }, [reinitVersion]);

    // update layout on resize
    useEffect(() => {
        window.addEventListener("resize", handleResizeTabs);
        return () => {
            window.removeEventListener("resize", handleResizeTabs);
        };
    }, [handleResizeTabs]);

    // update layout on changed tabIds, tabsLoaded, newTabId, hideAiButton, appUpdateStatus, or zoomFactor
    useEffect(() => {
        // Check if all tabs are loaded
        const allLoaded = tabIds.length > 0 && tabIds.every((id) => tabsLoaded[id]);
        if (allLoaded) {
            setSizeAndPosition(false);
            saveTabsPosition();
            if (!prevAllLoadedRef.current) {
                prevAllLoadedRef.current = true;
            }
        }
        // noTabs is load-bearing here. Tabs start at opacity 0 and are only revealed by
        // setSizeAndPosition, and they unmount entirely while the left tab bar is active. On the way
        // back, handleTabLoaded sees tabsLoaded[tabId] already true from the previous mount and
        // returns prev unchanged, so nothing else in this list changes and the freshly mounted tabs
        // are never positioned -- they stay invisible until TabBar remounts on a workspace switch.
    }, [
        tabIds,
        tabsLoaded,
        newTabId,
        saveTabsPosition,
        hideAiButton,
        appUpdateStatus,
        zoomFactor,
        showMenuBar,
        noTabs,
        autoSizeTabs,
        // Toggling the sidebar mounts/unmounts the switcher, which changes workspaceSwitcherWidth
        // and therefore spaceForTabs.
        workspaceSidebarEnabled,
    ]);

    const getDragDirection = (currentX: number) => {
        let dragDirection: string;
        if (currentX - prevDelta > 0) {
            dragDirection = "+";
        } else if (currentX - prevDelta === 0) {
            dragDirection = prevDragDirection;
        } else {
            dragDirection = "-";
        }
        prevDelta = currentX;
        prevDragDirection = dragDirection;
        return dragDirection;
    };

    // Slot boundaries are derived from the live tabIds and current widths, never from
    // dragStartPositions. tabIds is spliced in place as the drag progresses, so index i means "slot i
    // right now", while dragStartPositions still describes the pre-drag layout. With uniform widths
    // the two agreed by coincidence -- slot i was always at i * width -- which is why mixing them was
    // invisible until tabs could differ in width, at which point the hit-test compares against the
    // wrong edges and tabs churn into each other.
    const getNewTabIndex = (currentX: number, tabIndex: number, dragDirection: string) => {
        let newTabIndex = tabIndex;
        const draggedWidth = getWidthForId(tabIds[tabIndex]);
        let slotOffset = 0;
        const slotStarts = tabIds.map((id) => {
            const start = slotOffset;
            slotOffset += getWidthForId(id);
            return start;
        });
        if (dragDirection === "+") {
            // Dragging to the right: the dragged tab's right edge passes a neighbour's midpoint.
            for (let i = tabIndex + 1; i < tabIds.length; i++) {
                if (currentX + draggedWidth > slotStarts[i] + getWidthForId(tabIds[i]) / 2) {
                    newTabIndex = i;
                }
            }
        } else {
            // Dragging to the left: the dragged tab's left edge passes a neighbour's midpoint.
            for (let i = tabIndex - 1; i >= 0; i--) {
                if (currentX < slotStarts[i] + getWidthForId(tabIds[i]) / 2) {
                    newTabIndex = i;
                }
            }
        }
        return newTabIndex;
    };

    const handleMouseMove = (event: MouseEvent) => {
        const { tabId, ref, tabStartX } = draggingTabDataRef.current;

        let initialOffsetX = draggingTabDataRef.current.initialOffsetX;
        let totalScrollOffset = draggingTabDataRef.current.totalScrollOffset;
        if (initialOffsetX === null) {
            initialOffsetX = event.clientX - tabStartX;
            draggingTabDataRef.current.initialOffsetX = initialOffsetX;
        }
        let currentX = event.clientX - initialOffsetX - totalScrollOffset;
        let tabBarRectWidth = tabBarRef.current.getBoundingClientRect().width;
        // for macos, it's offset to make space for the window buttons
        const tabBarRectLeftOffset = tabBarRef.current.getBoundingClientRect().left;
        const incrementDecrement = tabBarRectLeftOffset * 0.05;
        const dragDirection = getDragDirection(currentX);
        const scrollable = scrollableRef.current;
        const draggedWidth = getWidthForId(tabId);

        // Scroll the tab bar if the dragged tab overflows the container bounds
        if (scrollable) {
            const { viewport } = osInstanceRef.current.elements();
            const currentScrollLeft = viewport.scrollLeft;

            if (event.clientX <= tabBarRectLeftOffset) {
                viewport.scrollLeft = Math.max(0, currentScrollLeft - incrementDecrement); // Scroll left
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset += currentScrollLeft - viewport.scrollLeft;
                }
            } else if (event.clientX >= tabBarRectWidth + tabBarRectLeftOffset) {
                viewport.scrollLeft = Math.min(viewport.scrollWidth, currentScrollLeft + incrementDecrement); // Scroll right
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset -= viewport.scrollLeft - currentScrollLeft;
                }
            }
        }

        // Re-calculate currentX after potential scroll adjustment
        initialOffsetX = draggingTabDataRef.current.initialOffsetX;
        totalScrollOffset = draggingTabDataRef.current.totalScrollOffset;
        currentX = event.clientX - initialOffsetX - totalScrollOffset;

        setDraggingTab((prev) => (prev !== tabId ? tabId : prev));

        // Check if the tab has moved 5 pixels
        if (Math.abs(currentX - tabStartX) >= 50) {
            draggingTabDataRef.current.dragged = true;
        }

        // Constrain movement within the container bounds
        if (tabBarRef.current) {
            const numberOfTabs = tabIds.length;
            const totalDefaultTabWidth = autoSizeTabs ? getTotalWidth(tabIds) : numberOfTabs * TabDefaultWidth;
            if (totalDefaultTabWidth < tabBarRectWidth) {
                // Set to the total default tab width if there's vacant space
                tabBarRectWidth = totalDefaultTabWidth;
            } else if (scrollable) {
                // Set to the scrollable width if the tab bar is scrollable
                tabBarRectWidth = tabsWrapperRef.current.scrollWidth;
            }

            const minLeft = 0;
            const maxRight = tabBarRectWidth - draggedWidth;

            // Adjust currentX to stay within bounds
            currentX = Math.min(Math.max(currentX, minLeft), maxRight);
        }

        ref.current!.style.transform = `translate3d(${currentX}px,0,0)`;
        ref.current!.style.zIndex = "100";

        const tabIndex = draggingTabDataRef.current.tabIndex;
        const newTabIndex = getNewTabIndex(currentX, tabIndex, dragDirection);

        if (newTabIndex !== tabIndex) {
            // Remove the dragged tab if not already done
            if (!draggingRemovedRef.current) {
                tabIds.splice(tabIndex, 1);
                draggingRemovedRef.current = true;
            }

            // Find current index of the dragged tab in tempTabs
            const currentIndexOfDraggingTab = tabIds.indexOf(tabId);

            // Move the dragged tab to its new position
            if (currentIndexOfDraggingTab !== -1) {
                tabIds.splice(currentIndexOfDraggingTab, 1);
            }
            tabIds.splice(newTabIndex, 0, tabId);

            // Update visual positions of the tabs
            let reflowOffset = 0;
            tabIds.forEach((localTabId) => {
                const ref = tabRefs.current.find((ref) => ref.current.dataset.tabId === localTabId);
                if (ref.current && localTabId !== tabId) {
                    ref.current.style.transform = `translate3d(${reflowOffset}px,0,0)`;
                    ref.current.classList.add("animate");
                }
                reflowOffset += getWidthForId(localTabId);
            });

            draggingTabDataRef.current.tabIndex = newTabIndex;
        }
    };

    const setUpdatedTabsDebounced = useCallback(
        debounce(300, (tabIds: string[]) => {
            // Reset styles
            tabRefs.current.forEach((ref) => {
                ref.current.style.zIndex = "0";
                ref.current.classList.remove("animate");
            });
            // Reset dragging state
            setDraggingTab(null);
            // Update workspace tab ids
            fireAndForget(() => env.rpc.UpdateWorkspaceTabIdsCommand(TabRpcClient, workspace.oid, tabIds));
        }),
        []
    );

    const handleMouseUp = (_event: MouseEvent) => {
        const { tabIndex, dragged } = draggingTabDataRef.current;

        // Update the final position of the dragged tab
        const draggingTab = tabIds[tabIndex];
        const finalLeftPosition = getOffsetForIndex(tabIds, tabIndex);
        const ref = tabRefs.current.find((ref) => ref.current.dataset.tabId === draggingTab);
        if (ref.current) {
            ref.current.classList.add("animate");
            ref.current.style.transform = `translate3d(${finalLeftPosition}px,0,0)`;
        }

        if (dragged) {
            setUpdatedTabsDebounced(tabIds);
        } else {
            // Reset styles
            tabRefs.current.forEach((ref) => {
                ref.current.style.zIndex = "0";
                ref.current.classList.remove("animate");
            });
            // Reset dragging state
            setDraggingTab(null);
        }

        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("mousemove", handleMouseMove);
        draggingRemovedRef.current = false;
    };

    const handleDragStart = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>, tabId: string, ref: React.RefObject<HTMLDivElement>) => {
            if (event.button !== 0) return;

            const tabIndex = tabIds.indexOf(tabId);
            // Derived from the live widths rather than dragStartPositions. The first mousemove
            // anchors the drag with initialOffsetX = clientX - tabStartX, so if tabStartX disagrees
            // with where the tab is actually sitting the tab snaps to the stale position the instant
            // you start dragging. Under uniform widths the two always agreed; under autosize they
            // only agree until something re-lays-out.
            const tabStartX = getOffsetForIndex(tabIds, tabIndex); // Starting X position of the tab

            console.log("handleDragStart", tabId, tabIndex, tabStartX);
            if (ref.current) {
                draggingTabDataRef.current = {
                    tabId: ref.current.dataset.tabId,
                    ref,
                    tabStartX,
                    tabIndex,
                    tabStartIndex: tabIndex,
                    initialOffsetX: null,
                    totalScrollOffset: 0,
                    dragged: false,
                };

                document.addEventListener("mousemove", handleMouseMove);
                document.addEventListener("mouseup", handleMouseUp);
            }
        },
        // autoSizeTabs matters because the handleMouseMove registered here closes over it for the
        // drag clamp; without it a stale closure clamps against the wrong total width.
        [tabIds, dragStartPositions, autoSizeTabs]
    );

    const handleSelectTab = (tabId: string) => {
        if (!draggingTabDataRef.current.dragged) {
            env.electron.setActiveTab(tabId);
        }
    };

    const updateScrollDebounced = useCallback(
        debounce(30, () => {
            if (scrollableRef.current) {
                const { viewport } = osInstanceRef.current.elements();
                viewport.scrollLeft = tabsTotalWidth || tabIds.length * tabWidthRef.current;
            }
        }),
        [tabIds]
    );

    const setNewTabIdDebounced = useCallback(
        debounce(100, (tabId: string) => {
            setNewTabId(tabId);
        }),
        []
    );

    const handleAddTab = () => {
        env.electron.createTab();
        tabsWrapperRef.current.style.setProperty("--tabs-wrapper-transition", "width 0.1s ease");

        updateScrollDebounced();

        setNewTabIdDebounced(null);
    };

    const handleCloseTab = (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null, tabId: string) => {
        event?.stopPropagation();
        env.electron
            .closeTab(workspace.oid, tabId, confirmClose)
            .then((didClose) => {
                if (didClose) {
                    tabsWrapperRef.current?.style.setProperty("--tabs-wrapper-transition", "width 0.3s ease");
                    deleteLayoutModelForTab(tabId);
                }
            })
            .catch((e) => {
                console.log("error closing tab", e);
            });
    };

    const handleTabLoaded = useCallback((tabId: string) => {
        setTabsLoaded((prev) => {
            if (!prev[tabId]) {
                // Only update if the tab isn't already marked as loaded
                return { ...prev, [tabId]: true };
            }
            return prev;
        });
    }, []);

    const activeTabIndex = tabIds.indexOf(activeTabId);
    const tabOrefs = useMemo(() => tabIds.map((id) => makeORef("tab", id)), [tabIds]);
    const activityAlphas = useActivityAlphas(tabOrefs);

    function onEllipsisClick() {
        env.electron.showWorkspaceAppMenu(workspace.oid);
    }

    const tabsWrapperWidth = tabsTotalWidth || tabIds.length * tabWidthRef.current;
    const showAppMenuButton = env.isWindows() || (!env.isMacOS() && !showMenuBar);

    // Calculate window drag left width based on platform and state
    let windowDragLeftWidth = 10;
    if (env.isMacOS() && !isFullScreen) {
        const trafficLightsWidth = isMacOSTahoeOrLater() ? MacOSTahoeTrafficLightsWidth : MacOSTrafficLightsWidth;
        if (zoomFactor > 0) {
            windowDragLeftWidth = trafficLightsWidth / zoomFactor;
        } else {
            windowDragLeftWidth = trafficLightsWidth;
        }
    }

    // Calculate window drag right width
    let windowDragRightWidth = 12;
    if (env.isWindows()) {
        if (zoomFactor > 0) {
            windowDragRightWidth = 139 / zoomFactor;
        } else {
            windowDragRightWidth = 139;
        }
    }

    return (
        <div ref={tabbarWrapperRef} className="tab-bar-wrapper">
            <div
                ref={draggerLeftRef}
                className="h-full shrink-0 z-window-drag"
                style={{ width: windowDragLeftWidth, WebkitAppRegion: "drag" } as any}
            />
            {showAppMenuButton && (
                <div
                    ref={appMenuButtonRef}
                    className="flex items-center justify-center pr-1.5 text-[26px] select-none cursor-pointer text-secondary hover:text-primary"
                    style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                    onClick={onEllipsisClick}
                >
                    <i className="fa fa-ellipsis" />
                </div>
            )}
            <WaveAIButton divRef={waveAIButtonRef} />
            {!workspaceSidebarEnabled && (
                <Tooltip
                    content="Workspace Switcher"
                    placement="bottom"
                    hideOnClick
                    divRef={workspaceSwitcherRef}
                    divClassName="flex items-center"
                >
                    <WorkspaceSwitcher />
                </Tooltip>
            )}
            <div className="tab-bar" ref={tabBarRef} data-overlayscrollbars-initialize>
                <div
                    className="tabs-wrapper"
                    ref={tabsWrapperRef}
                    onInput={() => setSizeAndPosition()}
                    // Ends the rename-expand. Blur and Escape both set innerText programmatically,
                    // which fires no input event, and the tab name round-trips through an RPC that
                    // never re-renders TabBar -- so without this the widened tab stays widened (and
                    // under autosize its neighbours stay squeezed) until an unrelated relayout.
                    // Deferred a frame so the .focused class is gone before widths are recomputed.
                    onBlur={() => requestAnimationFrame(() => setSizeAndPosition())}
                    style={{
                        width: noTabs ? 0 : tabsWrapperWidth,
                        ...(noTabs ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : {}),
                    }}
                >
                    {!noTabs &&
                        tabIds.map((tabId, index) => {
                            const isActive = activeTabId === tabId;
                            const showDivider = index !== 0 && !isActive && index !== activeTabIndex + 1;
                            return (
                                <Tab
                                    key={tabId}
                                    ref={tabRefs.current[index]}
                                    id={tabId}
                                    showDivider={showDivider}
                                    onSelect={() => handleSelectTab(tabId)}
                                    active={isActive}
                                    onDragStart={(event) => handleDragStart(event, tabId, tabRefs.current[index])}
                                    onClose={(event) => handleCloseTab(event, tabId)}
                                    onLoaded={() => handleTabLoaded(tabId)}
                                    isDragging={draggingTab === tabId}
                                    tabWidth={getWidthForId(tabId)}
                                    isNew={tabId === newTabId}
                                    activityAlpha={activityAlphas[makeORef("tab", tabId)]}
                                />
                            );
                        })}
                </div>
            </div>
            <button
                ref={addBtnRef}
                title="Add Tab"
                className={`flex h-[22px] px-2 mb-1 mx-1 items-center rounded-md box-border cursor-pointer hover:bg-hoverbg transition-colors text-[12px] text-secondary hover:text-primary${noTabs ? " invisible" : ""}`}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={handleAddTab}
            >
                <i className="fa fa-solid fa-plus" />
            </button>
            <div className="flex-1" />
            <div ref={rightContainerRef} className="flex flex-row gap-1 items-end">
                <UpdateStatusBanner />
                <div
                    className="h-full shrink-0 z-window-drag"
                    style={{ width: windowDragRightWidth, WebkitAppRegion: "drag" } as any}
                />
            </div>
        </div>
    );
});

export { TabBar, WaveAIButton };
