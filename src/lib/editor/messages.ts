/**
 * Editor copy that more than one module (or screen) shows. Sentence case, says what happened and
 * what to do. Typographic apostrophes, like the acceptance steps.
 */

/** The one wording of the save-failure state, used by the Editor and Design screens (M2-04). */
export const SAVE_FAILED_MESSAGE = "Couldn’t save. Your changes stay here and will retry.";
export const TOO_LARGE_MESSAGE = "This page is too large to save. Remove some content.";
export const INVALID_MESSAGE = "Some content can’t be saved. Shorten the longest fields.";
export const STALE_MESSAGE = "This page changed in another tab. Reload to keep editing.";
/** The session ended while the screen was open (the save was refused with 401): the edits stay on screen (M5-15). */
export const SIGNED_OUT_MESSAGE = "You’ve been signed out. Sign in to keep editing.";
/** The save was refused because a link points to a blocked site (M5-03): permanent, so no "will retry". */
export function blockedSaveMessage(hosts: readonly string[]): string {
  const where = hosts.length > 0 ? `: ${hosts.join(", ")}` : "";
  return `Not saved. A link on this page points to a blocked site${where}. Remove or change it.`;
}
/** Why Publish is off while a link points to a blocked site (M5-03). */
export const BLOCKED_PUBLISH_DISABLED_REASON =
  "A link on this page points to a blocked site. Remove or change it to publish.";
/** Publish pressed while a link is refused: nothing is sent, the note says why (M5-03). */
export const BLOCKED_PUBLISH_NOTE =
  "Couldn’t publish. A link points to a blocked site. Remove or change it.";
/** A page that cannot be read: the editor and Design show this card with Retry (M5-15, M5-16). */
export const LOAD_FAILED_MESSAGE = "We couldn’t load your page. Try again.";
/** Publish failed on the way (a 5xx or no network): the draft is stored, the live page is as it was (M5-15). */
export const PUBLISH_FAILED_MESSAGE = "Couldn’t publish. Your draft is safe. Try again.";
/** Publish refused by the rate limit (60 an hour per account, M11-12): the draft is safe. */
export const PUBLISH_RATE_LIMITED_MESSAGE =
  "Couldn’t publish. You’ve published a lot in the last hour. Wait a few minutes, then try again.";
/**
 * The account's sub-pages hold 64 MB (HL009): a save, a Publish or a new page was refused. Permanent
 * until content or pages are removed, so nothing says "will retry".
 */
export const STORAGE_FULL_MESSAGE =
  "Your sites have reached the 64 MB storage limit for pages. Remove some content or pages to keep saving.";
/** The Design screen's saved-themes row could not be read; the token controls and preview still work (M5-16). */
export const THEMES_LOAD_FAILED_MESSAGE = "We couldn’t load your themes. Try again.";
/** The Saved themes row of an account with no saved theme yet (M5-16). */
export const SAVED_THEMES_HINT =
  "Saved themes appear here. Use Save as theme to reuse this design on any page.";
/** The draft's theme was deleted (with the secret key, or from another page): it resolves to the default (M5-16). */
export const THEME_DELETED_NOTICE =
  "The theme this page used was deleted. It now uses the default theme.";
/** The page has blocks and every one is hidden (M5-15). */
export const ALL_HIDDEN_MESSAGE = "All blocks are hidden. Turn one on to show it.";

export const CORRUPTED_NOTICE =
  "Some content couldn’t be read and was reset in the editor. Nothing is saved until you edit.";
export const EMPTY_BLOCKS_MESSAGE = "No blocks yet. Add your first block above.";
export const BLOCK_LIMIT_MESSAGE = "You’ve reached the 50-block limit.";

/** The short save indicator next to the status chip. */
export const SAVE_INDICATOR = {
  saving: "Saving...",
  saved: "Saved",
  failed: "Not saved",
} as const;
