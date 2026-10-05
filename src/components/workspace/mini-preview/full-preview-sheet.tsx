"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/app/icon";
import { PreviewFonts } from "@/components/design/tenant-fonts";
import { resolvePreviewTap, type PreviewTap } from "@/components/editor/preview-taps";
import type { PublishDoc } from "@/lib/document";
import type { PreviewSite } from "@/components/site/use-site-pages";
import { PageRenderer, type PageChrome } from "@/lib/editor/contracts";

/**
 * A theme on show in the sheet (M6-44, M7-06): the sheet draws a bar at its bottom, "Previewing
 * Paper" with "Apply Paper" and "Back to my style". The themes area's `ThemePreviewView` has this
 * shape and can be passed as it is.
 */
export interface SheetThemePreview {
  /** The previewed theme's name. */
  name: string;
  /** "Apply Paper": the sheet closes after calling it. */
  onApply: () => void;
  /** "Back to my style", Escape and "Close preview": the preview ends and the sheet closes. */
  onStop: () => void;
}

const APPLY =
  "inline-flex min-h-11 min-w-0 flex-1 basis-[150px] cursor-pointer items-center justify-center rounded-md bg-ink px-4 py-2 text-center text-sm font-semibold break-words text-surface";
const SECONDARY =
  "inline-flex min-h-11 min-w-0 flex-1 basis-[150px] cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 py-2 text-center text-sm font-semibold break-words text-ink";

/**
 * The full-size preview (M7-09): a full-screen sheet, a native `<dialog>` shown with `showModal()`
 * (so focus stays inside, the page behind is inert and Escape closes it), named "Live preview".
 * The page is drawn at full width with no bezel, by the same renderer, from the same publish form
 * the bezel and the mini phone use, so what was typed a moment ago is already in it. Its pinned top
 * bar holds "Close preview", where focus lands.
 *
 * While it is open the document does not scroll (the sheet scrolls inside itself); closing it puts
 * the document back where it was, unless a tap on the page sent the person to a field (then the
 * field's own scroll wins). It writes nothing: opening and closing it sends no request and leaves
 * the draft and its `rev` alone.
 *
 * Tap to edit (M6-03) works here as it does in the bezel: a tap on a block, a social icon, a grid
 * cell, the avatar, the name or the bio closes the sheet and calls `onTap`; a tap that means
 * nothing does nothing; a facade's Play button plays in place (M6-27). During a theme preview a tap
 * does nothing. Links never leave the app.
 *
 * Nothing is drawn while it is closed: the page inside only exists while the sheet is open.
 */
export function FullPreviewSheet({
  open,
  onOpenChange,
  doc,
  pageId,
  chrome,
  onTap,
  themePreview = null,
  view,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: PublishDoc;
  pageId: string;
  /** The footer links: "Made with HYDLNK" on Free, "Report this page" always. */
  chrome: PageChrome;
  /** What a tap on the page opens. The sheet is already closed when this is called. */
  onTap?: (tap: PreviewTap) => void;
  /** The rest of the site (M11-08): the menu, the page links and the sub-page drawn instead of Home. */
  view?: PreviewSite | undefined;
  /** A menu entry was pressed: the editor opens that page. */
  onNavigate?: ((href: string) => void) | undefined;
  themePreview?: SheetThemePreview | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savedScroll = useRef(0);
  const restoreScroll = useRef(true);
  const locked = useRef(false);

  function lock() {
    if (locked.current) return;
    locked.current = true;
    savedScroll.current = window.scrollY;
    document.documentElement.style.overflow = "hidden";
  }

  function unlock() {
    if (!locked.current) return;
    locked.current = false;
    document.documentElement.style.removeProperty("overflow");
    if (restoreScroll.current) window.scrollTo(0, savedScroll.current);
    restoreScroll.current = true;
  }

  // The dialog follows `open`. Showing it focuses the first focusable element: "Close preview".
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      lock();
      dialog.showModal();
    } else if (!open) {
      // Closed by the host, by Escape (the browser already closed it) or by a tap.
      if (dialog.open) dialog.close();
      unlock();
    }
  }, [open]);

  // Leaving while it is open (the workspace goes away) must not leave the document locked.
  useEffect(() => unlock, []);

  function onClickCapture(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target as Element;
    if (target.closest("a")) event.preventDefault();
    // A menu entry or the sub-page header's link (M11-08): the editor opens that page, the sheet stays.
    const nav = target.closest("a.pg-menu-item, a.pg-sitehead-link");
    if (nav && onNavigate) {
      event.stopPropagation();
      onNavigate(nav.getAttribute("href") ?? "/");
      return;
    }
    if (!onTap || themePreview) return;
    // A facade's Play button plays here, like on the live page (M6-27): it is not an edit tap.
    if (target.closest("button.pg-embed-play")) return;
    const tap = resolvePreviewTap(target, event.currentTarget);
    if (!tap) return;
    // Nothing inside the page reacts to a tap that opens the editor (the YouTube Play button).
    event.preventDefault();
    event.stopPropagation();
    // The sheet is closed and the page is live again before the editor is asked to scroll to a
    // field and take focus; the field's own scroll wins over the document's old position.
    restoreScroll.current = false;
    dialogRef.current?.close();
    flushSync(() => onOpenChange(false));
    unlock();
    onTap(tap);
  }

  /** "Close preview" and Escape: the person leaves; a theme on show ends with the sheet. */
  function dismiss() {
    themePreview?.onStop();
    onOpenChange(false);
  }

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Live preview"
      data-testid="preview-sheet"
      // Escape (and the Android back gesture) ask the dialog to cancel; the browser then closes it.
      onCancel={() => themePreview?.onStop()}
      onClose={() => onOpenChange(false)}
      className="m-0 hidden h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-page p-0 text-ink backdrop:bg-transparent open:flex"
    >
      {open ? (
        <>
          <div className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line bg-surface pt-[env(safe-area-inset-top)] pr-3 pl-4">
            <span className="font-mono text-xs tracking-[0.06em] text-text-2 uppercase">
              Live preview
            </span>
            <button
              type="button"
              onClick={dismiss}
              data-testid="preview-sheet-close"
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink"
            >
              <Icon icon={X} size={16} />
              Close preview
            </button>
          </div>
          <div
            data-testid="preview-screen"
            data-page-frame=""
            onClickCapture={onClickCapture}
            className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain ${
              onTap && !themePreview
                ? "[&_[data-block-id]]:cursor-pointer [&_[data-item-id]]:cursor-pointer [&_[data-profile-part]]:cursor-pointer [&_iframe]:pointer-events-none"
                : "[&_iframe]:pointer-events-none"
            }`}
          >
            <PreviewFonts tokens={doc.tokens} nameFont={doc.profile.nameFont} />
            <PageRenderer
              doc={doc}
              pageId={pageId}
              mode="preview"
              chrome={chrome}
              {...(view?.site ? { site: view.site } : {})}
              {...(view?.subPage ? { subPage: view.subPage } : {})}
            />
          </div>
          {themePreview ? (
            <div
              role="region"
              aria-label="Theme preview"
              data-testid="theme-preview-bar"
              className="flex shrink-0 flex-wrap items-stretch gap-2 border-t border-line bg-surface px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))]"
            >
              <p className="m-0 w-full text-sm font-semibold break-words">
                Previewing {themePreview.name}
              </p>
              <button
                type="button"
                data-testid="theme-preview-apply"
                onClick={() => {
                  themePreview.onApply();
                  onOpenChange(false);
                }}
                className={APPLY}
              >
                Apply {themePreview.name}
              </button>
              <button
                type="button"
                data-testid="theme-preview-stop"
                onClick={() => {
                  themePreview.onStop();
                  onOpenChange(false);
                }}
                className={SECONDARY}
              >
                Back to my style
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
