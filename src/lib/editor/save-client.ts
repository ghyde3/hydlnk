import { readBlockedLinkError } from "@/lib/blocklist/error";
import { scheduleMediaCleanup } from "@/lib/media/cleanup-client";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import type { SaveFn } from "./autosave";

/**
 * The browser-side write of the draft (M2-04): a PATCH of `{draft}` and nothing else, with the
 * user's own session and the publishable key, so RLS decides. The update is conditional on the
 * stored rev (`draft->>rev`): when another tab saved first it matches no row, and that is the
 * stale-tab `conflict`. A CHECK violation from `pages_draft_integrity` (SQLSTATE 23514, HTTP 400)
 * means the draft is too large for the database: terminal, not retried. A 401 means the session is
 * gone (an expired token, or no token at all, which PostgREST answers as the anonymous role): that
 * is `unauthorized`, which the queue does not retry on a timer (M5-15). SQLSTATE HL005 (a link
 * points to a blocked site, HTTP 400, M5-03) is `blocked`: permanent, with the hosts and block ids
 * the database named. Everything else (offline, 5xx) is a retryable `error`.
 */
export function createDraftSaver(pageId: string): SaveFn {
  return async (doc, expectedRevKey) => {
    const supabase = createBrowserSupabase();
    const update = supabase
      .from("pages")
      .update({ draft: doc as unknown as Json })
      .eq("id", pageId);
    const conditional =
      expectedRevKey === null
        ? update.is("draft->>rev", null)
        : update.eq("draft->>rev", expectedRevKey);
    const { data, error, status } = await conditional.select("id");
    if (error) {
      if (status === 401) return { kind: "unauthorized" };
      // A link to a blocked site (M5-03): the database refused the draft with HL005, and the same
      // draft is refused again, so it is a state of its own and never retried.
      const blocked = readBlockedLinkError(error);
      if (blocked) return { kind: "blocked", ...blocked };
      return error.code === "23514" ? { kind: "too-large" } : { kind: "error" };
    }
    if (data.length === 0) return { kind: "conflict" };
    // A save may have dropped an image reference: ask the server to work off its cleanup queue once
    // the Undo window has passed (M5-14).
    scheduleMediaCleanup();
    return { kind: "ok" };
  };
}
