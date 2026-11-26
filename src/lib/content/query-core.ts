import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { decodeCursor, encodeCursor } from "./cursor";
import { failure } from "./errors";
import { ownedEntry, ownedSite } from "./guards";
import { LIST_SORTS, LIST_STATUSES } from "./schemas/enums";
import type { EntryStatus, ListSort, ListStatus } from "./schemas/enums";
import type { ContentActor, ContentResult } from "./types";

type Admin = SupabaseClient<Database>;

export { LIST_SORTS, LIST_STATUSES } from "./schemas/enums";
export type { EntryStatus, ListSort, ListStatus } from "./schemas/enums";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const statusOf = (row: { deleted_at: string | null; published_at: string | null }): EntryStatus =>
  row.deleted_at !== null ? "trashed" : row.published_at !== null ? "published" : "draft";

/** One entry with its draft and published copy. Reads check ownership only (trashed entries included). */
export async function getEntryWithClient(
  admin: Admin,
  input: { actor: ContentActor; entryId: string },
) {
  const owned = await ownedEntry(admin, input.actor.userId, input.entryId);
  if (!owned.ok) return owned;
  const e = owned.entry;
  return {
    ok: true as const,
    id: e.id,
    siteId: e.site_id,
    typeId: e.type_id,
    draft: e.draft,
    published: e.published,
    rev: Number(e.rev),
    status: statusOf(e),
    publishedAt: e.published_at,
    firstPublishedAt: e.first_published_at,
    scheduledAt: e.scheduled_at,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    deletedAt: e.deleted_at,
  };
}

export interface EntrySummary {
  id: string;
  rev: number;
  status: EntryStatus;
  title: string | null;
  slug: string | null;
  path: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A PostgREST filter value inside or(...): quoted so commas, parens and dots stay literal. */
const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const COLUMN: Record<ListSort, string> = {
  published_at: "published_at",
  updated_at: "updated_at",
  title: "draft->>title",
};

/** Page through a site's entries of one type: filters, one sort, a keyset cursor, at most 100 a page. */
export async function listEntriesWithClient(
  admin: Admin,
  input: {
    actor: ContentActor;
    siteId: string;
    typeKey: string;
    status?: ListStatus;
    termId?: string;
    q?: string;
    sort?: ListSort;
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  },
): Promise<ContentResult<{ items: EntrySummary[]; nextCursor: string | null }>> {
  const sort = input.sort ?? "published_at";
  if (!(LIST_SORTS as readonly string[]).includes(sort)) return failure("invalid", "Unknown sort.");
  const status = input.status;
  if (status !== undefined && !(LIST_STATUSES as readonly string[]).includes(status)) {
    return failure("invalid", "Unknown status.");
  }
  if (input.order !== undefined && input.order !== "asc" && input.order !== "desc") {
    return failure("invalid", "Unknown order.");
  }
  if (input.termId !== undefined && !/^[0-9a-f-]{36}$/i.test(input.termId)) {
    return failure("invalid", "Unknown term.");
  }
  if (input.q !== undefined && typeof input.q !== "string") return failure("invalid");
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && !cursor)
    return failure("invalid", "That page cursor isn’t valid.");
  if (cursor && sort !== "title" && cursor[0] !== null && Number.isNaN(Date.parse(cursor[0]))) {
    return failure("invalid", "That page cursor isn’t valid.");
  }
  const limit = Number.isFinite(input.limit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit as number)))
    : DEFAULT_LIMIT;
  const asc = (input.order ?? (sort === "title" ? "asc" : "desc")) === "asc";

  const site = await ownedSite(admin, input.actor.userId, input.siteId);
  if (!site.ok) return site;
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", site.site.id)
    .eq("key", String(input.typeKey))
    .maybeSingle();
  if (type.error) {
    console.error("[content] reading the type failed", type.error.message);
    return failure("error");
  }
  if (!type.data) return failure("not_found");

  const col = COLUMN[sort];
  const select =
    "id, rev, published_at, created_at, updated_at, deleted_at, title:draft->>title, slug:draft->>slug, path:draft->>path" +
    (input.termId ? ", content_entry_terms!inner(term_id)" : "");
  let query = admin
    .from("content_entries")
    .select(select)
    .eq("site_id", site.site.id)
    .eq("type_id", type.data.id);
  if (input.termId) query = query.eq("content_entry_terms.term_id", input.termId);
  if (status === undefined) query = query.is("deleted_at", null);
  else if (status === "draft") query = query.is("deleted_at", null).is("published_at", null);
  else if (status === "published")
    query = query.is("deleted_at", null).not("published_at", "is", null);
  else if (status === "trashed") query = query.not("deleted_at", "is", null);
  if (input.q) {
    query = query.ilike("draft->>title", `%${input.q.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (cursor) {
    const [value, id] = cursor;
    const cmp = asc ? "gt" : "lt";
    query = query.or(
      value === null
        ? `and(${col}.is.null,id.${cmp}.${id})`
        : `${col}.${cmp}.${quote(value)},${col}.is.null,and(${col}.eq.${quote(value)},id.${cmp}.${id})`,
    );
  }
  query = query.order(col, { ascending: asc, nullsFirst: false }).order("id", { ascending: asc });
  const rows = await query.limit(limit + 1);
  if (rows.error) {
    console.error("[content] listing entries failed", rows.error.message);
    return failure("error");
  }
  type Raw = {
    id: string;
    rev: number | string;
    published_at: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    title: string | null;
    slug: string | null;
    path: string | null;
  };
  const raw = rows.data as unknown as Raw[];
  const page = raw.slice(0, limit);
  const last = page[page.length - 1];
  const sortValue = (r: Raw) =>
    sort === "title" ? r.title : sort === "updated_at" ? r.updated_at : r.published_at;
  return {
    ok: true,
    items: page.map((r) => ({
      id: r.id,
      rev: Number(r.rev),
      status: statusOf(r),
      title: r.title,
      slug: r.slug,
      path: r.path,
      publishedAt: r.published_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
    })),
    nextCursor: raw.length > limit && last ? encodeCursor(sortValue(last), last.id) : null,
  };
}
