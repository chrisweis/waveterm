// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getOrefMetaKeyAtom } from "@/store/global";
import * as jotai from "jotai";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The order lives on the client rather than on each workspace so the sidebar and the switcher agree
// on one sequence, and so switching workspaces never reshuffles the list out from under the pointer.
const workspaceOrderAtom = jotai.atom<string[]>((get) => {
    const clientId = ClientModel.getInstance().clientId;
    if (clientId == null) {
        return [];
    }
    return get(getOrefMetaKeyAtom(WOS.makeORef("client", clientId), "layout:workspaceorder")) ?? [];
});

// Ids the saved order has never seen (workspaces created since the last drag) keep their incoming
// relative order and land at the end, rather than jumping to the top. With no saved order at all the
// backend's own sequence is preserved untouched.
export function applyWorkspaceOrder(ids: string[], order: string[]): string[] {
    if (order.length === 0) {
        return ids;
    }
    const present = new Set(ids);
    const known = order.filter((id) => present.has(id));
    const knownSet = new Set(known);
    return [...known, ...ids.filter((id) => !knownSet.has(id))];
}

function persistWorkspaceOrder(ids: string[]): Promise<void> {
    const clientId = ClientModel.getInstance().clientId;
    if (clientId == null) {
        return Promise.reject(new Error("no clientId"));
    }
    return RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("client", clientId),
        meta: { "layout:workspaceorder": ids },
    });
}

type DragItemProps = {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
};

type DragContainerProps = {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
};

export type WorkspaceReorder<T> = {
    ordered: T[];
    dragId: string;
    // A drop line is drawn inside the row itself rather than absolutely positioned over the list:
    // the two call sites scroll differently, and offsetTop math has to agree with the offset parent.
    dropBefore: (index: number) => boolean;
    dropAfter: (index: number) => boolean;
    dragItemProps: (index: number) => DragItemProps;
    dragContainerProps: DragContainerProps;
};

export function useWorkspaceReorder<T>(items: T[], getId: (item: T) => string): WorkspaceReorder<T> {
    const savedOrder = useAtomValue(workspaceOrderAtom);
    // Held only until the write round-trips. SetMetaCommand is fast but not instant, and snapping
    // back to the old order for a frame after the drop reads as a failed drag.
    const [pendingOrder, setPendingOrder] = useState<string[]>(null);
    const [dragId, setDragId] = useState<string>(null);
    const [dropIndex, setDropIndex] = useState<number>(null);
    const dragIdRef = useRef<string>(null);

    const savedKey = savedOrder.join(",");
    useEffect(() => {
        setPendingOrder(null);
    }, [savedKey]);

    const ordered = useMemo(() => {
        const byId = new Map(items.map((item) => [getId(item), item]));
        return applyWorkspaceOrder([...byId.keys()], pendingOrder ?? savedOrder).map((id) => byId.get(id));
    }, [items, pendingOrder, savedKey]);

    const clearDrag = useCallback(() => {
        dragIdRef.current = null;
        setDragId(null);
        setDropIndex(null);
    }, []);

    const commitDrop = useCallback(
        (targetIndex: number) => {
            const sourceId = dragIdRef.current;
            if (sourceId == null || targetIndex == null) {
                return;
            }
            const ids = ordered.map(getId);
            const sourceIndex = ids.indexOf(sourceId);
            if (sourceIndex === -1) {
                return;
            }
            const bounded = Math.max(0, Math.min(targetIndex, ids.length));
            // Removing the source first shifts everything after it up by one, so a downward move
            // has to aim one slot short of where the drop line was drawn.
            const adjusted = sourceIndex < bounded ? bounded - 1 : bounded;
            if (sourceIndex === adjusted) {
                return;
            }
            const next = [...ids];
            const [moved] = next.splice(sourceIndex, 1);
            next.splice(adjusted, 0, moved);
            setPendingOrder(next);
            // Drop the optimistic order if the write never lands, rather than showing an order that
            // was never persisted until some unrelated change to client meta happens to clear it.
            persistWorkspaceOrder(next).catch(() => setPendingOrder(null));
        },
        [ordered]
    );

    const dragItemProps = useCallback(
        (index: number): DragItemProps => ({
            draggable: true,
            onDragStart: (e: React.DragEvent) => {
                const id = getId(ordered[index]);
                dragIdRef.current = id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
                setDragId(id);
                setDropIndex(index);
            },
            // Guarding on dragIdRef keeps unrelated drags (a file dropped onto the window, a tab from
            // the tab bar) from painting a drop line in a list they can't reorder.
            onDragOver: (e: React.DragEvent) => {
                if (dragIdRef.current == null) {
                    return;
                }
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const insertBefore = e.clientY - rect.top < rect.height / 2;
                setDropIndex(insertBefore ? index : index + 1);
            },
            onDrop: (e: React.DragEvent) => {
                if (dragIdRef.current == null) {
                    return;
                }
                e.preventDefault();
                commitDrop(dropIndex);
                clearDrag();
            },
            onDragEnd: clearDrag,
        }),
        [ordered, dropIndex, commitDrop, clearDrag]
    );

    const dragContainerProps: DragContainerProps = {
        onDragOver: (e: React.DragEvent) => {
            if (dragIdRef.current == null) {
                return;
            }
            e.preventDefault();
            if (e.target === e.currentTarget) {
                setDropIndex(ordered.length);
            }
        },
        onDrop: (e: React.DragEvent) => {
            if (dragIdRef.current == null) {
                return;
            }
            e.preventDefault();
            commitDrop(dropIndex);
            clearDrag();
        },
    };

    return {
        ordered,
        dragId,
        dropBefore: (index: number) => dragId != null && dropIndex === index,
        dropAfter: (index: number) => dragId != null && index === ordered.length - 1 && dropIndex === ordered.length,
        dragItemProps,
        dragContainerProps,
    };
}
