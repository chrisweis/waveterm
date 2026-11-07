// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { refocusNode, WOS } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import * as jotai from "jotai";
import * as React from "react";

const RecentIconsKey = "blocktitle:recenticons";
const MaxRecentIcons = 8;
const MaxTitleLength = 80;
// stored in frame:icon when the user picked "No icon", so an icon isn't guessed from the title again
export const NoIconSentinel = "none";

export function isNoIcon(icon: string): boolean {
    return icon == null || icon.trim() == "" || icon === NoIconSentinel;
}

export const TitleIconColors = ["#e6e6e6", "#58c142", "#4fa3f7", "#b48ef0", "#f2b33d", "#f07a5a", "#e05a8a", "#3cc6c0"];

const EmojiChoices: [string, string][] = [
    ["🚀", "rocket launch deploy ship"],
    ["🧪", "test tube experiment lab"],
    ["🛠️", "tools build fix hammer wrench"],
    ["📦", "package box release npm"],
    ["🐛", "bug debug"],
    ["🔥", "fire hot urgent prod"],
    ["⚡", "bolt fast power"],
    ["✅", "check done ok"],
    ["❗", "important alert"],
    ["⚠️", "warning caution"],
    ["🎯", "target goal focus"],
    ["🧠", "brain think"],
    ["🤖", "robot ai agent bot claude codex"],
    ["💻", "laptop computer local"],
    ["🖥️", "desktop computer monitor"],
    ["⚙️", "gear settings config"],
    ["🔧", "wrench fix"],
    ["🔒", "lock secure secret"],
    ["🔑", "key auth credentials"],
    ["📁", "folder files"],
    ["📝", "memo notes write edit"],
    ["📊", "chart bar stats data"],
    ["📈", "chart up graph metrics"],
    ["🧰", "toolbox"],
    ["🌐", "globe web network internet"],
    ["☁️", "cloud aws azure gcp"],
    ["🐳", "whale docker container"],
    ["🐍", "snake python"],
    ["🦀", "crab rust"],
    ["🐹", "hamster go golang"],
    ["☕", "coffee java"],
    ["💎", "gem ruby"],
    ["🍎", "apple mac macos"],
    ["🪟", "window windows"],
    ["🐧", "penguin linux"],
    ["🏠", "house home homelab"],
    ["🗄️", "cabinet server storage nas"],
    ["💾", "disk save backup"],
    ["🗃️", "database records"],
    ["📡", "antenna network signal"],
    ["🔌", "plug power connect"],
    ["🔍", "search find magnify"],
    ["📚", "books docs reading"],
    ["📖", "book docs read"],
    ["🧹", "broom cleanup"],
    ["♻️", "recycle refactor"],
    ["⏱️", "stopwatch timer perf"],
    ["⏳", "hourglass waiting long running"],
    ["📅", "calendar date schedule"],
    ["💬", "chat message"],
    ["📧", "email mail"],
    ["💰", "money finance"],
    ["🎨", "art design palette ui"],
    ["🎮", "game controller"],
    ["🎵", "music"],
    ["📷", "camera photo"],
    ["🏒", "hockey"],
    ["⚽", "soccer football"],
    ["🏀", "basketball"],
    ["🌲", "tree forest"],
    ["🌊", "wave water"],
    ["🌙", "moon night"],
    ["☀️", "sun day"],
    ["⭐", "star favorite"],
    ["❤️", "heart love"],
    ["🔴", "red circle"],
    ["🟠", "orange circle"],
    ["🟡", "yellow circle"],
    ["🟢", "green circle"],
    ["🔵", "blue circle"],
    ["🟣", "purple circle"],
    ["⚫", "black circle"],
    ["⚪", "white circle"],
    ["1️⃣", "one 1"],
    ["2️⃣", "two 2"],
    ["3️⃣", "three 3"],
    ["4️⃣", "four 4"],
    ["5️⃣", "five 5"],
];

const IconChoices: [string, string][] = [
    ["terminal", "shell console"],
    ["server", "nas host"],
    ["rocket", "deploy launch"],
    ["flask", "test lab"],
    ["bug", "debug"],
    ["code-branch", "git branch"],
    ["code", "dev source"],
    ["cloud", "aws azure"],
    ["database", "db sql"],
    ["laptop", "local computer"],
    ["house", "home homelab"],
    ["gear", "settings config"],
    ["wrench", "fix tools"],
    ["hammer", "build"],
    ["lock", "secure secret"],
    ["key", "auth"],
    ["folder", "files"],
    ["file-lines", "document notes"],
    ["chart-line", "metrics graph"],
    ["globe", "web network"],
    ["bolt", "fast power"],
    ["fire", "hot prod"],
    ["star", "favorite"],
    ["heart", "love"],
    ["flag", "mark"],
    ["bell", "alert notify"],
    ["book", "docs"],
    ["box", "package"],
    ["cubes", "containers k8s"],
    ["robot", "ai agent bot claude"],
    ["brain", "ai think"],
    ["magnifying-glass", "search find"],
    ["clock", "time schedule"],
    ["list-check", "tasks todo"],
    ["shield-halved", "security"],
    ["network-wired", "network"],
    ["hard-drive", "disk storage"],
    ["microchip", "hardware cpu"],
    ["brands@docker", "docker container"],
    ["brands@python", "python"],
    ["brands@golang", "go golang"],
    ["brands@rust", "rust"],
    ["brands@node-js", "node js javascript"],
    ["brands@react", "react"],
    ["brands@aws", "aws amazon"],
    ["brands@github", "github git"],
    ["brands@apple", "apple mac macos"],
    ["brands@windows", "windows microsoft"],
    ["brands@linux", "linux"],
    ["brands@ubuntu", "ubuntu linux"],
];

// frame:icon holds either a Font Awesome name or an emoji. Only non-ASCII text counts as an emoji, so a mistyped
// icon name in an existing config still falls back to the default icon instead of rendering as a word.
export function isTextIcon(icon: string): boolean {
    if (icon == null || icon.trim() == "") {
        return false;
    }
    return /[^\x00-\x7f]/.test(icon);
}

export function TitleIcon({
    icon,
    color,
    className,
    defaultIcon,
}: {
    icon: string;
    color?: string;
    className?: string;
    defaultIcon?: string;
}) {
    if (icon === NoIconSentinel) {
        return null;
    }
    if (isTextIcon(icon)) {
        return <span className={cn("inline-block shrink-0 leading-none not-italic", className)}>{icon}</span>;
    }
    const iconClass = makeIconClass(icon, true, { defaultIcon });
    if (iconClass == null) {
        return null;
    }
    return <i className={cn(iconClass, "shrink-0", className)} style={color ? { color } : null} />;
}

// Generic markers (status dots, numbers, warnings) are fine to pick by hand but too vague to guess from a title.
const NonGuessableEmoji = new Set([
    "✅",
    "❗",
    "⚠️",
    "⭐",
    "❤️",
    "☀️",
    "🌙",
    "🔴",
    "🟠",
    "🟡",
    "🟢",
    "🔵",
    "🟣",
    "⚫",
    "⚪",
    "1️⃣",
    "2️⃣",
    "3️⃣",
    "4️⃣",
    "5️⃣",
]);

const GuessKeywordToEmoji: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const [emoji, keywords] of EmojiChoices) {
        if (NonGuessableEmoji.has(emoji)) {
            continue;
        }
        for (const kw of keywords.split(" ")) {
            if (kw && !m.has(kw)) {
                m.set(kw, emoji);
            }
        }
    }
    return m;
})();

// Picks an emoji for a title from the picker's own keywords, so "Hockey roster sync" gets 🏒. Returns null when
// nothing matches; the first matching word wins.
export function guessTitleIcon(title: string): string {
    if (!title) {
        return null;
    }
    const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const w of words) {
        const emoji = GuessKeywordToEmoji.get(w);
        if (emoji) {
            return emoji;
        }
    }
    return null;
}

export type ProgramTitle = { name: string; status: string };

// Terminal programs announce a title with the standard OSC 0/2 escape (Claude Code sends "✳ <session name>", and
// its /rename updates it). Shells and ConPTY also send titles that are just a process name or a path; those are
// noise, and one arriving after a program exits is the signal that the program's title no longer applies.
// Returns null for "no program title".
export function parseProgramTitle(raw: string): ProgramTitle {
    const t = (raw ?? "").trim();
    if (!t) {
        return null;
    }
    const isPath = /^[a-zA-Z]:[\\/]/.test(t) || t.startsWith("/") || t.startsWith("~") || t.includes("\\");
    const isProcessName = /^[\w.-]+$/.test(t);
    const isUserAtHost = /^[\w.-]+@[\w.-]+:/.test(t);
    if (isPath || isProcessName || isUserAtHost) {
        return null;
    }
    // a leading symbol followed by a space is a status marker (Claude's ✳ idle / ◐ busy spinner), not part of the name
    const m = t.match(/^([^\p{L}\p{N}\s][\uFE0F]?)\s+(.+)$/u);
    if (m) {
        return { status: m[1], name: m[2].slice(0, MaxTitleLength) };
    }
    return { status: null, name: t.slice(0, MaxTitleLength) };
}

type GraphemeSegmenter = { segment: (text: string) => Iterable<unknown> };
let graphemeSegmenter: GraphemeSegmenter = null;

// tsconfig's lib predates Intl.Segmenter, but every Electron/Chromium build we ship has it
function getGraphemeSegmenter(): GraphemeSegmenter {
    if (graphemeSegmenter == null) {
        graphemeSegmenter = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
    }
    return graphemeSegmenter;
}

// a pasted value only counts as an emoji if it is a single grapheme that renders as a pictograph, so a typed word
// (e.g. "café") can't end up squeezed into the icon slot
function asSingleEmoji(text: string): string {
    const t = text.trim();
    if (!t) {
        return null;
    }
    const graphemes = Array.from(getGraphemeSegmenter().segment(t));
    if (graphemes.length != 1) {
        return null;
    }
    return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(t) ? t : null;
}

// makeIconClass accepts any [a-z0-9-] string, so check the font actually has a glyph for it before offering it
function faIconExists(name: string): boolean {
    const iconClass = makeIconClass(name, false);
    if (iconClass == null) {
        return false;
    }
    const probe = document.createElement("i");
    probe.className = iconClass;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.appendChild(probe);
    const content = getComputedStyle(probe, "::before").content;
    probe.remove();
    return content != null && content !== "none" && content !== "normal" && content !== '""';
}

function readRecentIcons(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RecentIconsKey) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
    } catch {
        return [];
    }
}

function pushRecentIcon(icon: string) {
    if (!icon) {
        return;
    }
    const next = [icon, ...readRecentIcons().filter((i) => i !== icon)].slice(0, MaxRecentIcons);
    try {
        localStorage.setItem(RecentIconsKey, JSON.stringify(next));
    } catch {
        // recents are a convenience only
    }
}

export class BlockTitleModel {
    private static instance: BlockTitleModel | null = null;

    editingBlockIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    isEditingAtomCache = new Map<string, jotai.Atom<boolean>>();

    private constructor() {}

    // per-block so that starting an edit re-renders one header instead of every header in the window
    getIsEditingAtom(blockId: string): jotai.Atom<boolean> {
        let a = this.isEditingAtomCache.get(blockId);
        if (a == null) {
            a = jotai.atom((get) => get(this.editingBlockIdAtom) === blockId);
            this.isEditingAtomCache.set(blockId, a);
        }
        return a;
    }

    static getInstance(): BlockTitleModel {
        if (!BlockTitleModel.instance) {
            BlockTitleModel.instance = new BlockTitleModel();
        }
        return BlockTitleModel.instance;
    }

    startEdit(blockId: string) {
        if (!blockId) {
            return;
        }
        globalStore.set(this.editingBlockIdAtom, blockId);
    }

    stopEdit(blockId: string) {
        if (globalStore.get(this.editingBlockIdAtom) !== blockId) {
            return;
        }
        globalStore.set(this.editingBlockIdAtom, null);
    }

    saveTitle(blockId: string, title: string, icon: string, iconColor: string, prevIcon: string) {
        const cleanTitle = title.trim().slice(0, MaxTitleLength);
        const meta: MetaType = {
            "frame:title": cleanTitle || null,
            "frame:icon": icon || null,
        };
        // icon:color also tints the block's default view icon and its dock entry, so only touch it when a glyph is
        // chosen here, when the glyph whose color it was is being removed, or when title and icon are both cleared
        // (which should restore the block's default look)
        const isGlyph = (i: string) => !isNoIcon(i) && !isTextIcon(i);
        if (isGlyph(icon)) {
            meta["icon:color"] = iconColor || null;
        } else if (isGlyph(prevIcon) || (!icon && !cleanTitle)) {
            meta["icon:color"] = null;
        }
        if (icon) {
            pushRecentIcon(icon);
        }
        const oref = WOS.makeORef("block", blockId);
        fireAndForget(() => RpcApi.SetMetaCommand(TabRpcClient, { oref, meta }));
    }
}

type PickerMode = "emoji" | "icons";

function IconPicker({
    icon,
    iconColor,
    onPick,
    onColor,
    onClose,
    onClearAll,
}: {
    icon: string;
    iconColor: string;
    onPick: (icon: string, color: string, close: boolean) => void;
    onColor: (color: string) => void;
    onClose: () => void;
    onClearAll: () => void;
}) {
    const [mode, setMode] = React.useState<PickerMode>(icon && !isTextIcon(icon) ? "icons" : "emoji");
    const [query, setQuery] = React.useState("");
    const searchRef = React.useRef<HTMLInputElement>(null);
    const recent = React.useMemo(() => readRecentIcons(), []);
    const q = query.trim().toLowerCase();

    React.useEffect(() => {
        searchRef.current?.focus();
    }, [mode]);

    const choices = mode === "emoji" ? EmojiChoices : IconChoices;
    const filtered = q ? choices.filter(([v, kw]) => v.includes(q) || kw.includes(q)) : choices;
    const recentForMode = recent.filter((r) => (mode === "emoji" ? isTextIcon(r) : !isTextIcon(r)));
    // The curated lists are short, so let a typed Font Awesome name or a pasted emoji (e.g. from Win+.) be used directly.
    const custom = React.useMemo(() => {
        if (!q || filtered.length > 0) {
            return null;
        }
        if (mode === "emoji") {
            return asSingleEmoji(query);
        }
        const name = q.replace(/^fa-/, "");
        return faIconExists(name) ? name : null;
    }, [q, mode, filtered.length]);

    const cell = (value: string, key: string) => (
        <button
            key={key}
            type="button"
            title={value}
            className={cn(
                "flex h-8 w-8 cursor-pointer items-center justify-center rounded text-[17px] hover:bg-hover",
                value === icon && "bg-accent/25"
            )}
            onClick={() => onPick(value, iconColor, mode === "emoji")}
        >
            <TitleIcon icon={value} color={mode === "icons" ? iconColor || "var(--main-text-color)" : null} />
        </button>
    );

    return (
        <div
            className="w-[300px] rounded-lg border border-border bg-modalbg p-2.5 text-[12px] shadow-xl"
            data-title-picker="true"
            onKeyDown={(e) => {
                // the picker lives in a portal, so keep its keystrokes away from the global keybindings
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    onClose();
                }
            }}
        >
            <div className="mb-2 flex rounded-md bg-black/30 p-0.5">
                {(["emoji", "icons"] as PickerMode[]).map((m) => (
                    <button
                        key={m}
                        type="button"
                        className={cn(
                            "flex-1 cursor-pointer rounded py-1 transition-colors",
                            mode === m ? "bg-hover font-semibold text-primary" : "text-secondary hover:text-primary"
                        )}
                        onClick={() => {
                            setMode(m);
                            setQuery("");
                        }}
                    >
                        {m === "emoji" ? "Emoji" : "Icons"}
                    </button>
                ))}
            </div>
            <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-black/30 px-2 py-1">
                <i className="fa fa-solid fa-magnifying-glass text-[11px] text-muted" />
                <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode == 229) {
                            return;
                        }
                        e.preventDefault();
                        const first = custom ?? filtered[0]?.[0];
                        if (first) {
                            onPick(first, iconColor, true);
                        }
                    }}
                    placeholder={
                        mode === "emoji" ? "Search or paste an emoji…" : "Search, or type a Font Awesome name…"
                    }
                    className="min-w-0 flex-1 bg-transparent text-primary outline-none placeholder:text-muted"
                />
            </div>
            {!q && recentForMode.length > 0 && (
                <>
                    <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted">RECENT</div>
                    <div className="mb-2 flex flex-wrap gap-0.5">{recentForMode.map((r) => cell(r, "r-" + r))}</div>
                </>
            )}
            <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted">
                {q ? "RESULTS" : mode === "emoji" ? "EMOJI" : "ICONS"}
            </div>
            <div className="flex max-h-[168px] flex-wrap gap-0.5 overflow-y-auto">
                {custom && cell(custom, "custom")}
                {filtered.map(([v]) => cell(v, v))}
                {!custom && filtered.length == 0 && <div className="px-1 py-2 text-muted">No matches</div>}
            </div>
            {mode === "icons" && (
                <>
                    <div className="mt-2 mb-1 text-[10px] font-semibold tracking-wide text-muted">COLOR</div>
                    <div className="flex gap-1.5">
                        {TitleIconColors.map((c) => (
                            <button
                                key={c}
                                type="button"
                                title={c}
                                className={cn(
                                    "h-[18px] w-[18px] cursor-pointer rounded-full",
                                    (iconColor || TitleIconColors[0]) === c &&
                                        "ring-2 ring-white ring-offset-1 ring-offset-black"
                                )}
                                style={{ backgroundColor: c }}
                                onClick={() => onColor(c)}
                            />
                        ))}
                    </div>
                </>
            )}
            <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                <button
                    type="button"
                    className="cursor-pointer rounded px-1 py-0.5 text-secondary hover:text-primary"
                    onClick={() => onPick("", "", true)}
                >
                    No icon
                </button>
                <button
                    type="button"
                    className="cursor-pointer rounded px-1 py-0.5 text-error hover:brightness-125"
                    onClick={onClearAll}
                >
                    Clear title &amp; icon
                </button>
            </div>
        </div>
    );
}

export const BlockTitleEditor = React.memo(
    ({ blockId, title, icon, iconColor }: { blockId: string; title: string; icon: string; iconColor: string }) => {
        const model = BlockTitleModel.getInstance();
        const [draft, setDraft] = React.useState(title ?? "");
        const [draftIcon, setDraftIcon] = React.useState(isNoIcon(icon) ? "" : icon);
        const [draftColor, setDraftColor] = React.useState(iconColor ?? "");
        // once the user picks anything in the picker (including "No icon"), stop suggesting one from the title
        const [iconChosen, setIconChosen] = React.useState(!!icon);
        const noIconChosen = iconChosen && !draftIcon;
        const suggestedIcon = !iconChosen && !draftIcon ? guessTitleIcon(draft) : null;
        const [pickerOpen, setPickerOpen] = React.useState(false);
        const inputRef = React.useRef<HTMLInputElement>(null);
        const wrapperRef = React.useRef<HTMLDivElement>(null);
        const doneRef = React.useRef(false);

        const { refs, floatingStyles, context } = useFloating({
            open: pickerOpen,
            onOpenChange: (open, event, reason) => {
                setPickerOpen(open);
                if (open || reason !== "outside-press") {
                    return;
                }
                // floating-ui only treats the icon button as "inside"; a click on our own title field just closes the picker
                if (event?.target instanceof Node && wrapperRef.current?.contains(event.target)) {
                    requestAnimationFrame(() => inputRef.current?.focus());
                    return;
                }
                // the input already blurred while the picker was open, so an outside click is the only signal left
                finish(true, null, false);
            },
            placement: "bottom-start",
            middleware: [offset(4), flip(), shift({ padding: 8 })],
            whileElementsMounted: autoUpdate,
        });
        const dismiss = useDismiss(context, { escapeKey: false });
        const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

        React.useEffect(() => {
            // a frame later, so the block's own click-to-focus handling (which hands focus to the terminal) runs first
            const id = requestAnimationFrame(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            });
            return () => cancelAnimationFrame(id);
        }, []);

        const finish = (save: boolean, override?: { title: string; icon: string; color: string }, refocus = true) => {
            if (doneRef.current) {
                return;
            }
            doneRef.current = true;
            if (save) {
                const v = override ?? {
                    title: draft,
                    icon: draftIcon || suggestedIcon || (noIconChosen && draft.trim() ? NoIconSentinel : ""),
                    color: draftColor,
                };
                model.saveTitle(blockId, v.title, v.icon, v.color, icon);
            }
            model.stopEdit(blockId);
            // a keyboard finish leaves focus on the unmounted input; hand it back to the block. A blur finish means
            // the user already focused something else, so leave that alone.
            if (refocus) {
                setTimeout(() => refocusNode(blockId), 0);
            }
        };

        const focusIsInside = (target: EventTarget) => {
            if (!(target instanceof Node)) {
                return false;
            }
            if (wrapperRef.current?.contains(target)) {
                return true;
            }
            return refs.floating.current?.contains(target) ?? false;
        };

        return (
            <div
                ref={wrapperRef}
                className="flex min-w-0 shrink items-center gap-1.5"
                onBlur={(e) => {
                    if (focusIsInside(e.relatedTarget)) {
                        return;
                    }
                    // the whole window lost focus (Alt+Tab, DevTools); focus returns to the input when it comes back
                    if (!document.hasFocus()) {
                        return;
                    }
                    // clicking a non-focusable spot in the picker blurs without a relatedTarget; keep editing
                    if (pickerOpen) {
                        return;
                    }
                    finish(true, null, false);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    // covers the icon button too, so no key reaches the global keymap or the terminal while editing
                    e.stopPropagation();
                    if (e.nativeEvent.isComposing || e.keyCode == 229) {
                        return;
                    }
                    if (e.key === "Escape") {
                        e.preventDefault();
                        finish(false);
                    } else if (e.key === "Enter" && e.target === inputRef.current) {
                        e.preventDefault();
                        finish(true);
                    }
                }}
            >
                <button
                    ref={refs.setReference}
                    type="button"
                    title="Choose an icon"
                    className={cn(
                        "flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded border bg-hover px-1.5",
                        pickerOpen ? "border-accent" : "border-border hover:border-secondary"
                    )}
                    {...getReferenceProps({ onClick: () => setPickerOpen((o) => !o) })}
                >
                    {draftIcon ? (
                        <TitleIcon icon={draftIcon} color={draftColor} className="text-[13px]" />
                    ) : suggestedIcon ? (
                        <span title="Suggested from the title" className="opacity-60">
                            <TitleIcon icon={suggestedIcon} className="text-[13px]" />
                        </span>
                    ) : (
                        <i className="fa fa-regular fa-face-smile text-[12px] text-muted" />
                    )}
                    <i className="fa fa-solid fa-caret-down text-[9px] text-muted" />
                </button>
                <input
                    ref={inputRef}
                    value={draft}
                    maxLength={MaxTitleLength}
                    placeholder="Title"
                    onChange={(e) => setDraft(e.target.value)}
                    className="h-[22px] w-[220px] min-w-[60px] shrink rounded border border-border bg-black/40 px-1.5 text-[13px] font-semibold text-primary outline-none focus:border-accent"
                />
                <span className="shrink-0 truncate text-[11px] text-muted @max-[520px]/header:hidden">
                    Enter to save · Esc to cancel
                </span>
                {pickerOpen && (
                    <FloatingPortal>
                        <div
                            ref={refs.setFloating}
                            style={floatingStyles}
                            className="z-[1000]"
                            {...getFloatingProps({
                                // React bubbles portal events through the block frame, whose click handler would
                                // otherwise hand focus to the terminal while the picker is still open
                                onClick: (e) => e.stopPropagation(),
                                onMouseDown: (e) => e.stopPropagation(),
                                onFocusCapture: (e) => e.stopPropagation(),
                            })}
                        >
                            <IconPicker
                                icon={draftIcon}
                                iconColor={draftColor}
                                onPick={(newIcon, newColor, close) => {
                                    setIconChosen(true);
                                    setDraftIcon(newIcon);
                                    setDraftColor(newColor);
                                    if (close) {
                                        setPickerOpen(false);
                                        inputRef.current?.focus();
                                    }
                                }}
                                onColor={setDraftColor}
                                onClose={() => {
                                    setPickerOpen(false);
                                    inputRef.current?.focus();
                                }}
                                onClearAll={() => finish(true, { title: "", icon: "", color: "" })}
                            />
                        </div>
                    </FloatingPortal>
                )}
            </div>
        );
    }
);
BlockTitleEditor.displayName = "BlockTitleEditor";
