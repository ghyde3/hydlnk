import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import type { SaveFn } from "./autosave";

/**
 * The browser-side write of the draft (M2-04): a PATCH of `{draft}` and nothing else, with the
 * user's own session and the publishable key, so RLS decides. The update is conditional on the
 * stored rev (`draft->>rev`): when another tab saved first it matches no row, and that is the
 * stale-tab `conflict`. A CHECK violation from `pages_draft_integrity` (SQLSTATE 23514, HTTP 400)
 * means the draft is too large for the database: terminal, not retried. Everything else (offline,
 * 5xx, an expired token) is a retryable `error`.
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
    const { data, error } = await conditional.select("id");
    if (error) return error.code === "23514" ? { kind: "too-large" } : { kind: "error" };
    return data.length === 0 ? { kind: "conflict" } : { kind: "ok" };
  };
}
