// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getOrefMetaKeyAtom, getSettingsKeyAtom } from "@/store/global";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { useAtomValue } from "jotai";
import { useMemo } from "react";

// Frequency half-life. This only shapes the secondary "used a lot" term -- recency below is what
// actually drives the glow, so a long half-life here just means a burst of use stays credited for
// about a day.
const HalfLifeMs = 24 * 60 * 60 * 1000;

// Alpha range of the glow wash. The ceiling stays low because this sits under the existing
// active/hover treatments and must not compete with them; the floor keeps the oldest recorded item
// faintly visible rather than indistinguishable from one that was never opened.
const MaxAlpha = 0.22;
const MinAlpha = 0.03;

// The recency curve runs on an absolute log scale between these two ages: anything fresher than the
// floor is full strength, anything older than the ceiling has faded out. Log is what makes it span
// minutes to weeks in one curve -- each order of magnitude of age costs the same amount of
// brightness, so a minute vs an hour separates as clearly as a day vs a month.
//
// Deliberately absolute rather than normalized against the set. Normalizing against the set's own
// spread sounds more adaptive but is worse: a cluster of tabs used within a minute of each other
// keeps stretching to fill the whole brightness range forever, so week-old work stays as bright as
// this morning's. On an absolute curve a cluster fades together, which is the honest answer -- if
// three tabs really were used seconds apart, their ordering is noise, but their shared age is not.
const RecencyFloorMs = 30 * 1000;
const RecencyCeilMs = 30 * 24 * 60 * 60 * 1000;
const LogRange = Math.log(RecencyCeilMs / RecencyFloorMs);

// Frequency scales recency rather than adding to it, so a heavily-used tab reads slightly stronger
// than a barely-touched one of the same age but can never outshine something more recent. Added,
// it would instead put a floor under every item and squash the whole gradient.
const FrequencyFloor = 0.75;

// Pulls mid-range items up. Pure linear falloff makes everything but the newest item look
// uniformly dark, which loses the ordering the feature exists to show.
const Gamma = 0.7;

// A drive-by tab switch is not "work". Only activations that outlive this count.
export const ActivityDwellMs = 5000;

// Bounds runaway accumulation from rapid switching: with +1 per activation the score would otherwise
// climb without limit during a burst, and one hot item would flatten every other item's glow.
const MaxScore = 64;

// Ticks so the glow visibly fades while the app sits open. One minute is far below the half-life,
// so the decay reads as continuous.
const TickMs = 60 * 1000;

const nowAtom = jotai.atom(Date.now());
setInterval(() => globalStore.set(nowAtom, Date.now()), TickMs);

export function decayScore(score: number, ts: number, now: number): number {
    if (!(score > 0) || !(ts > 0)) {
        return 0;
    }
    const elapsed = now - ts;
    if (elapsed <= 0) {
        return score;
    }
    return score * Math.pow(0.5, elapsed / HalfLifeMs);
}

// Read-modify-write rather than a plain increment: the stored score is only meaningful paired with
// the timestamp it was decayed to, so both have to move together.
export function recordActivity(oref: string): void {
    const now = Date.now();
    const score = globalStore.get(getOrefMetaKeyAtom(oref, "activity:score")) ?? 0;
    const ts = globalStore.get(getOrefMetaKeyAtom(oref, "activity:ts")) ?? 0;
    const next = Math.min(decayScore(score, ts, now) + 1, MaxScore);
    fireAndForget(() =>
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref,
            meta: { "activity:score": next, "activity:ts": now },
        })
    );
}

export type ActivityEntry = { oref: string; score: number; ts: number };

// Recency is measured on an absolute log age curve (see RecencyFloorMs/RecencyCeilMs above), with
// the decayed score applied only as a multiplier. Log scale is what makes it adaptive: a minute vs
// an hour separates as visibly as a day vs a month.
//
// Decayed score alone cannot do this. Exponential decay preserves ratios, so items used close
// together in absolute time -- the normal case inside one session -- come out at nearly identical
// intensity no matter what half-life you pick. Score survives here only as a frequency tiebreaker.
export function computeActivityAlphas(entries: ActivityEntry[], now: number): Record<string, number> {
    const active = entries.filter((e) => e.ts > 0);
    if (active.length === 0) {
        return {};
    }
    const scores = active.map((e) => decayScore(e.score, e.ts, now));
    const maxScore = Math.max(...scores);

    const rtn: Record<string, number> = {};
    active.forEach((entry, i) => {
        const age = Math.max(now - entry.ts, RecencyFloorMs);
        const recency = Math.max(0, 1 - Math.log(age / RecencyFloorMs) / LogRange);
        const frequency = maxScore > 0 ? scores[i] / maxScore : 0;
        const weighted = recency * (FrequencyFloor + (1 - FrequencyFloor) * frequency);
        rtn[entry.oref] = MinAlpha + Math.pow(weighted, Gamma) * (MaxAlpha - MinAlpha);
    });
    return rtn;
}

export function useActivityAlphas(orefs: string[]): Record<string, number> {
    const enabled = useAtomValue(getSettingsKeyAtom("app:activityglow")) ?? false;
    const orefKey = orefs.join(",");

    const alphasAtom = useMemo(
        () =>
            jotai.atom((get): Record<string, number> => {
                if (!enabled || orefs.length === 0) {
                    return {};
                }
                const entries = orefs.map((oref) => ({
                    oref,
                    score: get(getOrefMetaKeyAtom(oref, "activity:score")) ?? 0,
                    ts: get(getOrefMetaKeyAtom(oref, "activity:ts")) ?? 0,
                }));
                return computeActivityAlphas(entries, get(nowAtom));
            }),
        [orefKey, enabled]
    );

    return useAtomValue(alphasAtom);
}

// Relative color syntax against the primary text color is what makes this theme-agnostic: the text
// color is near-white on a dark background and near-black on a light one, so the same rule glows
// brighter in dark mode and darker in light mode without branching on the theme.
export function activityGlowStyle(alpha: number): React.CSSProperties {
    if (!(alpha > 0)) {
        return null;
    }
    return { backgroundColor: `rgb(from var(--main-text-color) r g b / ${alpha})` };
}
