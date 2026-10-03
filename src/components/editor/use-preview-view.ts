"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorView } from "./view-tabs";

/** Where focus goes after a switch: the dock's button (back on Blocks) or the Back to blocks button. */
type FocusTarget = "dock" | "back";

interface GoOptions {
  focus?: FocusTarget;
  /** False when the caller scrolls somewhere itself (a tap on the preview opens a row). */
  restoreScroll?: boolean;
}

/**
 * Which half of the phone editor is showing (M2-06, M6-02): the "Blocks" tab or the full-size
 * "Preview" tab. Plain React state, never part of the draft, so opening and closing the preview
 * sends nothing.
 *
 * What this adds to the tab switch:
 *   - Leaving Blocks remembers the document's scroll position and Preview opens at the top; coming
 *     back restores the position (the Blocks panel is `display: none` meanwhile, so the page would
 *     otherwise end up wherever the shorter document clamped it).
 *   - Opening from the dock moves focus to "Back to blocks"; coming back with the button, the
 *     Escape key or a tap on the "Blocks" tab puts focus back on the dock button.
 *   - Escape closes the preview, and only while it is open.
 */
export function usePreviewView(isDesktop: boolean) {
  const [view, setViewState] = useState<EditorView>("blocks");
  const viewRef = useRef<EditorView>("blocks");
  const shown = useRef<EditorView>("blocks");
  const savedScroll = useRef(0);
  const focusAfter = useRef<FocusTarget | null>(null);
  const restore = useRef(true);
  const dockRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  const go = useCallback((next: EditorView, options: GoOptions = {}) => {
    const current = viewRef.current;
    if (next === current) return;
    if (current === "blocks") savedScroll.current = window.scrollY;
    focusAfter.current = options.focus ?? null;
    restore.current = options.restoreScroll !== false;
    viewRef.current = next;
    setViewState(next);
  }, []);

  // The scroll position follows the switch. Layout effects run before the focus effects below and
  // before any row focus request, so a row that scrolls itself into view wins over the restore.
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = view;
    if (previous === view) return;
    if (view === "preview") window.scrollTo(0, 0);
    else if (restore.current) window.scrollTo(0, savedScroll.current);
    restore.current = true;
  }, [view]);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "dock") dockRef.current?.focus({ preventScroll: true });
    else if (target === "back") backRef.current?.focus({ preventScroll: true });
  }, [view]);

  const phonePreview = !isDesktop && view === "preview";
  useEffect(() => {
    if (!phonePreview) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      go("blocks", { focus: "dock" });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phonePreview, go]);

  return {
    view,
    dockRef,
    backRef,
    /** The dock was tapped: open the full-size preview, focus on Back to blocks. */
    openPreview: useCallback(() => go("preview", { focus: "back" }), [go]),
    /** Back to blocks, the Escape key and the Blocks tab's click: the same page position, focus on the dock. */
    closePreview: useCallback(() => go("blocks", { focus: "dock" }), [go]),
    /** The tabs: a click is a deliberate switch; the arrow keys keep focus on the tab they moved to. */
    selectTab: useCallback(
      (next: EditorView, source: "click" | "key") =>
        go(next, next === "blocks" && source === "click" ? { focus: "dock" } : {}),
      [go],
    ),
    /** Show Blocks without restoring the scroll (a tap on the preview opens a row and scrolls to it). */
    showBlocks: useCallback((options?: { restoreScroll?: boolean }) => go("blocks", options), [go]),
    /** A failed Publish shows the block that failed. */
    setView: go,
  };
}
