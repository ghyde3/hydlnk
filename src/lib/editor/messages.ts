/**
 * Editor copy that more than one module (or screen) shows. Sentence case, says what happened and
 * what to do. Typographic apostrophes, like the acceptance steps.
 */

/** The one wording of the save-failure state, used by the Editor and Design screens (M2-04). */
export const SAVE_FAILED_MESSAGE = "Couldn’t save. Your changes stay here and will retry.";
export const TOO_LARGE_MESSAGE = "This page is too large to save. Remove some content.";
export const INVALID_MESSAGE = "Some content can’t be saved. Shorten the longest fields.";
export const STALE_MESSAGE = "This page changed in another tab. Reload to keep editing.";

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
