import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { ContentSource, PublishRun } from "./types";

type Admin = SupabaseClient<Database>;

export type SitePagePublishWrite =
  | { ok: true; rev: number; publishedAt: string; unchanged: boolean }
  /** The database's refusal as raised (SQLSTATE and message): the Publish gate words it. */
  | { ok: false; code: string | null; message: string | null; detail: string | null };

/**
 * The one call of `publish_site_page` (M15-10): makes a validated published copy of ONE page entry
 * live. The Publish gate (`publishSitePageCore`, src/lib/publish/core.ts) validates the draft and
 * runs every check before it calls this; the function itself checks the owner, that the entry is a
 * page entry of that site and not in the trash, the entry's rev, that the site is live, and that no
 * id of the copy is used by another page's live copy (HL014, under the site's lock). It
 * writes that entry and its revision and nothing else: no other entry, not `pages`, not a version.
 * It lives here because only the content writer calls the functions that write entries.
 *
 * `fire` (Wave E): a claimed schedule's validated copy goes live through `fire_scheduled_publish`
 * instead, which takes the same locks, marks the schedule done in the same transaction and calls
 * `publish_site_page` at the entry's current rev with the scheduled time and source `system`.
 */
export async function publishSitePageWithClient(
  admin: Admin,
  input: {
    siteId: string;
    ownerId: string;
    entryId: string;
    expectedRev: number;
    published: unknown;
    publishedAt: string;
    source: ContentSource;
    fire?: Extract<PublishRun, { kind: "fire" }>;
  },
): Promise<SitePagePublishWrite> {
  const { data, error } = input.fire
    ? await admin.rpc("fire_scheduled_publish", {
        p_id: input.fire.scheduleId,
        p_claim: input.fire.claim,
        p_published: input.published as Json,
      })
    : await admin.rpc("publish_site_page", {
        p_site_id: input.siteId,
        p_owner_id: input.ownerId,
        p_entry_id: input.entryId,
        p_expected_rev: input.expectedRev,
        p_published: input.published as Json,
        p_published_at: input.publishedAt,
        p_source: input.source,
      });
  if (error) {
    return {
      ok: false,
      code: error.code ?? null,
      message: error.message ?? null,
      // HL014 names the clashing id here.
      detail: error.details ?? null,
    };
  }
  const out = (data ?? {}) as { rev?: unknown; published_at?: unknown; unchanged?: unknown };
  const rev = Number(out.rev);
  if (!Number.isSafeInteger(rev))
    return { ok: false, code: null, message: "bad_answer", detail: null };
  return {
    ok: true,
    rev,
    publishedAt: typeof out.published_at === "string" ? out.published_at : input.publishedAt,
    unchanged: out.unchanged === true,
  };
}
