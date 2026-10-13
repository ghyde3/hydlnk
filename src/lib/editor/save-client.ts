import { readBlockedLinkError } from "@/lib/blocklist/error";
import { scheduleMediaCleanup } from "@/lib/media/cleanup-client";
import { postEntryDraft } from "@/lib/site-pages/entry-save-client";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { Json } from "@/lib/supabase/database.types";
import type { SaveFn, SaveResult } from "./autosave";

/** Home's page entry as the editor loaded it: the id to write to and the rev its saves are checked against. */
export interface HomeEntryRef {
  entryId: string;
  rev: number;
}

/**
 * The browser-side write of the draft (M2-04, 1b1-17). Home is two stored documents since the move:
 *
 *   - the design (profile, theme, menu, banner, share card) is `pages.draft` without `blocks`: a PATCH
 *     with the user's own session and the publishable key, so RLS decides. The update is conditional
 *     on the stored rev (`draft->>rev`): when another tab saved first it matches no row, and that is
 *     the stale-tab `conflict`. The frozen `blocks` there are never sent (the database keeps them);
 *   - Home's blocks are the '/' page entry: a POST to the entry save route under the entry's own rev.
 *
 * The blocks go first and only when they changed since the last write, so a theme edit costs one
 * request, and a refusal of the blocks (a blocked link, too large, a conflict) stops before the
 * design moves. Each counter advances on its own: a retry after a design conflict does not resend
 * blocks that were stored. A site with no Home entry (`home` null) still writes the whole document to
 * `pages.draft`, as before.
 *
 * A CHECK violation from `pages_draft_integrity` (SQLSTATE 23514, HTTP 400) means the draft is too
 * large for the database: terminal, not retried. A 401 means the session is gone (an expired token,
 * or no token at all, which PostgREST answers as the anonymous role): that is `unauthorized`, which
 * the queue does not retry on a timer (M5-15). SQLSTATE HL005 (a link points to a blocked site, HTTP
 * 400, M5-03) is `blocked`: permanent, with the hosts and block ids the database named. Everything
 * else (offline, 5xx) is a retryable `error`.
 */
export function createDraftSaver(pageId: string, home: HomeEntryRef | null = null): SaveFn {
  let homeRev = home?.rev ?? 0;
  // The blocks as last stored (or sent and accepted), compared as text.
  let storedBlocks: string | null = null;

  return async (doc, expectedRevKey) => {
    let design: unknown = doc;
    if (home) {
      const { blocks, ...rest } = doc;
      design = rest;
      const text = JSON.stringify(blocks);
      if (text !== storedBlocks) {
        const answer = await postEntryDraft(pageId, home.entryId, homeRev, {
          path: "/",
          title: "",
          description: "",
          blocks,
        });
        const failed = blocksFailure(answer);
        if (failed) return failed;
        if (answer.kind === "ok") homeRev = answer.rev;
        storedBlocks = text;
      }
    }

    const supabase = createBrowserSupabase();
    const update = supabase
      .from("pages")
      .update({ draft: design as unknown as Json })
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

/** The queue's result for a refused write of Home's blocks, or null when it was stored. */
function blocksFailure(answer: Awaited<ReturnType<typeof postEntryDraft>>): SaveResult | null {
  switch (answer.kind) {
    case "ok":
      return null;
    // Home's entry is gone or another writer moved it: reloading gives the editor the stored one.
    case "conflict":
    case "missing":
      return { kind: "conflict" };
    case "blocked":
      return { kind: "blocked", hosts: answer.hosts, blockIds: answer.blockIds };
    case "path":
      return { kind: "invalid" };
    case "suspended":
      return { kind: "unauthorized" };
    default:
      return { kind: answer.kind };
  }
}
