"use client";

import { useEffect } from "react";

/**
 * The CSS variable that holds the height of everything the toolbar pins at the top of the screen:
 * the 56px row at 1280px and up, the two rows from 760px to 1279px (measured, not a constant), and
 * on a phone the 52px row plus the tabs under it. It is set on the document element while the
 * toolbar is mounted, so the workspace's preview column can pin under it:
 *
 *     top: calc(var(--hl-toolbar-h, 56px) + 16px)
 *
 * (`PREVIEW_PIN_TOP`). The 56px fallback is the first paint before the toolbar has measured itself.
 */
export const TOOLBAR_HEIGHT_VAR = "--hl-toolbar-h";

/** The preview column's `top` while it is pinned: 16px under the toolbar, whatever its height is. */
export const PREVIEW_PIN_TOP = `calc(var(${TOOLBAR_HEIGHT_VAR}, 56px) + 16px)`;

/** Marks an element as part of what the toolbar pins; the visible ones add up to the variable. */
export const PIN_ATTRIBUTE = "data-toolbar-pin";

/** The toolbar's rows on a phone: the pinned row, then the tabs under it. */
export const PHONE_ROW_HEIGHT = 52;
export const PHONE_TABS_HEIGHT = 48;
/** The one row at 1280px and up. */
export const DESKTOP_ROW_HEIGHT = 56;

/**
 * The sum of the heights of the pinned elements that are drawn: `display: contents` ones count 0
 * (the bar below 760px, its row and its tab strip from 760px up), and one inside another drawn
 * one is part of it, not more height.
 */
export function measurePinned(root: ParentNode = document): number {
  const drawn = Array.from(root.querySelectorAll<HTMLElement>(`[${PIN_ATTRIBUTE}]`)).filter(
    (element) => element.getClientRects().length > 0,
  );
  let total = 0;
  for (const element of drawn) {
    if (drawn.some((other) => other !== element && other.contains(element))) continue;
    total += element.getBoundingClientRect().height;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Keeps `--hl-toolbar-h` equal to what is pinned (see above) and `scroll-padding-top` a little
 * bigger, so a field focused near the top scrolls clear of the pinned block instead of under it.
 * Watches the pinned elements and the window, so a resize across a breakpoint (the bar is a box
 * from 760px up and `display: contents` below, where its row and its tab strip are the boxes), a
 * toolbar that wraps, a rename field that opens and a tab strip that changes height are all
 * followed.
 */
export function usePinnedHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    const observer = new ResizeObserver(() => apply());
    function apply() {
      const height = measurePinned();
      root.style.setProperty(TOOLBAR_HEIGHT_VAR, `${height}px`);
      root.style.scrollPaddingTop = `${height + 8}px`;
    }
    for (const element of document.querySelectorAll(`[${PIN_ATTRIBUTE}]`)) {
      observer.observe(element);
    }
    window.addEventListener("resize", apply);
    apply();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      root.style.removeProperty(TOOLBAR_HEIGHT_VAR);
      root.style.removeProperty("scroll-padding-top");
    };
  }, []);
}
