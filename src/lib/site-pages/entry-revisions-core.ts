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
 * An entry's own revisions (M15-10 for pages, M16-15 for posts): the list, and restoring one into the page's DRAFT. Both wrap the
 * content writer and speak the editor's save vocabulary, like the save route's core next door. The
 * writer checks the owner (another account's entry answers like a missing one); this layer adds that
 * the entry must be an entry of the site named in the URL, of a type the caller serves (`typeKeys`,
 * pages only unless told otherwise) and not in the trash. Another account's entry, an entry of
 * another site, a type not served, a post of a blog that is off, a trashed entry and an unknown
 * revision all answer `missing`: one answer, so ids cannot be probed.
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

/** The types an entry route serves. A page route passes `PAGE_ONLY`; the revisions routes take posts too. */
export const PAGE_ONLY = ["page"] as const;
export const PAGE_OR_POST = ["page", "post"] as const;

/**
 * Whether `entryId` is an entry of `siteId` whose type is one of `typeKeys` (M16-15). A page always
 * counts; an entry of any other type counts only while its type is switched on for the site, so a
 * post of a blog that is off answers like a missing one. `trashed` says which side of the trash the
 * entry must be on: "no" (the default), "yes" (Restore) or "any" (a read). Throws when the read fails.
 */
export async function isEntryOfSite(
  admin: Admin,
  siteId: string,
  entryId: string,
  typeKeys: readonly string[],
  trashed: "no" | "yes" | "any" = "no",
): Promise<boolean> {
  if (!UUID.test(siteId) || !UUID.test(entryId)) return false;
  const found = await admin
    .from("content_entries")
    .select("id, deleted_at, content_types!inner(key, enabled)")
    .eq("id", entryId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (found.error) throw new Error(`Entry lookup failed: ${found.error.message}`);
  if (!found.data) return false;
  const type = found.data.content_types;
  if (!typeKeys.includes(type.key)) return false;
  if (type.key !== "page" && !type.enabled) return false;
  if (trashed === "any") return true;
  return (found.data.deleted_at !== null) === (trashed === "yes");
}

/** The page's revisions, newest first, without snapshots. */
export async function listPageRevisionsWithClient(
  admin: Admin,
  input: { userId: string; siteId: string; entryId: string; typeKeys?: readonly string[] },
): Promise<RevisionsResponse<RevisionsListBody>> {
  if (!UUID.test(input.siteId) || !UUID.test(input.entryId)) return MISSING;
  if (!(await isEntryOfSite(admin, input.siteId, input.entryId, input.typeKeys ?? PAGE_ONLY))) {
    return MISSING;
  }
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
  input: {
    userId: string;
    siteId: string;
    entryId: string;
    rev: unknown;
    expectedRev: unknown;
    typeKeys?: readonly string[];
  },
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
  if (!(await isEntryOfSite(admin, input.siteId, input.entryId, input.typeKeys ?? PAGE_ONLY))) {
    return MISSING;
  }
  const out = await restoreRevisionWithClient(admin, {
    actor: { userId: input.userId, source: "editor" },
    entryId: input.entryId,
    rev,
    expectedRev: expected,
  });
  if (!out.ok) return fromFailure(out);
  return { status: 200, body: { kind: "ok", rev: out.rev, unchanged: out.unchanged } };
}
