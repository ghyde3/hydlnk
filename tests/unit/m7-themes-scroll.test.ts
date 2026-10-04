import { describe, expect, it } from "vitest";
import {
  canScrollNext,
  canScrollPrev,
  cardTarget,
  maxScroll,
  overflows,
  pageTarget,
  revealTarget,
  type RowMetrics,
} from "@/components/themes/scroll-math";

/**
 * M7-06: the arithmetic behind the theme rows. A card is 152px wide with an 8px gap, so one step is
 * 160px; the 16 HYDLNK themes make a 2552px row (with 20px of padding at each end) in a 718px view.
 */

const STEP = 160;
const row = (over: Partial<RowMetrics> = {}): RowMetrics => ({
  scrollLeft: 0,
  clientWidth: 718,
  scrollWidth: 20 + 16 * 152 + 15 * 8 + 20,
  step: STEP,
  ...over,
});

describe("M7-06 when the arrows show", () => {
  it("only when the cards do not all fit", () => {
    expect(overflows(row())).toBe(true);
    expect(overflows(row({ scrollWidth: 718 }))).toBe(false);
    expect(overflows(row({ scrollWidth: 718.5 }))).toBe(false); // sub-pixel rounding is not overflow
    expect(overflows(row({ scrollWidth: 20 + 3 * 152 + 2 * 8 + 20 }))).toBe(false);
  });

  it("the previous arrow is disabled at the start and the next at the end", () => {
    expect(canScrollPrev(row())).toBe(false);
    expect(canScrollNext(row())).toBe(true);
    const end = maxScroll(row());
    expect(canScrollPrev(row({ scrollLeft: end }))).toBe(true);
    expect(canScrollNext(row({ scrollLeft: end }))).toBe(false);
    expect(canScrollNext(row({ scrollLeft: end - 0.4 }))).toBe(false); // half a pixel short is the end
    expect(canScrollPrev(row({ scrollLeft: 0.4 }))).toBe(false);
  });
});

describe("M7-06 where an arrow takes the row", () => {
  it("by the visible width less one card, onto a card boundary", () => {
    // (718 - 160) / 160 = 3.49 cards: three cards, 480px.
    expect(pageTarget(row(), 1)).toBe(480);
    expect(pageTarget(row({ scrollLeft: 480 }), 1)).toBe(960);
    expect(pageTarget(row({ scrollLeft: 960 }), -1)).toBe(480);
    expect(pageTarget(row({ scrollLeft: 480 }), -1)).toBe(0);
  });

  it("every stop is a whole number of steps, except the end of the row", () => {
    let at = 0;
    const stops: number[] = [];
    for (let i = 0; i < 12 && canScrollNext(row({ scrollLeft: at })); i++) {
      at = pageTarget(row({ scrollLeft: at }), 1);
      stops.push(at);
    }
    const end = maxScroll(row());
    expect(stops.at(-1)).toBe(end);
    for (const stop of stops.slice(0, -1)) expect(stop % STEP).toBe(0);
  });

  it("goes back from the end of a row that stops between boundaries", () => {
    const end = maxScroll(row());
    expect(end % STEP).not.toBe(0);
    const back = pageTarget(row({ scrollLeft: end }), -1);
    expect(back % STEP).toBe(0);
    expect(back).toBeLessThan(end);
  });

  it("always moves at least one card, even in a view narrower than two cards", () => {
    const narrow = row({ clientWidth: 200 });
    expect(pageTarget(narrow, 1)).toBe(STEP);
    expect(pageTarget({ ...narrow, scrollLeft: STEP }, -1)).toBe(0);
  });

  it("never goes past either end", () => {
    expect(pageTarget(row(), -1)).toBe(0);
    expect(pageTarget(row({ scrollLeft: maxScroll(row()) }), 1)).toBe(maxScroll(row()));
  });

  it("without a measured step it falls back to the visible width", () => {
    expect(pageTarget(row({ step: 0 }), 1)).toBeGreaterThan(0);
  });

  it("an arrow key moves one card", () => {
    expect(cardTarget(row(), 1)).toBe(STEP);
    expect(cardTarget(row({ scrollLeft: STEP }), 1)).toBe(2 * STEP);
    expect(cardTarget(row({ scrollLeft: 2 * STEP }), -1)).toBe(STEP);
    expect(cardTarget(row(), -1)).toBe(0);
    expect(cardTarget(row({ scrollLeft: maxScroll(row()) }), 1)).toBe(maxScroll(row()));
  });
});

describe("M7-06 scrolling to the applied card", () => {
  const pad = { start: 20, end: 20 };
  const cardAt = (index: number) => ({ left: 20 + index * STEP, width: 152 });

  it("does nothing when the card is already in view", () => {
    expect(revealTarget(row(), cardAt(0), pad)).toBeNull();
    expect(revealTarget(row(), cardAt(3), pad)).toBeNull();
  });

  it("puts a card that is out of view at the start of the row, where the snap would", () => {
    expect(revealTarget(row(), cardAt(8), pad)).toBe(8 * STEP);
    expect(revealTarget(row({ scrollLeft: 8 * STEP }), cardAt(0), pad)).toBe(0);
  });

  it("the 14th HYDLNK theme is past the furthest the row can scroll: the row goes to its end, where the card is in view", () => {
    const target = revealTarget(row(), cardAt(13), pad)!;
    expect(target).toBe(maxScroll(row()));
    const m = row({ scrollLeft: target });
    expect(cardAt(13).left).toBeGreaterThanOrEqual(m.scrollLeft);
    expect(cardAt(13).left + 152).toBeLessThanOrEqual(m.scrollLeft + m.clientWidth);
  });

  it("brings a half-hidden card in", () => {
    // The fifth card starts at 660 in a 718px view: its right edge is at 812.
    expect(revealTarget(row(), cardAt(4), pad)).toBe(4 * STEP);
  });

  it("stops at the end of the row for the last cards", () => {
    expect(revealTarget(row(), cardAt(15), pad)).toBe(maxScroll(row()));
  });

  it("does nothing while the row is hidden (no width)", () => {
    expect(revealTarget(row({ clientWidth: 0 }), cardAt(13), pad)).toBeNull();
  });
});
