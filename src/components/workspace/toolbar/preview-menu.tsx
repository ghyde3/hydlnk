"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useId, type MouseEvent } from "react";
import { Icon } from "@/components/app/icon";
import { isPlainClick } from "./plain-click";
import { MENU_ITEM_CLASS, ToolbarMenu, ToolbarMenuItem, useMenuApi } from "./toolbar-menu";

/** The description a disabled "View live page" carries until the page has been published. */
export const NOT_PUBLISHED_YET = "Not published yet";

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
          <Icon icon={ChevronDown} size={14} />
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
    // A modified click is left to the browser, and the menu closes as for any chosen item.
    if (!isPlainClick(event)) return;
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
      <ToolbarMenuItem asChild>
        <a
          href={draftHref}
          target="_blank"
          rel="noopener"
          data-menu-item="preview-draft"
          onClick={(event) => void openDraft(event)}
          className={MENU_ITEM_CLASS}
        >
          Preview your draft
        </a>
      </ToolbarMenuItem>
      {liveUrl ? (
        <ToolbarMenuItem asChild>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener"
            data-menu-item="view-live"
            className={MENU_ITEM_CLASS}
          >
            View live page
          </a>
        </ToolbarMenuItem>
      ) : (
        // `aria-disabled`, not Radix's `disabled`: it stays in the keyboard order and keeps its
        // description, and choosing it does nothing (the select is canceled, so the menu stays open).
        <ToolbarMenuItem asChild onSelect={(event) => event.preventDefault()}>
          <div
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
        </ToolbarMenuItem>
      )}
      <ToolbarMenuItem asChild>
        <Link
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
      </ToolbarMenuItem>
    </>
  );
}
