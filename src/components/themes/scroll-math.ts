/**
 * The arithmetic of the theme rows (M7-06), kept apart from the component so it can be tested
 * without a browser. A row is a horizontal scroll container whose cards snap to their left edge, so
 * every "resting" position is a whole number of card steps (card width plus gap) from the start,
 * except the very end of the row, where the browser clamps the scroll.
 */

/** What a row measures about itself: the scroll container's geometry and one card step. */
export interface RowMetrics {
  scrollLeft: number;
  /** The visible width of the row. */
  clientWidth: number;
  /** The width of everything in the row. */
  scrollWidth: number;
  /** The distance from one card's left edge to the next one's: card width plus gap. 0 when unknown. */
  step: number;
}

/** Tolerance for sub-pixel scroll positions. */
const EPSILON = 1;

/** More cards than fit: the arrows are only drawn then. */
export const overflows = (m: RowMetrics): boolean => m.scrollWidth > m.clientWidth + EPSILON;

/** The row is not at its start. */
export const canScrollPrev = (m: RowMetrics): boolean => m.scrollLeft > EPSILON;

/** The row is not at its end. */
export const canScrollNext = (m: RowMetrics): boolean =>
  m.scrollLeft + m.clientWidth < m.scrollWidth - EPSILON;

/** The furthest the row can scroll. */
export const maxScroll = (m: RowMetrics): number => Math.max(0, m.scrollWidth - m.clientWidth);

/** The step to use: the measured one, or the visible width when it could not be measured. */
const stepOf = (m: RowMetrics): number => (m.step > 0 ? m.step : Math.max(1, m.clientWidth));

/**
 * Where an arrow takes the row: by the visible width less one card (so the last card on show stays
 * in view as the first of the next page), landing on a card boundary, and always at least one card
 * in the direction asked. At the end of the row the browser's own limit applies.
 */
export function pageTarget(m: RowMetrics, direction: 1 | -1): number {
  const step = stepOf(m);
  const max = maxScroll(m);
  const move = Math.max(step, m.clientWidth - step);
  if (direction === 1) {
    let index = Math.round((m.scrollLeft + move) / step);
    while (index * step <= m.scrollLeft + EPSILON) index += 1;
    return Math.min(index * step, max);
  }
  let index = Math.round((m.scrollLeft - move) / step);
  while (index * step >= m.scrollLeft - EPSILON) index -= 1;
  return Math.max(0, index * step);
}

/** Where an arrow key takes the row: one card either way, on a boundary. */
export function cardTarget(m: RowMetrics, direction: 1 | -1): number {
  const step = stepOf(m);
  const current = Math.round(m.scrollLeft / step);
  const index = current + direction;
  return Math.min(Math.max(0, index * step), maxScroll(m));
}

/**
 * Where the row must scroll so a card is fully inside its visible box, or null when it already is.
 * `cardLeft` is the card's left edge in the row's content coordinates (as if scrollLeft were 0).
 * `padStart` and `padEnd` are the row's inner padding: a card counts as visible when it sits inside
 * the box less that padding, and the new position puts its left edge at the padding, which is the
 * position the snap would give it anyway.
 */
export function revealTarget(
  m: RowMetrics,
  card: { left: number; width: number },
  pad: { start: number; end: number },
): number | null {
  if (m.clientWidth <= 0) return null;
  const start = m.scrollLeft + pad.start;
  const end = m.scrollLeft + m.clientWidth - pad.end;
  if (card.left >= start - EPSILON && card.left + card.width <= end + EPSILON) return null;
  const target = Math.min(Math.max(0, card.left - pad.start), maxScroll(m));
  return Math.abs(target - m.scrollLeft) < EPSILON ? null : target;
}
