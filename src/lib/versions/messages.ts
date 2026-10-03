import { PLAN_LIMITS } from "@/lib/limits";
import type { RestoreFailure } from "./types";

/**
 * The words of the version history screen (M6-50), in one client-safe module so the screen, the
 * plan cards and the tests read the same sentences. Sentence case, plain, curly apostrophes
 * (docs/DESIGN.md -> Copy). Numbers come from the limits table, never typed here.
 */

export const HISTORY_TITLE = "Version history";
export const HISTORY_ROUTE = "/editor/history";

export const LOCKED_TITLE = "Version history comes with Pro";
/** "Pro keeps your last 25 published versions, so you can look back and restore one." */
export function lockedBody(): string {
  return `Pro keeps your last ${PLAN_LIMITS.pro.versionsKept} published versions, so you can look back and restore one.`;
}
export const EMPTY_MESSAGE = "No versions yet. Each time you publish, that version is kept here.";
export const LOAD_FAILED_MESSAGE = "We couldn’t load your versions. Try again.";

export const PREVIEW_FAILED_MESSAGE = "Couldn’t load that version. Try again.";

export function previewingStatus(versionNo: number): string {
  return `Previewing version ${versionNo}.`;
}

/** "2 images in this version are no longer stored." / "An image in this version is no longer stored." */
export function missingImagesNote(count: number): string {
  return count === 1
    ? "An image in this version is no longer stored."
    : `${count} images in this version are no longer stored.`;
}

export function confirmQuestion(versionNo: number): string {
  return `Restore version ${versionNo}? Your draft is replaced with this version. Your live page doesn’t change until you publish.`;
}
export const UNPUBLISHED_WARNING = "You have unpublished changes. They’ll be replaced.";

export const RESTORING = "Restoring…";

/** The success line; a restore with missing images adds the second sentence. */
export function restoredMessage(versionNo: number, missingImages: number): string {
  const head = `Restored version ${versionNo} to your draft. Review it in the editor, then publish.`;
  if (missingImages <= 0) return head;
  const tail =
    missingImages === 1
      ? "An image from this version is no longer stored. Add it again before you publish."
      : `${missingImages} images from this version are no longer stored. Add them again before you publish.`;
  return `${head} ${tail}`;
}
export const UNDONE = "Undone.";
export const UNDO_FAILED = "Couldn’t undo. Open the editor to check your draft.";

/** What each failed restore says, and whether it offers Retry (only the generic failure does). */
export function restoreFailureMessage(failure: RestoreFailure): {
  message: string;
  retry: boolean;
} {
  switch (failure.reason) {
    case "blocked_link": {
      const hosts = failure.hosts.length > 0 ? ` (${failure.hosts.join(", ")})` : "";
      return {
        message: `This version has a link to a blocked site${hosts}, so it can’t be restored.`,
        retry: false,
      };
    }
    case "conflict":
      return { message: "Your page changed in another tab. Reload, then try again.", retry: false };
    case "account_suspended":
      return { message: "Couldn’t restore. Your account is suspended.", retry: false };
    default:
      return {
        message: "Couldn’t restore that version. Your draft is safe. Try again.",
        retry: true,
      };
  }
}

/** The plan cards and the pricing table: a dash on a plan without history, the count on the others. */
export function versionHistoryCell(versionsKept: number): string {
  return versionsKept > 0 ? `Last ${versionsKept} versions` : "—";
}

/** The line a marketing plan card lists for a plan that keeps versions. */
export function versionHistoryItem(versionsKept: number): string {
  return `Version history, last ${versionsKept} versions`;
}
