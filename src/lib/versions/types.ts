import type { PublishDoc, SubPagePublish } from "@/lib/document";

/**
 * What the two version actions (M6-49) answer, in one client-safe module (no server-only import), so
 * the history screen and the tests read the same shapes. A refusal is a short code, never a message:
 * the screen words it (src/lib/versions/messages.ts) and nothing about a document, a URL or another
 * page's ids travels back.
 *
 * The codes, in the order the actions check them:
 *   unauthorized       no session
 *   forbidden          the page is not the signed-in user's, or does not exist (the version id is not looked at yet)
 *   account_suspended  the owner's account is suspended
 *   plan_required      the plan keeps no versions (`versionsKept` is 0): no version row was read
 *   not_found          the version id is malformed, unknown or belongs to another page: one answer for all three
 *   error              anything else (a document that does not parse, a failed read or write)
 *   conflict           (restore) the draft changed between the read and the write: another tab saved
 *   blocked_link       (restore) the version links to a site that is on the blocklist now; `hosts` names them
 */
export type VersionFailureReason =
  "unauthorized" | "forbidden" | "account_suspended" | "plan_required" | "not_found" | "error";

/** One sub-page of a stored version, as the preview draws it (M12-04). */
export interface PreviewSubPage {
  id: string;
  path: string;
  title: string;
  /** The stored published form, parsed, with the images that are gone replaced by null. */
  doc: SubPagePublish;
}

/** Why a page of a version was left as it is by a restore (M12-04). */
export type NotRestoredReason = "deleted" | "changed" | "blocked_link" | "error";

/** A page of the restored version that the restore did not write, and why. */
export interface NotRestoredPage {
  id: string;
  path: string;
  title: string;
  reason: NotRestoredReason;
  /** `blocked_link` only: the hosts that are listed now. */
  hosts?: string[];
}

export type PreviewResult =
  | {
      ok: true;
      /** The version's sub-pages (the live ones when it was published), ordered by path. Empty for a version from before M2. */
      subPages: PreviewSubPage[];
      /** The stored publish form, parsed, with every image that is no longer stored replaced by null. */
      doc: PublishDoc;
      /** How many images (photo, card and image blocks, link thumbnails, the share image, the background) were removed. */
      missingImages: number;
    }
  | { ok: false; reason: VersionFailureReason };

export type RestoreResult =
  | {
      ok: true;
      /** The version number that was restored. */
      restored: number;
      missingImages: number;
      /** How many sub-page drafts were written (Home's always is). */
      pagesRestored: number;
      /** Pages of the version that were not written: deleted since, changed meanwhile, blocked or unreadable. */
      notRestored: NotRestoredPage[];
    }
  | { ok: false; reason: VersionFailureReason | "conflict" }
  | { ok: false; reason: "blocked_link"; hosts: string[] };

export type PreviewFailure = Extract<PreviewResult, { ok: false }>;
export type RestoreFailure = Extract<RestoreResult, { ok: false }>;
