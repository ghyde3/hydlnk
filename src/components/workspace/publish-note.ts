import {
  PUBLISH_FAILED_MESSAGE,
  PUBLISH_RATE_LIMITED_MESSAGE,
  STORAGE_FULL_MESSAGE,
} from "@/lib/editor/messages";
import type { PublishNote } from "./workspace-context";

/**
 * What the workspace says when a publish action was refused without field errors (M15-10): the
 * three actions (Publish all changes, Publish page, Publish design) share it. Pure, so a unit test
 * reads the same mapping the provider shows.
 *
 * `conflict` is the content writer's own sentence (`CONTENT_MESSAGES.conflict`, kept equal by a
 * test): what the editor holds is not what is stored any more, so pressing again cannot help and no
 * Retry is offered. Reloading is the way out.
 */
export const PUBLISH_CONFLICT_MESSAGE =
  "This was changed somewhere else. Reload to see the latest version.";
export const PUBLISH_NOT_FOUND_MESSAGE =
  "Couldn’t publish. That page isn’t part of this site any more. Reload to see the latest version.";
export const PUBLISH_UNSAVED_MESSAGE = "Couldn’t publish. Your latest changes aren’t saved yet.";
export const PUBLISH_SIGNED_OUT_MESSAGE = "Couldn’t publish. Sign in again, then try again.";

/** The reasons a publish action can answer (`PublishFailureReason`), plus none at all. */
export type PublishRefusal = string | undefined;

export function publishFailureNote(reason: PublishRefusal): PublishNote {
  switch (reason) {
    case "conflict":
      return { message: PUBLISH_CONFLICT_MESSAGE, retry: false };
    case "not_found":
      return { message: PUBLISH_NOT_FOUND_MESSAGE, retry: false };
    case "unauthorized":
      return { message: PUBLISH_SIGNED_OUT_MESSAGE, retry: false };
    case "account_suspended":
      return { message: "Couldn’t publish. Your account is suspended.", retry: false };
    case "rate_limited":
      return { message: PUBLISH_RATE_LIMITED_MESSAGE, retry: false };
    case "storage_full":
      return { message: STORAGE_FULL_MESSAGE, retry: false };
    default:
      return { message: PUBLISH_FAILED_MESSAGE, retry: true };
  }
}

/** What the revisions panel says when a restore was refused (the answer kinds of the restore route). */
export function restoreRevisionMessage(kind: string): string {
  switch (kind) {
    case "conflict":
      return PUBLISH_CONFLICT_MESSAGE;
    case "unauthorized":
      return "Couldn’t restore. Sign in again, then try again.";
    case "missing":
      return "That revision isn’t available any more. Reload to see the latest version.";
    case "blocked":
      return "That revision has a link to a blocked site, so it can’t be restored.";
    case "suspended":
      return "Couldn’t restore. Your account is suspended.";
    default:
      return "Couldn’t restore that revision. Your draft is safe. Try again.";
  }
}
