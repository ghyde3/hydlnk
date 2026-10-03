"use client";

import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import type { SaveStatus } from "@/lib/editor/autosave";
import {
  BLOCKED_PUBLISH_DISABLED_REASON,
  SAVE_INDICATOR,
  TOO_LARGE_MESSAGE,
} from "@/lib/editor/messages";
import type { PublishStatus } from "@/lib/editor/status";
import { PreviewLink } from "@/components/previews/preview-link";
import { SharePreview } from "@/components/previews/share-preview";
import { HistoryLink } from "@/components/versions/history-link";
import { PageName } from "./page-name";
import { QrCodeButton } from "./qr-dialog";
import { StatusChip } from "./status-chip";
import { UndoRedoButtons } from "./undo-redo-controls";
import type { UndoRedo } from "./use-undo-redo";

/** What the mono save indicator reads for each queue status (empty before the first edit). */
function indicatorText(status: SaveStatus): string {
  switch (status) {
    case "pending":
    case "saving":
      return SAVE_INDICATOR.saving;
    case "saved":
      return SAVE_INDICATOR.saved;
    case "too-large":
      // The indicator itself carries this one (M2-04 step 5): there is nothing to retry.
      return TOO_LARGE_MESSAGE;
    case "error":
    case "invalid":
    case "conflict":
    case "signed-out":
    case "blocked":
      return SAVE_INDICATOR.failed;
    case "idle":
      return "";
  }
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span aria-live="polite" data-save-status={status} className="font-mono text-xs text-text-2">
      {indicatorText(status)}
    </span>
  );
}

/**
 * The editor's header bar: mono breadcrumb over the 22px/700 title on the left; the status chip,
 * the save indicator, links to the page and the Publish button on the right. At 760px and up it is
 * one row; below, the right cluster wraps under the title. It is the direct child of <main> and the
 * only <p> in it is the breadcrumb, like every screen header (see src/components/app/screen.tsx).
 */
export function EditorHeader({
  breadcrumb,
  title,
  pageId,
  flush,
  status,
  saveStatus,
  liveUrl,
  previewUrl,
  publishing,
  blocked = false,
  undoRedo,
  qr,
  onPublish,
}: {
  breadcrumb: string;
  /** The page's name (`pages.name`, M6-13): the h1, with a "Rename page" button after it. */
  title: string;
  pageId: string;
  /** Writes pending edits and resolves true once they are stored (the autosave queue's flush). */
  flush: () => Promise<boolean>;
  status: PublishStatus;
  saveStatus: SaveStatus;
  /** The live page's address, shown as "View live page" once the page has been published. */
  liveUrl: string | null;
  previewUrl: string;
  publishing: boolean;
  /** A link on the page points to a blocked site (M5-03): nothing can be published until it is fixed. */
  blocked?: boolean;
  /** Undo and Redo (M6-07): two icon buttons to the left of the status chip. */
  undoRedo?: UndoRedo;
  /** The "QR code" button (M6-31): the page's handle (the file names) and the address it encodes. */
  qr?: { handle: string; address: string };
  onPublish: () => void;
}) {
  // A suspended owner cannot publish (M5-09): the server refuses it too (account_suspended).
  const suspended = useAccountSuspended();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-3.5 hl:px-8">
      <div className="min-w-0 hl:flex-1">
        <p className="font-mono text-xs text-text-2">{breadcrumb}</p>
        <PageName pageId={pageId} name={title} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {undoRedo ? <UndoRedoButtons controls={undoRedo} /> : null}
        <StatusChip status={status} />
        <SaveIndicator status={saveStatus} />
        {liveUrl ? (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-ink underline underline-offset-2"
          >
            View live page
          </a>
        ) : null}
        {qr ? (
          <QrCodeButton handle={qr.handle} address={qr.address} published={liveUrl !== null} />
        ) : null}
        <HistoryLink flush={flush} />
        <PreviewLink
          href={previewUrl}
          flush={flush}
          className="hidden min-h-11 items-center rounded-md border border-line-3 bg-surface px-3.5 text-sm font-semibold text-ink no-underline hl:inline-flex"
        >
          Preview
        </PreviewLink>
        <SharePreview pageId={pageId} flush={flush} />
        <button
          type="button"
          onClick={onPublish}
          disabled={publishing || suspended || blocked}
          aria-busy={publishing}
          title={
            suspended ? SUSPENDED_REASON : blocked ? BLOCKED_PUBLISH_DISABLED_REASON : undefined
          }
          className="min-h-11 rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-progress disabled:opacity-70"
        >
          {publishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </header>
  );
}
