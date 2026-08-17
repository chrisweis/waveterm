// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fitTabWidths } from "./tabbar";

const MinWidth = 70;

function sum(values: number[]): number {
    return values.reduce((acc, v) => acc + v, 0);
}

describe("fitTabWidths", () => {
    it("leaves tabs at their natural width when they all fit", () => {
        expect(fitTabWidths([80, 120, 200], 600)).toEqual([80, 120, 200]);
    });

    it("does not stretch tabs to fill leftover space", () => {
        // "Expand to show the title" means fit the name, not consume the bar.
        expect(sum(fitTabWidths([80, 90], 1000))).toBe(170);
    });

    // The point of the whole algorithm: a short name should not be squeezed just because some
    // other tab is long. An even "available / count" split would shrink both equally.
    it("shrinks only the tabs that are too wide", () => {
        const fitted = fitTabWidths([80, 200, 300], 400);
        expect(fitted[0]).toBe(80);
        expect(fitted[1]).toBe(160);
        expect(fitted[2]).toBe(160);
        expect(sum(fitted)).toBeCloseTo(400);
    });

    it("fills exactly the available width when shrinking", () => {
        for (const available of [300, 450, 640, 900]) {
            const fitted = fitTabWidths([90, 150, 240, 380], available);
            const total = sum(fitted);
            if (total > available) {
                // Only legal when the floor forced it wider than the budget.
                expect(fitted.every((w) => w === MinWidth)).toBe(true);
            } else {
                expect(total).toBeLessThanOrEqual(available + 0.001);
            }
        }
    });

    it("never shrinks a tab below the floor, even with no room", () => {
        const fitted = fitTabWidths([200, 200, 200, 200, 200], 100);
        expect(fitted).toEqual([MinWidth, MinWidth, MinWidth, MinWidth, MinWidth]);
    });

    it("preserves input order, not sorted order", () => {
        // The algorithm sorts internally to find the cap; the result must map back to the original
        // positions or every tab would be laid out at another tab's width.
        expect(fitTabWidths([300, 80, 200], 400)).toEqual([160, 80, 160]);
    });

    // A tab being renamed must not be squeezed, or you cannot read what you are typing.
    describe("with a protected tab (rename in progress)", () => {
        it("gives the protected tab its full natural width", () => {
            const fitted = fitTabWidths([100, 400, 100], 400, MinWidth, 1);
            expect(fitted[1]).toBe(400);
        });

        it("shrinks the other tabs to make room", () => {
            const fitted = fitTabWidths([200, 300, 200], 500, MinWidth, 1);
            expect(fitted[1]).toBe(300);
            expect(fitted[0]).toBeLessThan(200);
            expect(fitted[2]).toBeLessThan(200);
            expect(sum(fitted)).toBeCloseTo(500);
        });

        it("still respects the floor for the tabs that give way", () => {
            const fitted = fitTabWidths([200, 500, 200, 200], 520, MinWidth, 1);
            expect(fitted[1]).toBe(500);
            for (const w of [fitted[0], fitted[2], fitted[3]]) {
                expect(w).toBe(MinWidth);
            }
        });

        it("caps the protected tab at the available width", () => {
            const fitted = fitTabWidths([100, 900], 400, MinWidth, 1);
            expect(fitted[1]).toBe(400);
        });

        it("leaves everything alone when it all fits anyway", () => {
            expect(fitTabWidths([80, 120, 90], 800, MinWidth, 1)).toEqual([80, 120, 90]);
        });

        it("keeps positions aligned with the input", () => {
            const fitted = fitTabWidths([400, 100, 100], 400, MinWidth, 0);
            expect(fitted).toHaveLength(3);
            expect(fitted[0]).toBe(400);
        });

        it("ignores an out-of-range protected index", () => {
            expect(fitTabWidths([80, 200, 300], 400, MinWidth, 9)).toEqual(fitTabWidths([80, 200, 300], 400));
        });
    });

    it("handles an empty tab bar and a single tab", () => {
        expect(fitTabWidths([], 500)).toEqual([]);
        expect(fitTabWidths([900], 400)).toEqual([400]);
        expect(fitTabWidths([120], 400)).toEqual([120]);
    });
});
