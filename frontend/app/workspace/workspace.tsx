// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { isBuilderWindow } from "@/app/store/windowtype";
import { makeORef } from "@/app/store/wos";
import { ActivityDwellMs, recordActivity } from "@/app/tab/activityglow";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { VTabBar } from "@/app/tab/vtabbar";
import { WorkspaceSidebar, WorkspaceSidebarResizeHandle } from "@/app/tab/workspacesidebar";
import { WorkspaceSidebarModel } from "@/app/tab/workspacesidebar-model";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms, getApi, getSettingsKeyAtom } from "@/store/global";
import { isMacOS } from "@/util/platformutil";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const MacOSTabBarSpacer = memo(() => {
    return (
        <div
            className="w-full shrink-0"
            style={
                {
                    height: "calc(8px * var(--zoomfactor-inv))",
                    WebkitAppRegion: "drag",
                    backdropFilter: "blur(20px)",
                    background: "rgba(0, 0, 0, 0.35)",
                } as React.CSSProperties
            }
        />
    );
});
MacOSTabBarSpacer.displayName = "MacOSTabBarSpacer";

const WorkspaceElem = memo(() => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const tabBarPosition = useAtomValue(getSettingsKeyAtom("app:tabbar")) ?? "top";
    const showLeftTabBar = tabBarPosition === "left";
    const sidebarEnabled = useAtomValue(getSettingsKeyAtom("app:workspacesidebar")) ?? false;
    const sidebarWidth = useAtomValue(WorkspaceSidebarModel.getInstance().widthAtom);
    const showWorkspaceSidebar = sidebarEnabled && !isBuilderWindow();
    const isFullScreen = useAtomValue(atoms.isFullScreen);
    // With app:tabbar=left on macOS there is no top TabBar, and VTabBar carries the traffic-light
    // inset in its own header. The sidebar sits left of VTabBar, so without the same inset the
    // traffic lights land on top of its first rows.
    const sidebarNeedsMacInset = showWorkspaceSidebar && showLeftTabBar && isMacOS() && !isFullScreen;
    const aiPanelVisible = useAtomValue(workspaceLayoutModel.panelVisibleAtom);
    const widgetsSidebarVisible = useAtomValue(workspaceLayoutModel.widgetsSidebarVisibleAtom);
    const windowWidth = window.innerWidth;
    const leftGroupInitialPct = workspaceLayoutModel.getLeftGroupInitialPercentage(windowWidth, showLeftTabBar);
    const innerVTabInitialPct = workspaceLayoutModel.getInnerVTabInitialPercentage(windowWidth, showLeftTabBar);
    const innerAIPanelInitialPct = workspaceLayoutModel.getInnerAIPanelInitialPercentage(windowWidth, showLeftTabBar);
    const outerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const innerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const vtabPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);
    const vtabPanelWrapperRef = useRef<HTMLDivElement>(null);

    // Must run before the registerRefs effect below so the first commitLayouts already knows how
    // much width the sidebar is taking away from the panel group.
    useEffect(() => {
        workspaceLayoutModel.setSidebarWidth(showWorkspaceSidebar ? sidebarWidth : 0);
    }, [showWorkspaceSidebar, sidebarWidth]);

    // showLeftTabBar is passed as a seed value only; subsequent changes are handled by setShowLeftTabBar below.
    // Do NOT add showLeftTabBar as a dep here — re-registering refs on config changes would redundantly re-run commitLayouts.
    useEffect(() => {
        if (
            aiPanelRef.current &&
            outerPanelGroupRef.current &&
            innerPanelGroupRef.current &&
            panelContainerRef.current &&
            aiPanelWrapperRef.current
        ) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                outerPanelGroupRef.current,
                innerPanelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current,
                vtabPanelRef.current ?? undefined,
                vtabPanelWrapperRef.current ?? undefined,
                showLeftTabBar
            );
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setWaveAIOpen(isVisible);
    }, []);

    // Recorded even when app:activityglow is off, so switching the setting on shows a meaningful
    // picture immediately instead of an empty one. The dwell delay is what keeps a drive-by tab
    // switch from registering as work.
    useEffect(() => {
        if (tabId === "" || ws?.oid == null) {
            return;
        }
        const timer = setTimeout(() => {
            recordActivity(makeORef("tab", tabId));
            recordActivity(makeORef("workspace", ws.oid));
        }, ActivityDwellMs);
        return () => clearTimeout(timer);
    }, [tabId, ws?.oid]);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    useEffect(() => {
        workspaceLayoutModel.setShowLeftTabBar(showLeftTabBar);
    }, [showLeftTabBar]);

    useEffect(() => {
        const handleFocus = () => workspaceLayoutModel.syncVTabWidthFromMeta();
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    // These handles must be `disabled`, not merely styled to zero width. A hidden-but-enabled
    // PanelResizeHandle still counts as live to react-resizable-panels, which applies its global
    // ew-resize cursor to the whole PanelGroup -- every descendant inherits it, so the terminal and
    // the workspace sidebar both show a resize cursor that resizes nothing.
    const innerHandleVisible = showLeftTabBar && aiPanelVisible;
    const innerHandleClass = `bg-transparent hover:bg-zinc-500/20 transition-colors ${innerHandleVisible ? "w-0.5" : "w-0 pointer-events-none"}`;
    const outerHandleVisible = showLeftTabBar || aiPanelVisible;
    const outerHandleClass = `bg-transparent hover:bg-zinc-500/20 transition-colors ${outerHandleVisible ? "w-0.5" : "w-0 pointer-events-none"}`;

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            {!(showLeftTabBar && isMacOS()) && <TabBar key={ws.oid} workspace={ws} noTabs={showLeftTabBar} />}
            {showLeftTabBar && isMacOS() && <MacOSTabBarSpacer />}
            <div ref={panelContainerRef} className="flex flex-row flex-grow overflow-hidden">
                {showWorkspaceSidebar && (
                    <div className="relative flex h-full shrink-0 flex-col" style={{ width: sidebarWidth }}>
                        {sidebarNeedsMacInset && (
                            <div
                                className="w-full shrink-0"
                                style={
                                    {
                                        height: "calc(25px * var(--zoomfactor-inv))",
                                        WebkitAppRegion: "drag",
                                        backdropFilter: "blur(20px)",
                                        background: "rgba(0, 0, 0, 0.35)",
                                    } as React.CSSProperties
                                }
                            />
                        )}
                        <ErrorBoundary>
                            <div className="min-h-0 flex-1">
                                <WorkspaceSidebar />
                            </div>
                            <WorkspaceSidebarResizeHandle />
                        </ErrorBoundary>
                    </div>
                )}
                <ErrorBoundary key={tabId}>
                    <PanelGroup
                        direction="horizontal"
                        onLayout={workspaceLayoutModel.handleOuterPanelLayout}
                        ref={outerPanelGroupRef}
                    >
                        <Panel order={0} defaultSize={leftGroupInitialPct} className="overflow-hidden">
                            <PanelGroup
                                direction="horizontal"
                                onLayout={workspaceLayoutModel.handleInnerPanelLayout}
                                ref={innerPanelGroupRef}
                            >
                                <Panel
                                    ref={vtabPanelRef}
                                    collapsible
                                    defaultSize={innerVTabInitialPct}
                                    order={0}
                                    className="overflow-hidden"
                                >
                                    <div ref={vtabPanelWrapperRef} className="w-full h-full">
                                        {showLeftTabBar && <VTabBar workspace={ws} />}
                                    </div>
                                </Panel>
                                <PanelResizeHandle className={innerHandleClass} disabled={!innerHandleVisible} />
                                <Panel
                                    ref={aiPanelRef}
                                    collapsible
                                    defaultSize={innerAIPanelInitialPct}
                                    order={1}
                                    className="overflow-hidden"
                                >
                                    <div
                                        ref={aiPanelWrapperRef}
                                        className={`w-full h-full pr-0.5 ${aiPanelVisible ? "" : "opacity-0"}`}
                                    >
                                        {tabId !== "" && <AIPanel roundTopLeft={showLeftTabBar} />}
                                    </div>
                                </Panel>
                            </PanelGroup>
                        </Panel>
                        <PanelResizeHandle className={outerHandleClass} disabled={!outerHandleVisible} />
                        <Panel order={1} defaultSize={100 - leftGroupInitialPct}>
                            {tabId === "" ? (
                                <CenteredDiv>No Active Tab</CenteredDiv>
                            ) : (
                                <div className="flex flex-row h-full">
                                    <TabContent key={tabId} tabId={tabId} noTopPadding={showLeftTabBar && isMacOS()} />
                                    {widgetsSidebarVisible && <Widgets />}
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
