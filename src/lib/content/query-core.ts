import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { decodeCursor, encodeCursor } from "./cursor";
import { canonical } from "./entries-core";
import { failure } from "./errors";
import { entryFor, siteFor, siteType } from "./guards";
import { LIST_SORTS, LIST_STATUSES } from "./schemas/enums";
import type { EntryStatus, ListSort, ListStatus } from "./schemas/enums";
import type { EntrySummary } from "./schemas/summaries";
import { scheduleSummariesWithClient } from "./schedule-core";
import { NO_SCHEDULE } from "@/lib/schedule/types";
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
  const owned = await entryFor(admin, input.actor, input.entryId, "read");
  if (!owned.ok) return owned;
  const e = owned.entry;
  const type = await siteType(admin, e.site_id, e.type_id);
  if (!type.ok) return type;
  const schedules = await scheduleSummariesWithClient(admin, [
    { id: e.id, publishedAt: e.published_at },
  ]);
  if (!schedules) return failure("error");
  return {
    ok: true as const,
    schedule: schedules.get(e.id) ?? { ...NO_SCHEDULE },
    id: e.id,
    siteId: e.site_id,
    /** The site's owner, from the access helper: the account, plan and media folder of the entry. */
    ownerId: owned.access.ownerId,
    typeId: e.type_id,
    typeKey: type.type.key,
    hasUnpublishedChanges:
      e.deleted_at === null && e.published !== null && differs(e.draft, e.published),
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

export type { EntrySummary };

/** The draft against the published copy, key order aside (the compare a save uses to skip a no-op). */
const differs = (draft: unknown, published: unknown) => canonical(draft) !== canonical(published);

/**
 * Which of these live entries have a draft that differs from the published copy. Publish records a
 * revision at the rev it leaves, so an entry still at that rev has not been saved since and is
 * settled without reading its documents; only the rest are read and compared.
 */
async function changedSincePublish(
  admin: Admin,
  live: ReadonlyArray<{ id: string; rev: number }>,
): Promise<Set<string> | null> {
  const changed = new Set<string>();
  if (live.length === 0) return changed;
  const ids = live.map((row) => row.id);
  const marks = await admin
    .from("content_entry_revisions")
    .select("entry_id, rev")
    .in("entry_id", ids)
    .eq("was_published", true);
  if (marks.error) {
    console.error("[content] reading the published revisions failed", marks.error.message);
    return null;
  }
  const publishedAt = new Set(marks.data.map((mark) => `${mark.entry_id}:${Number(mark.rev)}`));
  const unsettled = live.filter((row) => !publishedAt.has(`${row.id}:${row.rev}`));
  if (unsettled.length === 0) return changed;
  const docs = await admin
    .from("content_entries")
    .select("id, draft, published")
    .in(
      "id",
      unsettled.map((row) => row.id),
    );
  if (docs.error) {
    console.error("[content] reading the entries failed", docs.error.message);
    return null;
  }
  for (const doc of docs.data) {
    if (doc.published !== null && differs(doc.draft, doc.published)) changed.add(doc.id);
  }
  return changed;
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

  const site = await siteFor(admin, input.actor, input.siteId, "read");
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

  // The term filter reads the DRAFT's terms (what the list shows), not `content_entry_terms`, which
  // holds the published copy's links only: a draft, or a post whose draft gained the term since its
  // last publish, matches too. A term of another site or type matches nothing.
  let termField: "categories" | "tags" | null = null;
  if (input.termId) {
    const term = await admin
      .from("content_terms")
      .select("taxonomy")
      .eq("id", input.termId)
      .eq("site_id", site.site.id)
      .eq("type_id", type.data.id)
      .maybeSingle();
    if (term.error) {
      console.error("[content] reading the term failed", term.error.message);
      return failure("error");
    }
    if (!term.data) return { ok: true, items: [], nextCursor: null };
    termField = term.data.taxonomy === "tag" ? "tags" : "categories";
  }

  const col = COLUMN[sort];
  const select =
    "id, rev, published_at, created_at, updated_at, deleted_at, title:draft->>title, slug:draft->>slug, path:draft->>path";
  let query = admin
    .from("content_entries")
    .select(select)
    .eq("site_id", site.site.id)
    .eq("type_id", type.data.id);
  if (termField)
    query = query.filter(`draft->terms->${termField}`, "cs", JSON.stringify([input.termId]));
  if (status === undefined) query = query.is("deleted_at", null);
  else if (status === "draft") query = query.is("deleted_at", null).is("published_at", null);
  else if (status === "published")
    query = query.is("deleted_at", null).not("published_at", "is", null);
  else if (status === "trashed") query = query.not("deleted_at", "is", null);
  // A pending scheduled publish (M20-10): `scheduled_at` mirrors it (a trigger on content_schedules).
  else if (status === "scheduled")
    query = query.is("deleted_at", null).not("scheduled_at", "is", null);
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
  const changed = await changedSincePublish(
    admin,
    page.filter((r) => statusOf(r) === "published").map((r) => ({ id: r.id, rev: Number(r.rev) })),
  );
  if (!changed) return failure("error");
  const schedules = await scheduleSummariesWithClient(
    admin,
    page.map((r) => ({ id: r.id, publishedAt: r.published_at })),
  );
  if (!schedules) return failure("error");
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
      hasUnpublishedChanges: changed.has(r.id),
      schedule: schedules.get(r.id) ?? { ...NO_SCHEDULE },
    })),
    nextCursor: raw.length > limit && last ? encodeCursor(sortValue(last), last.id) : null,
  };
}

/**
 * How many entries of one type a site holds, drafts and the trash included (as HL010 counts them).
 * A read: it checks ownership only. Another user's site, a missing one and an unknown type answer the
 * same `not_found`.
 */
export async function countEntriesWithClient(
  admin: Admin,
  input: { actor: ContentActor; siteId: string; typeKey: string },
): Promise<ContentResult<{ count: number }>> {
  const site = await siteFor(admin, input.actor, input.siteId, "read");
  if (!site.ok) return site;
  const type = await siteType(admin, site.site.id, input.typeKey);
  if (!type.ok) return type;
  const rows = await admin
    .from("content_entries")
    .select("id", { count: "exact", head: true })
    .eq("site_id", site.site.id)
    .eq("type_id", type.type.id);
  if (rows.error || rows.count === null) {
    console.error("[content] counting entries failed", rows.error?.message);
    return failure("error");
  }
  return { ok: true, count: rows.count };
}
