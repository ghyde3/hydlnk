/**
 * Number formatting for the Analytics screen. Hand-rolled instead of Intl so the server render and
 * the browser always print the same characters (no ICU differences, no hydration mismatch).
 * Pure and safe in server and client code.
 */

/** 12480 -> "12,480". Whole numbers; anything not finite reads as 0. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const whole = Math.round(value);
  const sign = whole < 0 ? "-" : "";
  return sign + String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** What a click-through cell shows when there are no views to divide by. */
export const NO_RATE = "—";

/**
 * Clicks over views as a percentage to one decimal ("31.3%"). An em dash when there is nothing to
 * divide (no views) or nothing to report (no clicks, M5-17): never NaN, Infinity or a division by
 * zero. Integer arithmetic, so the rounding is exact: half rounds up.
 */
export function formatCtr(clicks: number, views: number): string {
  if (!Number.isFinite(clicks) || !Number.isFinite(views) || views <= 0 || clicks <= 0) {
    return NO_RATE;
  }
  const tenths = Math.floor((clicks * 2000 + views) / (views * 2)); // round(clicks * 1000 / views)
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/**
 * The chart's top axis label: the smallest 1, 2 or 5 times a power of ten that is at least the
 * peak, and never below 10 (so an empty chart still has an axis). 104 gives 200, 100 gives 100.
 */
export function niceMax(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 10) return 10;
  let base = 1;
  while (base * 10 < peak) base *= 10;
  for (const factor of [1, 2, 5, 10]) {
    if (base * factor >= peak) return Math.max(10, base * factor);
  }
  return base * 10;
}

/**
 * Whole-number percentages of `counts` that add up to exactly 100 (largest remainder): each share
 * is rounded down, then the points left over go to the largest fractions, earlier items first on a
 * tie, so three equal thirds read 34, 33, 33. All zeros (or nothing) give zeros.
 */
export function splitPercents(counts: readonly number[]): number[] {
  const safe = counts.map((count) => (Number.isFinite(count) && count > 0 ? Math.round(count) : 0));
  const total = safe.reduce((sum, count) => sum + count, 0);
  if (total === 0) return safe.map(() => 0);
  const floors = safe.map((count) => Math.floor((count * 100) / total));
  const fractions = safe.map((count, index) => ({ index, rest: (count * 100) % total }));
  let left = 100 - floors.reduce((sum, floor) => sum + floor, 0);
  fractions.sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of fractions) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors;
}
