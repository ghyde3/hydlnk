"use client";

import Link from "next/link";
import { useId, type MouseEvent } from "react";
import { isPlainClick } from "./plain-click";
import { MENU_ITEM_CLASS, ToolbarMenu, useMenuApi } from "./toolbar-menu";

/** The description a disabled "View live page" carries until the page has been published. */
export const NOT_PUBLISHED_YET = "Not published yet";

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * The toolbar's "Preview" menu (M7-05): the three ways to look at the page.
 *
 *   Preview your draft          the owner's own preview, `/preview/{pageId}`, in a new tab (a real
 *                               link: `target="_blank"`, `rel="noopener"`). A plain click first
 *                               writes the pending edits, as Publish does, so the new tab is never a
 *                               step behind what was just typed: the tab is opened inside the click
 *                               (so a popup blocker allows it) and pointed at the preview once
 *                               `flush` has stored them. A modified click is left to the browser.
 *   View live page              the published page in a new tab; `aria-disabled` with the
 *                               description "Not published yet" until the page has been published.
 *   Private preview link...     to the Share tab's card (`/share#preview-links`), focus on
 *                               "Create link".
 *
 * Nothing here changes the draft, adds an undo step or sends a request when the menu opens.
 */
export function PreviewMenu({
  pageId,
  flush,
  liveUrl,
  onOpenShare,
}: {
  pageId: string;
  /** Writes pending edits and resolves true once they are stored (the autosave queue's flush). */
  flush: () => Promise<boolean>;
  /** The live page's address, or null while the page has never been published. */
  liveUrl: string | null;
  /** Goes to the Share tab's card and focuses its first control. */
  onOpenShare: (target: "preview-links") => void;
}) {
  return (
    <ToolbarMenu
      label="Preview"
      buttonContent={
        <>
          Preview
          <Chevron />
        </>
      }
    >
      <PreviewItems pageId={pageId} flush={flush} liveUrl={liveUrl} onOpenShare={onOpenShare} />
    </ToolbarMenu>
  );
}

function PreviewItems({
  pageId,
  flush,
  liveUrl,
  onOpenShare,
}: {
  pageId: string;
  flush: () => Promise<boolean>;
  liveUrl: string | null;
  onOpenShare: (target: "preview-links") => void;
}) {
  const { close } = useMenuApi();
  const noteId = useId();
  const draftHref = `/preview/${pageId}`;

  async function openDraft(event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(event)) {
      close(false);
      return;
    }
    event.preventDefault();
    close(true);
    const tab = window.open("about:blank", "_blank");
    try {
      await flush();
    } catch {
      // The preview shows the last saved draft.
    }
    if (tab && !tab.closed) {
      tab.opener = null;
      tab.location.href = new URL(draftHref, window.location.href).toString();
    } else {
      window.open(draftHref, "_blank", "noopener");
    }
  }

  return (
    <>
      <a
        role="menuitem"
        tabIndex={-1}
        href={draftHref}
        target="_blank"
        rel="noopener"
        data-menu-item="preview-draft"
        onClick={(event) => void openDraft(event)}
        className={MENU_ITEM_CLASS}
      >
        Preview your draft
      </a>
      {liveUrl ? (
        <a
          role="menuitem"
          tabIndex={-1}
          href={liveUrl}
          target="_blank"
          rel="noopener"
          data-menu-item="view-live"
          onClick={() => close(false)}
          className={MENU_ITEM_CLASS}
        >
          View live page
        </a>
      ) : (
        <div
          role="menuitem"
          tabIndex={-1}
          aria-disabled="true"
          aria-describedby={noteId}
          data-menu-item="view-live"
          className={`${MENU_ITEM_CLASS} flex-col items-start gap-0 py-1.5`}
        >
          View live page
          <span id={noteId} className="text-xs font-normal">
            {NOT_PUBLISHED_YET}
          </span>
        </div>
      )}
      <Link
        role="menuitem"
        tabIndex={-1}
        href="/share#preview-links"
        data-menu-item="preview-link"
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          close(false);
          onOpenShare("preview-links");
        }}
        className={MENU_ITEM_CLASS}
      >
        Private preview link…
      </Link>
    </>
  );
}
