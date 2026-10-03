"use client";

import { useEffect, useState, type RefObject } from "react";
import type { PublishDoc } from "@/lib/document";
import { MiniPreview } from "./mini-preview";
import { panelId } from "./view-tabs";

/**
 * The phone editor's bottom stack, from the bottom: the app's tab bar (a 56px bar and its 1px top
 * border, plus the safe-area inset), an 8px gap, then the dock (Blocks tab) or the Back to blocks
 * bar (Preview tab). Anything fixed above them (the toasts) is lifted by `toastLift`.
 */
export const TAB_BAR_HEIGHT = 57;
export const DOCK_GAP = 8;
export const DOCK_HEIGHT = 96;
/** The dock while a text field has focus: only the label and the hint, so the keyboard leaves room. */
export const DOCK_STRIP_HEIGHT = 44;
export const BACK_BAR_HEIGHT = 48;

/** `bottom` of the dock and the bar: above the tab bar and its safe-area inset. */
const BOTTOM = `calc(${TAB_BAR_HEIGHT + DOCK_GAP}px + env(safe-area-inset-bottom))`;

/** What the toasts sit on top of: the dock's or the bar's height, 0 when neither is shown. */
export function stackHeight(mode: "dock" | "bar" | "none", collapsed: boolean): number {
  if (mode === "none") return 0;
  if (mode === "bar") return BACK_BAR_HEIGHT;
  return collapsed ? DOCK_STRIP_HEIGHT : DOCK_HEIGHT;
}

/**
 * How far to lift the fixed toasts. They sit 68px above the bottom edge (11px over the tab bar);
 * with something docked above the tab bar they have to clear it by the same 11px instead.
 */
export function toastLift(height: number): number {
  return height === 0 ? 0 : TAB_BAR_HEIGHT + DOCK_GAP + height + 11 - 68;
}

/** Text controls: the fields that open the soft keyboard. Checkboxes, files and buttons do not. */
const NON_TEXT_INPUT = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUT.has(target.type);
}

/**
 * The live preview dock (M6-01): one button, fixed above the tab bar below 760px while the Blocks
 * tab is open. It holds the "Live preview" label, the hint and a thumbnail of the draft, and opens
 * the full-size preview (M6-02). While a text field has focus (`collapsed`) it shrinks to a 44px
 * strip without the thumbnail, so an open keyboard leaves room to type. A press anywhere while it is
 * a strip keeps it a strip until the tap is over, so it does not grow under the finger and the tap
 * (on the strip, or on a control that sits where it would grow) is not lost.
 */
export function PreviewDock({
  doc,
  pageId,
  collapsed,
  buttonRef,
  onOpen,
}: {
  doc: PublishDoc;
  pageId: string;
  collapsed: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  // A press anywhere while a field has focus: moving focus off the field (to the control that was
  // pressed) would let the dock grow back from 44px to 96px, under the finger if the control sits
  // low on the screen, and the click would land on the dock instead. So the strip stays a strip
  // until that press is over, wherever it began. `pointerdown` comes before the focus change.
  useEffect(() => {
    if (!collapsed) return;
    const onPointerDown = () => setPressed(true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [collapsed]);
  useEffect(() => {
    if (!pressed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => setPressed(false);
    // The tap's click follows the pointer-up; a press that ends elsewhere has no click, so the
    // timer lets go of it anyway.
    const onPointerUp = () => {
      timer = setTimeout(release, 400);
    };
    // After the click, not before it: the strip stays a strip while the tap is delivered.
    window.addEventListener("click", release, { once: true });
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", release, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", release);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", release);
    };
  }, [pressed]);

  const strip = collapsed || pressed;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Open full-size preview"
      aria-controls={panelId("preview")}
      data-testid="preview-dock"
      data-collapsed={strip ? "true" : undefined}
      onClick={onOpen}
      style={{ bottom: BOTTOM, height: strip ? DOCK_STRIP_HEIGHT : DOCK_HEIGHT }}
      className="fixed inset-x-4 z-20 box-border flex overflow-hidden rounded-md border border-line bg-surface text-left hl:hidden"
    >
      <span
        className={`flex min-w-0 flex-1 px-3 ${
          strip ? "flex-row items-center justify-between gap-3" : "flex-col justify-center gap-1"
        }`}
      >
        <span className="font-mono text-[11px] tracking-[0.06em] text-text-2 uppercase">
          Live preview
        </span>
        <span className="text-xs text-text-2">Tap to open</span>
      </span>
      {/* Kept mounted while the dock is a strip so it keeps following the draft; just not shown. */}
      <MiniPreview doc={doc} pageId={pageId} hidden={strip} />
    </button>
  );
}

/**
 * "Back to blocks" (M6-02): replaces the dock, in the same place, while the full-size preview is
 * open. A white button with a 1px #C9C5BE border, 6px radius and a left arrow.
 */
export function BackToBlocksBar({
  buttonRef,
  onBack,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="preview-back"
      onClick={onBack}
      style={{ bottom: BOTTOM, height: BACK_BAR_HEIGHT }}
      className="fixed inset-x-4 z-20 box-border flex items-center gap-2.5 rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink hl:hidden"
    >
      <span aria-hidden="true" className="text-base leading-none">
        ←
      </span>
      Back to blocks
    </button>
  );
}
