"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftDoc, PublishDoc } from "@/lib/document";
import { themeById, type ThemeRow } from "@/lib/themes";
import { previewForm } from "@/lib/themes/preview";

/** What the preview column and the phone bar need to draw a preview in progress (M6-44). */
export interface ThemePreviewView {
  /** The previewed theme's name: "Previewing Paper". */
  name: string;
  /** The polite status text: "Previewing Paper." */
  status: string;
  /** "Apply Paper": applies exactly like pressing the card, ends the preview and shows the Style tab. */
  onApply: () => void;
  /** "Stop previewing" (desktop) and "Back to my style" (phone): ends the preview and returns focus to the card. */
  onStop: () => void;
  /** Ref callback for the Apply button on screen (one of the two): focus moves to it when a preview starts. */
  attachApply: (element: HTMLButtonElement | null) => void;
}

export interface ThemePreviewOptions {
  /** The draft on screen: a preview is a view of it and ends the moment it changes. */
  draft: DraftDoc;
  /** Every theme in the grid, system and the user's own: a preview can only be of one of these. */
  themes: readonly ThemeRow[];
  /** The library's apply (M3-20): the same call a press on the card makes. */
  applyTheme: (id: string) => void;
  /** Phone: show the Preview tab. */
  showPreview: () => void;
  /** Phone: show the Style tab. */
  showStyle: () => void;
}

export interface ThemePreview {
  /** The theme on show, or null. */
  theme: ThemeRow | null;
  /** The page with that theme applied (`previewForm`), or null. Draw this in place of the draft's own form. */
  form: PublishDoc | null;
  /** For the preview column and the phone bar; null when nothing is on show. */
  view: ThemePreviewView | null;
  /** The Preview button of a card was pressed. Pressing another card's replaces the preview. */
  start: (id: string) => void;
  /**
   * Puts the page back. `focus` (default true) returns focus to the previewed card's Preview button;
   * pass false when something else is taking focus (a control, Done, a tab).
   */
  stop: (options?: { focus?: boolean }) => void;
}

const previewButtonOf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`li[data-theme-id="${id}"] [data-testid="theme-preview"]`);

/**
 * Previewing a theme on the Design screen (M6-44). A preview is derived state and nothing else:
 * `{ id, draft }`, the theme and the draft it was started on. It is shown while that draft is still
 * the draft on screen and the theme is still in the grid, so any edit (a control, an undo, an
 * apply, a deleted theme) ends it by itself, and nothing is ever written: no draft save, no theme
 * write, no upload, and nothing a visitor of the live page could see.
 *
 * The caller wraps the things that must end it first (a control change, Save as theme, Done) with
 * `stop({ focus: false })`; the draft check catches everything else.
 */
export function useThemePreview(options: ThemePreviewOptions): ThemePreview {
  const { draft, themes, applyTheme, showPreview, showStyle } = options;
  const [active, setActive] = useState<{ id: string; draft: DraftDoc } | null>(null);
  const applyButton = useRef<HTMLButtonElement | null>(null);
  const attachApply = useCallback((element: HTMLButtonElement | null) => {
    applyButton.current = element;
  }, []);
  // Focus asks, run after the render that shows or hides the controls.
  const [focusAsk, setFocusAsk] = useState<{ kind: "apply"; seq: number } | null>(null);

  const draftRef = useRef(draft);
  const themesRef = useRef(themes);
  const activeRef = useRef(active);
  useEffect(() => {
    draftRef.current = draft;
    themesRef.current = themes;
    activeRef.current = active;
  }, [draft, themes, active]);

  const theme = useMemo(
    () => (active !== null && active.draft === draft ? themeById(themes, active.id) : null),
    [active, draft, themes],
  );
  const form = useMemo(() => (theme === null ? null : previewForm(draft, theme)), [draft, theme]);

  // A preview whose draft moved on or whose theme is gone is over: `theme` is null then, so nothing
  // is drawn. (The stale `active` is left alone: no later draft is ever the one it was started on,
  // because every undo, redo and edit makes a new draft object.)

  useEffect(() => {
    if (focusAsk?.kind === "apply") applyButton.current?.focus();
  }, [focusAsk]);

  const start = useCallback(
    (id: string) => {
      if (themeById(themesRef.current, id) === null) return;
      setActive({ id, draft: draftRef.current });
      showPreview();
      setFocusAsk((ask) => ({ kind: "apply", seq: (ask?.seq ?? 0) + 1 }));
    },
    [showPreview],
  );

  const stop = useCallback((stopOptions?: { focus?: boolean }) => {
    const current = activeRef.current;
    if (current === null) return;
    setActive(null);
    if (stopOptions?.focus === false) return;
    // After the render that brings the card list back (on a phone, the Style tab).
    setTimeout(() => previewButtonOf(current.id)?.focus(), 0);
  }, []);

  const apply = useCallback(() => {
    const current = activeRef.current;
    if (current === null) return;
    applyTheme(current.id);
    setActive(null);
    showStyle();
    setTimeout(() => previewButtonOf(current.id)?.focus(), 0);
  }, [applyTheme, showStyle]);

  const back = useCallback(() => {
    stop();
    showStyle();
  }, [stop, showStyle]);

  const view = useMemo<ThemePreviewView | null>(
    () =>
      theme === null
        ? null
        : {
            name: theme.name,
            status: `Previewing ${theme.name}.`,
            onApply: apply,
            onStop: back,
            attachApply,
          },
    [theme, apply, back, attachApply],
  );

  return { theme, form, view, start, stop };
}
