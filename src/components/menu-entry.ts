"use client";

import { useCallback, useRef, type MutableRefObject } from "react";

/**
 * Where focus lands when a Radix menu opens (M9-05): Radix puts it on the first item for Enter,
 * Space and ArrowDown. A menu button also opens on ArrowUp, with focus on the last item; Radix has
 * no option for that (the dropdown menu's content takes no `onOpenAutoFocus`), so the button says
 * `entry.current = "last"` before it opens the menu, and `contentRef` (on the menu's content) moves
 * focus to the last item once Radix has placed it. Nothing else here: this file imports no Radix.
 */
export function useMenuEntry(): {
  entry: MutableRefObject<"first" | "last">;
  contentRef: (node: HTMLElement | null) => void;
} {
  const entry = useRef<"first" | "last">("first");
  const contentRef = useCallback((node: HTMLElement | null) => {
    if (!node || entry.current !== "last") return;
    entry.current = "first";
    focusLastItemSoon(node);
  }, []);
  return { entry, contentRef };
}

/** Focuses the last `menuitem` of `menu` after Radix's own entry focus, trying again for two frames. */
export function focusLastItemSoon(menu: HTMLElement): void {
  let attempts = 0;
  const attempt = () => {
    if (!menu.isConnected) return;
    const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
    const last = items[items.length - 1];
    if (!last) return;
    const active = document.activeElement;
    // Only while focus is still where Radix put it (the menu itself or its first item).
    if (attempts === 0 || active === menu || active === items[0]) {
      if (active !== last) last.focus({ preventScroll: true });
    }
    attempts += 1;
    if (attempts < 3) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
