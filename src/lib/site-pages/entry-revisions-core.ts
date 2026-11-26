import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listRevisionsWithClient,
  restoreRevisionWithClient,
  type RevisionSummary,
} from "@/lib/content";
import type { Database } from "@/lib/supabase/database.types";
import { fromFailure, type EntrySaveBody } from "./entry-save-core";

/**
 * A page's own revisions (M15-10): the list, and restoring one into the page's DRAFT. Both wrap the
 * content writer and speak the editor's save vocabulary, like the save route's core next door. The
 * writer checks the owner (another account's entry answers like a missing one); this layer adds that
 * the entry must be a page entry of the site named in the URL and not in the trash. Another account's
 * entry, an entry of another site, a post, a trashed page and an unknown revision all answer
 * `missing`: one answer, so ids cannot be probed.
 *
 * Restore writes the draft only, through the writer's update (lenient schema, blocklist, the rev
 * guard, a new revision). It publishes nothing and no cache tag is expired: the restored page goes
 * live when the owner publishes it.
 */

type Admin = SupabaseClient<Database>;

export type RevisionsListBody =
  | { kind: "ok"; revisions: RevisionSummary[] }
  | { kind: "missing" }
  | { kind: "suspended"; code: string; message: string }
  | { kind: "error" };

export interface RevisionsResponse<Body> {
  status: number;
  body: Body;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = { status: 404, body: { kind: "missing" } } as const;

/** Whether `entryId` is a page entry of `siteId` that is not in the trash. Throws when the read fails. */
async function isPageOfSite(admin: Admin, siteId: string, entryId: string): Promise<boolean> {
  const found = await admin
    .from("content_entries")
    .select("id, content_types!inner(key)")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .eq("content_types.key", "page")
    .is("deleted_at", null)
    .maybeSingle();
  if (found.error) throw new Error(`Page entry lookup failed: ${found.error.message}`);
  return found.data !== null;
}

/** The page's revisions, newest first, without snapshots. */
export async function listPageRevisionsWithClient(
  admin: Admin,
  input: { userId: string; siteId: string; entryId: string },
): Promise<RevisionsResponse<RevisionsListBody>> {
  if (!UUID.test(input.siteId) || !UUID.test(input.entryId)) return MISSING;
  if (!(await isPageOfSite(admin, input.siteId, input.entryId))) return MISSING;
  const out = await listRevisionsWithClient(admin, {
    actor: { userId: input.userId, source: "editor" },
    entryId: input.entryId,
  });
  if (!out.ok) {
    const mapped = fromFailure(out);
    return mapped.body.kind === "missing" || mapped.body.kind === "suspended"
      ? { status: mapped.status, body: mapped.body }
      : { status: 500, body: { kind: "error" } };
  }
  return {
    status: 200,
    body: {
      kind: "ok",
      // Named fields only: a revision's snapshot never leaves the server through the list.
      revisions: out.revisions.map((revision) => ({
        rev: revision.rev,
        wasPublished: revision.wasPublished,
        source: revision.source,
        createdAt: revision.createdAt,
      })),
    },
  };
}

/** Save revision `rev`'s snapshot as the page's draft, at the entry rev the editor holds. */
export async function restorePageRevisionWithClient(
  admin: Admin,
  input: { userId: string; siteId: string; entryId: string; rev: unknown; expectedRev: unknown },
): Promise<RevisionsResponse<EntrySaveBody>> {
  const expected = input.expectedRev;
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 1) {
    return {
      status: 422,
      body: { kind: "invalid", message: "Send the revision you are editing." },
    };
  }
  const rev =
    typeof input.rev === "string" && /^[1-9][0-9]{0,15}$/.test(input.rev)
      ? Number(input.rev)
      : input.rev;
  if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 1) return MISSING;
  if (!UUID.test(input.siteId) || !UUID.test(input.entryId)) return MISSING;
  if (!(await isPageOfSite(admin, input.siteId, input.entryId))) return MISSING;
  const out = await restoreRevisionWithClient(admin, {
    actor: { userId: input.userId, source: "editor" },
    entryId: input.entryId,
    rev,
    expectedRev: expected,
  });
  if (!out.ok) return fromFailure(out);
  return { status: 200, body: { kind: "ok", rev: out.rev, unchanged: out.unchanged } };
}
