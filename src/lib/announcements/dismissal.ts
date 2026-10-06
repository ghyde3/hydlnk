/**
 * Dismissing the announcement is per browser (M13-09): the id of the announcement is the key, so a new
 * message shows again for someone who dismissed the last one. Storage can be missing, blocked or throw
 * (a private window, blocked site data), so every access is wrapped: when it fails the banner simply
 * shows, and a dismissal lasts until the page is left. Client-safe, no imports.
 */

export const DISMISS_KEY_PREFIX = "hl-announcement-dismissed:";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const keyOf = (id: string) => `${DISMISS_KEY_PREFIX}${id}`;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isDismissed(id: string, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(keyOf(id)) === "1";
  } catch {
    return false;
  }
}

export function dismiss(id: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(keyOf(id), "1");
  } catch {
    // Not saved: it hides for this visit only.
  }
}
