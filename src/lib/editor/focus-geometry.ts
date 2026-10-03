import { roundFocus, type Focus } from "@/lib/document/focus";

/**
 * The geometry of the focus picker (M6-25), pure so it can be tested without a browser.
 *
 * A focus is measured on the picture itself: `rect` is the picture's box on the screen (never the
 * picker's padding), and a point outside it is clamped onto its edge, so a marker can never leave
 * the picture and a stale or hostile pointer coordinate can never produce a number outside 0 to 1.
 */

export interface PictureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

/** The focus under a pointer at (`clientX`, `clientY`): 0 to 1 across the picture, rounded to 3 decimals. */
export function focusFromPoint(clientX: number, clientY: number, rect: PictureRect): Focus {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
  return roundFocus({
    x: clampUnit((clientX - rect.left) / rect.width),
    y: clampUnit((clientY - rect.top) / rect.height),
  });
}

/** The arrow keys' step: 5 percent, or 1 percent with Shift. */
export const FOCUS_STEP = 0.05;
export const FOCUS_STEP_FINE = 0.01;

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The focus after an arrow key, or null when the key is not an arrow. Clamped to the picture. */
export function stepFocus(current: Focus, key: string, fine: boolean): Focus | null {
  const direction = ARROWS[key];
  if (!direction) return null;
  const step = fine ? FOCUS_STEP_FINE : FOCUS_STEP;
  return roundFocus({
    x: clampUnit(current.x + direction[0] * step),
    y: clampUnit(current.y + direction[1] * step),
  });
}

/** What the live region says: "Focus 30 percent across, 70 percent down". */
export function describeFocus(focus: Focus): string {
  return `Focus ${Math.round(focus.x * 100)} percent across, ${Math.round(focus.y * 100)} percent down`;
}

/**
 * Where the marker sits inside the picture, as CSS percentages. The marker's own box is 44px and
 * is centered on this point.
 */
export function markerPosition(focus: Focus): { left: string; top: string } {
  return { left: `${focus.x * 100}%`, top: `${focus.y * 100}%` };
}
