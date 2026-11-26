import { uploadSiteHeaders } from "./upload-site";

/**
 * Browser side of the cleanup of replaced and removed images (M5-14). The draft is saved straight
 * from the browser, so after a save that may have dropped an image the editor asks the server to
 * work off the queue the database filled (POST /api/media/cleanup). The call carries no body, only
 * the site saved (`x-hl-site`): the server reads that site owner's queue once the user may edit it, deletes only what no draft, published page or theme
 * uses, and answers `{deleted, kept}`.
 *
 * It waits UNDO_WINDOW_MS after the LAST save, so deleting a block and pressing Undo (the toast
 * lasts 8 seconds) restores the block before anything is removed, and a burst of saves makes one
 * call. When the tab is hidden or closed the call goes out at once. Failures are ignored: the queue
 * is still there for the next call, the Publish action, or an upload that needs room.
 */

/** A little over the editor's 8 second Undo toast. */
export const UNDO_WINDOW_MS = 10_000;

export const MEDIA_CLEANUP_URL = "/api/media/cleanup";

let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** The site of the pending call (Wave F, R9): its OWNER's queue is the one a save may have filled. */
let pendingSite: string | null = null;

function send(): void {
  const site = pendingSite;
  pendingSite = null;
  try {
    void fetch(MEDIA_CLEANUP_URL, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: uploadSiteHeaders(site),
    }).catch(() => undefined);
  } catch {
    // Offline or blocked: the next save schedules it again.
  }
}

function flush(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  send();
}

/**
 * Call after every successful draft save (cheap: it only restarts a timer). `site` is the site saved
 * (sent as `x-hl-site`), so a member's save works off the site OWNER's queue (R9); a save of another
 * site sends the pending call first.
 */
export function scheduleMediaCleanup(
  site: string | null = null,
  delayMs: number = UNDO_WINDOW_MS,
): void {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
  if (timer !== null && pendingSite !== site) flush();
  if (timer !== null) clearTimeout(timer);
  pendingSite = site;
  timer = setTimeout(() => {
    timer = null;
    send();
  }, delayMs);
}

/** For tests: forget the pending call. */
export function cancelScheduledMediaCleanup(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pendingSite = null;
}
