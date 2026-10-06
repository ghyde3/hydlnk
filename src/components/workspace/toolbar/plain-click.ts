import type { MouseEvent } from "react";

/**
 * A click the app handles itself: the primary button with no modifier key. A modified click (Cmd,
 * Ctrl, Shift, Alt) or a middle click is left to the browser, so "open in a new tab" keeps working
 * on the menus' links.
 */
export function isPlainClick(event: MouseEvent<HTMLElement>): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
