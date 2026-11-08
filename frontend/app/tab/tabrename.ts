// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect } from "react";

const PendingRenameKey = "wave:pendingtabrename";
// Long enough to cover building a fresh tab view on a busy machine, short enough that a request
// nobody picked up can never fire on some later, unrelated switch to that tab.
const PendingRenameTtlMs = 5000;

type PendingRename = {
    tabid: string;
    ts: number;
};

// Every tab is its own renderer, and each renderer draws the whole tab bar. Double-clicking any
// tab but this view's own means the first click has already started swapping the window over to
// that tab's view -- and right after "+" the new tab shows up here well before its view is ready.
// Editing here would leave the rename in a view that is about to be hidden while the keystrokes
// land in the new view (its terminal). localStorage is shared by all views (same origin) and
// raises `storage` in the others, so the request is handed to the view that owns the tab.
export function requestTabRename(tabId: string) {
    try {
        localStorage.setItem(PendingRenameKey, JSON.stringify({ tabid: tabId, ts: Date.now() }));
    } catch {
        // storage unavailable: the double-click is dropped, which is still better than a stray edit
    }
}

function takePendingRename(tabId: string): boolean {
    try {
        const raw = localStorage.getItem(PendingRenameKey);
        if (raw == null) {
            return false;
        }
        const pending = JSON.parse(raw) as PendingRename;
        if (pending?.tabid !== tabId) {
            return false;
        }
        localStorage.removeItem(PendingRenameKey);
        return Date.now() - pending.ts < PendingRenameTtlMs;
    } catch {
        return false;
    }
}

export function useForwardedTabRename(tabId: string, active: boolean, startRename: () => void) {
    useEffect(() => {
        if (!active) {
            return;
        }
        // Gated on visibility because the request can arrive before the window has swapped this
        // view in; it is picked up on the visibilitychange instead of being consumed while hidden.
        const check = () => {
            if (document.visibilityState !== "visible") {
                return;
            }
            if (takePendingRename(tabId)) {
                startRename();
            }
        };
        const onStorage = (e: StorageEvent) => {
            if (e.key === PendingRenameKey) {
                check();
            }
        };
        check();
        window.addEventListener("storage", onStorage);
        document.addEventListener("visibilitychange", check);
        return () => {
            window.removeEventListener("storage", onStorage);
            document.removeEventListener("visibilitychange", check);
        };
    }, [tabId, active, startRename]);
}

// A hidden view never gets a blur -- its element stays document.activeElement -- so a rename left
// open when the window switches tabs would otherwise sit there half-typed until the user happens
// back. Ending it on hide commits it the same way clicking elsewhere does.
export function useEndRenameWhenHidden(isEditable: boolean, editableRef: React.RefObject<HTMLElement>) {
    useEffect(() => {
        if (!isEditable) {
            return;
        }
        const onVisibility = () => {
            if (document.visibilityState === "hidden") {
                editableRef.current?.blur();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, [isEditable, editableRef]);
}
