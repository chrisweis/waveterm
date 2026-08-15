// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { computeActivityAlphas, type ActivityEntry } from "./activityglow";

const Now = 1_700_000_000_000;
const Second = 1000;
const Minute = 60 * Second;
const Hour = 60 * Minute;
const Day = 24 * Hour;

function entry(oref: string, agoMs: number, score = 1): ActivityEntry {
    return { oref, score, ts: Now - agoMs };
}

function spread(alphas: Record<string, number>): number {
    const values = Object.values(alphas);
    return Math.max(...values) - Math.min(...values);
}

describe("computeActivityAlphas", () => {
    it("returns nothing when no item has been used", () => {
        expect(computeActivityAlphas([{ oref: "a", score: 0, ts: 0 }], Now)).toEqual({});
    });

    it("orders items by recency, most recent brightest", () => {
        const alphas = computeActivityAlphas([entry("a", 2 * Hour), entry("b", 5 * Minute), entry("c", 3 * Day)], Now);
        expect(alphas["b"]).toBeGreaterThan(alphas["a"]);
        expect(alphas["a"]).toBeGreaterThan(alphas["c"]);
    });

    // The bug this whole model exists to fix: decayed-score normalization collapsed the gradient
    // whenever items were used close together, which is the normal case inside one session.
    it("separates items meaningfully at every timescale", () => {
        const withinTheHour = computeActivityAlphas(
            [entry("a", Minute), entry("b", 10 * Minute), entry("c", 50 * Minute)],
            Now
        );
        const acrossDays = computeActivityAlphas([entry("a", Hour), entry("b", Day), entry("c", 6 * Day)], Now);
        const acrossWeeks = computeActivityAlphas([entry("a", Day), entry("b", 8 * Day), entry("c", 29 * Day)], Now);

        for (const alphas of [withinTheHour, acrossDays, acrossWeeks]) {
            expect(alphas["a"]).toBeGreaterThan(alphas["b"]);
            expect(alphas["b"]).toBeGreaterThan(alphas["c"]);
            // A gradient too small to see is the same as no gradient at all.
            expect(spread(alphas)).toBeGreaterThan(0.02);
        }
    });

    // The failure mode that shipped first: a cluster used seconds apart normalized against its own
    // spread, so it pinned to full brightness and stayed there no matter how old it got.
    it("fades a tight cluster together instead of pinning it bright", () => {
        const entries = [entry("a", 0), entry("b", 30 * Second), entry("c", 100 * Second)];
        const fresh = computeActivityAlphas(entries, Now);
        const later = computeActivityAlphas(entries, Now + Day);

        expect(spread(fresh)).toBeLessThan(0.03);
        expect(spread(later)).toBeLessThan(0.03);
        // ...but the whole cluster is meaningfully dimmer a day on.
        expect(Math.max(...Object.values(later))).toBeLessThan(Math.max(...Object.values(fresh)) - 0.05);
    });

    it("keeps every alpha inside the intended range", () => {
        const alphas = computeActivityAlphas([entry("a", Second), entry("b", 90 * Day)], Now);
        for (const alpha of Object.values(alphas)) {
            expect(alpha).toBeGreaterThanOrEqual(0.03);
            expect(alpha).toBeLessThanOrEqual(0.22);
        }
    });

    it("lights everything up when the set really was used all at once", () => {
        const alphas = computeActivityAlphas([entry("a", 3 * Second), entry("b", 5 * Second)], Now);
        expect(spread(alphas)).toBeLessThan(0.01);
        expect(alphas["a"]).toBeGreaterThan(0.2);
    });

    it("does not let an old item stay bright just because nothing newer exists", () => {
        const alphas = computeActivityAlphas([entry("a", 20 * Day), entry("b", 25 * Day)], Now);
        for (const alpha of Object.values(alphas)) {
            expect(alpha).toBeLessThan(0.08);
        }
    });

    it("uses frequency only to break ties between equally recent items", () => {
        const alphas = computeActivityAlphas([entry("a", 10 * Minute, 8), entry("b", 10 * Minute, 1)], Now);
        expect(alphas["a"]).toBeGreaterThan(alphas["b"]);

        // ...and never lets a heavily-used stale item outrank a fresh one.
        const vsStale = computeActivityAlphas([entry("stale", 5 * Day, 64), entry("fresh", Minute, 1)], Now);
        expect(vsStale["fresh"]).toBeGreaterThan(vsStale["stale"]);
    });

    it("ignores items that were never opened", () => {
        const alphas = computeActivityAlphas([entry("a", Hour), { oref: "never", score: 0, ts: 0 }], Now);
        expect(alphas["never"]).toBeUndefined();
        expect(alphas["a"]).toBeDefined();
    });
});
