"use client";

import { Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/app/icon";
import type { PreviewTap } from "@/components/editor/preview-taps";
import type { PreviewSite } from "@/components/site/use-site-pages";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import type { PublishDoc } from "@/lib/document";
import type { PageChrome } from "@/lib/editor/contracts";
import { FullPreviewSheet, type SheetThemePreview } from "./full-preview-sheet";
import {
  MINI_PHONE_BOTTOM,
  MINI_PHONE_HEIGHT,
  MINI_PHONE_RIGHT,
  MINI_PHONE_ROUND,
  MINI_PHONE_WIDTH,
  isTextField,
} from "./measures";
import { MiniThumbnail } from "./mini-thumbnail";

export interface MiniPhonePreviewProps {
  /**
   * The publish form the bezel draws: `toPublishForm(draft, themeTokens)`, or the previewed form
   * while a theme is on show. The thumbnail and the sheet draw it as it is.
   */
  doc: PublishDoc;
  pageId: string;
  /** The footer links in the sheet, `pageChrome(plan, pageId)`: the same decision the live page makes. */
  chrome: PageChrome;
  /** Controlled: whether the full-size sheet is open. Leave it out and the mini phone keeps its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tap to edit (M6-03): a tap in the sheet. The sheet is already closed; take the person to the Edit tab and the field. */
  onTap?: (tap: PreviewTap) => void;
  /** A theme on show (M6-44, M7-06): the sheet gets its bar, and a tap on the page does nothing. */
  themePreview?: SheetThemePreview | null;
  /** The rest of the site (M11-08): the menu, the page links and the sub-page drawn instead of Home. */
  view?: PreviewSite | undefined;
  /** A menu entry was pressed in the sheet: the editor opens that page. */
  onNavigate?: ((href: string) => void) | undefined;
}

/**
 * The mini phone (M7-09): below 760px, on Edit, Design and Share, a small fixed phone, 48x104px
 * (9:19.5), 16px from the right edge and 12px above the tab bar, with the top of the page drawn live
 * in it. A tap opens the full-size preview sheet. It is a button named "Open live preview".
 *
 *   - While a text field of the page has focus (Display name, a block's field, the share Title, a hex
 *     color) it shrinks to a 44x44 round button with a phone glyph and no thumbnail, so an open
 *     keyboard leaves room to type, and grows back when focus leaves. A press anywhere while it is
 *     round keeps it round until that tap is over, so it does not grow under the finger and the tap
 *     is not lost; a tap on it while a field has focus opens the sheet.
 *   - While the sheet is open it is hidden; closing the sheet puts focus back on it.
 *   - At 760px and up neither it nor the sheet is in the DOM: the bezel is the preview.
 *
 * It sends no request of its own and writes nothing; the page it draws is the draft's publish form.
 */
export function MiniPhonePreview({
  doc,
  pageId,
  chrome,
  open,
  onOpenChange,
  onTap,
  themePreview,
  view,
  onNavigate,
}: MiniPhonePreviewProps) {
  const isDesktop = useIsDesktop();
  const [ownOpen, setOwnOpen] = useState(false);
  const sheetOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  // A text field of the page has focus: the mini phone is round so the keyboard leaves room.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => setFieldFocused(isTextField(event.target));
    const onFocusOut = (event: FocusEvent) => {
      if (!isTextField(event.relatedTarget)) setFieldFocused(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // A press anywhere while a field has focus: moving focus off the field (to the control that was
  // pressed) would let the mini phone grow back from 44px to 48x104, under the finger if the
  // control sits low on the screen, and the click would land on the phone instead. So it stays
  // round until that press is over, wherever it began. `pointerdown` comes before the focus change.
  useEffect(() => {
    if (!fieldFocused) return;
    const onPointerDown = () => setPressed(true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [fieldFocused]);
  useEffect(() => {
    if (!pressed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => setPressed(false);
    // The tap's click follows the pointer-up; a press that ends elsewhere has no click, so the
    // timer lets go of it anyway.
    const onPointerUp = () => {
      timer = setTimeout(release, 400);
    };
    // After the click, not before it: it stays round while the tap is delivered.
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

  // Closing the sheet puts focus back on the mini phone (it is shown again in the same commit).
  useEffect(() => {
    if (wasOpen.current && !sheetOpen) buttonRef.current?.focus({ preventScroll: true });
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);

  if (isDesktop) return null;

  const round = fieldFocused || pressed;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Open live preview"
        aria-haspopup="dialog"
        data-testid="mini-phone"
        data-round={round ? "true" : undefined}
        hidden={sheetOpen}
        onClick={() => setOpen(true)}
        style={{
          bottom: MINI_PHONE_BOTTOM,
          right: MINI_PHONE_RIGHT,
          width: round ? MINI_PHONE_ROUND : MINI_PHONE_WIDTH,
          height: round ? MINI_PHONE_ROUND : MINI_PHONE_HEIGHT,
        }}
        className={`fixed z-20 box-border flex cursor-pointer items-center justify-center overflow-hidden border border-line-3 bg-surface p-0 text-ink hl:hidden ${
          round ? "rounded-full" : "rounded-[8px]"
        }`}
      >
        {round ? <Icon icon={Smartphone} size={20} /> : null}
        {/* Kept mounted while it is round so it keeps following the draft; just not shown. */}
        <MiniThumbnail doc={doc} pageId={pageId} hidden={round} view={view} />
      </button>
      <FullPreviewSheet
        open={sheetOpen}
        onOpenChange={setOpen}
        doc={doc}
        pageId={pageId}
        chrome={chrome}
        onTap={onTap}
        themePreview={themePreview}
        view={view}
        onNavigate={onNavigate}
      />
    </>
  );
}
