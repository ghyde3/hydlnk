import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  getPublishedHomeWithClient,
  listDraftPagesWithClient,
  mergeHomePublished,
} from "@/lib/site/page-entries";
import type { StatsSource } from "../stats";
import type { DailyRow, DimName, DimRow, RawEvent } from "./aggregate";
import {
  HOME_SUB_PAGE_ID,
  PAGE_FILTER_ALL,
  PAGE_FILTER_HOME,
  POST_OPTIONS_MAX,
  archiveLabel,
  postOptionTitle,
  type PageFilter,
  type SubPageInfo,
} from "./page-filter";

/**
 * The production `StatsSource`: reads with the secret key, because `events` has no client access
 * at all. RLS does not apply to these queries, so the rules are in the code: the page is looked up
 * filtered on its owner (`resolvePage`), and every other read is keyed by the page id that lookup
 * approved. Nothing here writes.
 *
 * Postgres hands back at most 1,000 rows per request, so every read pages through its result.
 * `MAX_ROWS` is a backstop against a runaway table, not a business rule: past it the read fails
 * loudly (the screen shows "We couldn't load your stats") instead of showing an undercount.
 */

const PAGE_SIZE = 1000;
const MAX_ROWS = 250_000;

interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Offset pagination for reads with a total order (daily_stats, daily_dim_stats). */
async function readAll<T>(
  what: string,
  run: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
    if (rows.length >= MAX_ROWS)
      throw new Error(`Reading ${what} returned more than ${MAX_ROWS} rows`);
  }
}

/** Narrows a rollup read (daily_stats, daily_dim_stats) to a page of the site; `all` adds nothing. */
function rollupPage<Q>(query: Q, filter: PageFilter): Q {
  if (filter === PAGE_FILTER_ALL) return query;
  const page = filter === PAGE_FILTER_HOME ? HOME_SUB_PAGE_ID : filter;
  return (query as unknown as { eq(column: string, value: string): Q }).eq("sub_page_id", page);
}

/** How many ids with history that are no listed page are checked against the site's posts, and per read. */
export const POST_LOOKUP_MAX = 200;
const POST_LOOKUP_CHUNK = 100;

/** The blog's part of the page filter, and what `hiddenHistoryIds` needs to tell a post from a deleted page. */
export interface BlogPages {
  /** One entry per enabled archive, under the content type's id. */
  archives: SubPageInfo[];
  /** Every content type of the site that has an archive, on or off. */
  typeIds: string[];
  /** The ones whose archive is on: only their posts are live. */
  enabledTypeIds: string[];
}

/**
 * The blog's archives in the page filter (M16-11), for a site the owner lookup already approved:
 * each content type of the site whose archive is on, one entry under the type's id (its archive,
 * paging and term pages all count there), "Blog" for the built-in Post type. One read, keyed by
 * that site id, and not of a stats table (a refused range still reads none). The posts are named by
 * `readViewedPosts`, after the plan check.
 */
export async function readBlogPages(db: SupabaseClient, siteId: string): Promise<BlogPages> {
  const types = await db
    .from("content_types")
    .select("id, key, label_plural, enabled")
    .eq("site_id", siteId)
    .neq("key", "page")
    .not("archive_path", "is", null)
    .order("position");
  if (types.error) throw new Error(`Reading the content types failed: ${types.error.message}`);
  const rows = (types.data ?? []) as {
    id: string;
    key: string;
    label_plural: string;
    enabled: boolean;
  }[];
  const enabled = rows.filter((row) => row.enabled);
  return {
    archives: enabled.map((row) => ({
      id: row.id.toLowerCase(),
      title: archiveLabel({ key: row.key, labelPlural: row.label_plural }),
    })),
    typeIds: rows.map((row) => row.id.toLowerCase()),
    enabledTypeIds: enabled.map((row) => row.id.toLowerCase()),
  };
}

/** How many of the newest page-level rows and view events are read to find the viewed posts. */
const VIEWED_ROWS_MAX = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The posts the page filter names (M16-11): the site's LIVE posts that have views in the range,
 * most viewed first, at most `POST_OPTIONS_MAX`, each by its published title. This reads history,
 * so it is only called after the plan check, with the first day of a window the plan allows.
 *
 *   1. the page-level rollup rows of the range with views (the `VIEWED_ROWS_MAX` largest) and the
 *      newest view events of the range (days the rollup has not written yet), keyed by the site id
 *      the owner lookup approved;
 *   2. the ids found there that are not a page or an archive already listed (`listed`), plus the
 *      selected id, so a post that is open in the filter keeps its title in a range it has no view
 *      in; at most `POST_LOOKUP_MAX` of them, the most viewed;
 *   3. of those, the site's own untrashed, published entries of its enabled archive types. Only the
 *      id and the published title are read: never a draft, never a body.
 *
 * An id that is no live post of this site (trashed, purged, unpublished, another site's) is not
 * returned: `historicPageIds` decides whether it reads "Deleted page" or gets no entry. A post of
 * the site with no view in the range has no entry; "All pages" and "Blog" are unaffected.
 */
export async function readViewedPosts(
  db: SupabaseClient,
  siteId: string,
  input: {
    /** The site's enabled archive types. None: the blog is off and nothing is read. */
    typeIds: readonly string[];
    /** The first UTC day of the range, `YYYY-MM-DD`. */
    fromDay: string;
    /** Ids the filter already lists (pages, archives): never asked for as posts. */
    listed: ReadonlySet<string>;
    selected: PageFilter;
  },
): Promise<SubPageInfo[]> {
  if (input.typeIds.length === 0) return [];
  const [stats, events] = await Promise.all([
    db
      .from("daily_stats")
      .select("sub_page_id, views")
      .eq("page_id", siteId)
      .eq("block_id", "")
      .neq("sub_page_id", HOME_SUB_PAGE_ID)
      .gte("day", input.fromDay)
      .gt("views", 0)
      .order("views", { ascending: false })
      .limit(VIEWED_ROWS_MAX),
    db
      .from("events")
      .select("sub_page_id")
      .eq("page_id", siteId)
      .eq("type", "view")
      .not("sub_page_id", "is", null)
      .gte("ts", `${input.fromDay}T00:00:00.000Z`)
      .order("id", { ascending: false })
      .limit(VIEWED_ROWS_MAX),
  ]);
  if (stats.error) throw new Error(`Reading daily_stats failed: ${stats.error.message}`);
  if (events.error) throw new Error(`Reading events failed: ${events.error.message}`);
  // A day can be in both reads (rolled up and still in events): the sum only orders the list.
  const views = new Map<string, number>();
  const count = (id: string | null, by: number) => {
    if (!id) return;
    const key = id.toLowerCase();
    if (!input.listed.has(key)) views.set(key, (views.get(key) ?? 0) + by);
  };
  for (const row of (stats.data ?? []) as { sub_page_id: string | null; views: number }[]) {
    count(row.sub_page_id, Number(row.views) || 0);
  }
  for (const row of (events.data ?? []) as { sub_page_id: string | null }[]) {
    count(row.sub_page_id, 1);
  }
  const ranked = [...views.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const asked = ranked.slice(0, POST_LOOKUP_MAX).map(([id]) => id);
  const selected =
    UUID.test(input.selected) && !input.listed.has(input.selected) ? input.selected : null;
  if (selected !== null && !asked.includes(selected)) asked.push(selected);
  if (asked.length === 0) return [];

  const titles = new Map<string, string>();
  for (let at = 0; at < asked.length; at += POST_LOOKUP_CHUNK) {
    const { data, error } = await db
      .from("content_entries")
      .select("id, title:published->>title")
      .eq("site_id", siteId)
      .in("type_id", [...input.typeIds])
      .in("id", asked.slice(at, at + POST_LOOKUP_CHUNK))
      .is("deleted_at", null)
      .not("published", "is", null);
    if (error) throw new Error(`Reading the post titles failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; title: unknown }[]) {
      titles.set(row.id.toLowerCase(), postOptionTitle(row.title));
    }
  }
  const live = asked.filter((id) => titles.has(id));
  const named = live.slice(0, POST_OPTIONS_MAX);
  // The selected post keeps its entry even when fifty others were viewed more.
  if (selected !== null && titles.has(selected) && !named.includes(selected)) {
    named[named.length - 1] = selected;
  }
  return named.map((id) => ({ id, title: titles.get(id)! }));
}

/**
 * Which ids with history get no entry in the page filter (M16-11): an archive that is off, and a
 * post of the site that still exists but is not among the listed ones (an older post of a large
 * blog). Without this each would read "Deleted page", which is only true of an id the site no
 * longer has. Ids of `candidates` are checked against the site's own untrashed entries of its
 * archive types, at most `POST_LOOKUP_MAX` of them; the ids past that are hidden unchecked.
 * "All pages" still counts every one.
 */
export async function hiddenHistoryIds(
  db: SupabaseClient,
  siteId: string,
  candidates: readonly string[],
  typeIds: readonly string[],
): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (typeIds.length === 0) return hidden;
  const types = new Set(typeIds);
  const unknown: string[] = [];
  for (const id of candidates) {
    if (types.has(id)) hidden.add(id);
    else unknown.push(id);
  }
  const asked = unknown.slice(0, POST_LOOKUP_MAX);
  for (const id of unknown.slice(POST_LOOKUP_MAX)) hidden.add(id);
  for (let at = 0; at < asked.length; at += POST_LOOKUP_CHUNK) {
    const { data, error } = await db
      .from("content_entries")
      .select("id")
      .eq("site_id", siteId)
      .in("type_id", [...typeIds])
      .in("id", asked.slice(at, at + POST_LOOKUP_CHUNK))
      .is("deleted_at", null);
    if (error) throw new Error(`Reading the posts with history failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) hidden.add(row.id.toLowerCase());
  }
  return hidden;
}

export function createAdminStatsSource(client?: SupabaseClient): StatsSource {
  // The generated types do not know daily_dim_stats until they are regenerated; one untyped client
  // serves every read here, and the row shapes are declared where they are used.
  const db = client ?? (createAdminSupabase() as unknown as SupabaseClient);

  // One source serves one load: what `resolvePage` listed for a site (its pages, archives and
  // posts, and its archive types) is what `historicPageIds` compares the history against.
  const listedOf = new Map<
    string,
    { ids: Set<string>; typeIds: string[]; enabledTypeIds: string[] }
  >();

  return {
    async resolvePage(ownerId, pageId) {
      const { data, error } = await db
        .from("pages")
        .select("published, accounts!inner(plan)")
        .eq("id", pageId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (error) throw new Error(`Looking up the page failed: ${error.message}`);
      if (!data) return null;
      const account = data.accounts as { plan?: unknown } | { plan?: unknown }[] | null;
      const plan = Array.isArray(account) ? account[0]?.plan : account?.plan;
      // Home's blocks and published state are its page entry; the sub-pages are the other page
      // entries (titles and published blocks only, never whole drafts). Reads are keyed by the
      // site the owner lookup just approved.
      const typed = db as unknown as Parameters<typeof getPublishedHomeWithClient>[0];
      const [home, pages] = await Promise.all([
        getPublishedHomeWithClient(typed, pageId),
        listDraftPagesWithClient(typed, pageId),
      ]);
      const subPages = pages.map((page) => {
        const published = page.published as { title?: unknown; blocks?: unknown } | null;
        const draftTitle = typeof page.draft.title === "string" ? page.draft.title.trim() : "";
        const publishedTitle = typeof published?.title === "string" ? published.title.trim() : "";
        return {
          id: page.id.toLowerCase(),
          title: publishedTitle || draftTitle || "Untitled page",
          // A live page has a live path; its link names are read from the blocks alone.
          published: page.livePath !== null ? { blocks: published?.blocks ?? [] } : null,
        };
      });
      // The blog (M16-11): its archive, as an entry of the page filter. No published document: an
      // archive has no click-tracked links. The posts are named by `viewedPosts`, which reads
      // history and so runs after the plan check.
      const blog = await readBlogPages(db, pageId);
      listedOf.set(pageId, {
        ids: new Set([...subPages, ...blog.archives].map((item) => item.id)),
        typeIds: blog.typeIds,
        enabledTypeIds: blog.enabledTypeIds,
      });
      return {
        plan: toPlanId(plan),
        published: mergeHomePublished(data.published, home),
        subPages: [...subPages, ...blog.archives.map((item) => ({ ...item, published: null }))],
      };
    },

    async viewedPosts(pageId, fromDay, selected) {
      const listed = listedOf.get(pageId);
      if (!listed) return [];
      return readViewedPosts(db, pageId, {
        typeIds: listed.enabledTypeIds,
        fromDay,
        listed: listed.ids,
        selected,
      });
    },

    async historicPageIds(pageId) {
      // Page-level rollup rows and recent raw events are enough to name every page with history:
      // a handful of rows per deleted page, never the whole table.
      const [stats, events] = await Promise.all([
        db
          .from("daily_stats")
          .select("sub_page_id")
          .eq("page_id", pageId)
          .eq("block_id", "")
          .neq("sub_page_id", HOME_SUB_PAGE_ID)
          .order("day", { ascending: false })
          .limit(1000),
        db
          .from("events")
          .select("sub_page_id")
          .eq("page_id", pageId)
          .not("sub_page_id", "is", null)
          .order("id", { ascending: false })
          .limit(1000),
      ]);
      if (stats.error) throw new Error(`Reading daily_stats failed: ${stats.error.message}`);
      if (events.error) throw new Error(`Reading events failed: ${events.error.message}`);
      const ids = new Set<string>();
      for (const row of [...(stats.data ?? []), ...(events.data ?? [])] as {
        sub_page_id: string | null;
      }[]) {
        if (row.sub_page_id) ids.add(row.sub_page_id.toLowerCase());
      }
      // An id the filter does not list is a "Deleted page" unless it is an existing post or an
      // archive that is off (M16-11): those get no entry.
      const listed = listedOf.get(pageId);
      if (!listed) return [...ids];
      const hidden = await hiddenHistoryIds(
        db,
        pageId,
        [...ids].filter((id) => !listed.ids.has(id)),
        listed.typeIds,
      );
      return [...ids].filter((id) => !hidden.has(id));
    },

    async hasActivity(pageId) {
      const [stats, events] = await Promise.all([
        db.from("daily_stats").select("page_id").eq("page_id", pageId).limit(1),
        db.from("events").select("id").eq("page_id", pageId).limit(1),
      ]);
      if (stats.error) throw new Error(`Reading daily_stats failed: ${stats.error.message}`);
      if (events.error) throw new Error(`Reading events failed: ${events.error.message}`);
      return (stats.data?.length ?? 0) > 0 || (events.data?.length ?? 0) > 0;
    },

    async dailyStats(pageId, fromDay, toDay, filter = PAGE_FILTER_ALL) {
      return readAll<DailyRow>("daily_stats", (from, to) =>
        rollupPage(
          db
            .from("daily_stats")
            .select("day, block_id, views, clicks, uniques")
            .eq("page_id", pageId)
            .gte("day", fromDay)
            .lte("day", toDay),
          filter,
        )
          .order("day")
          .order("sub_page_id")
          .order("block_id")
          .range(from, to),
      );
    },

    async dailySiteUniques(pageId, fromDay, toDay) {
      const rows = await readAll<{ day: string; uniques: number }>("daily_site_stats", (from, to) =>
        db
          .from("daily_site_stats")
          .select("day, uniques")
          .eq("page_id", pageId)
          .gte("day", fromDay)
          .lte("day", toDay)
          .order("day")
          .range(from, to),
      );
      return new Map(rows.map((row) => [row.day, row.uniques]));
    },

    async dailyDims(pageId, fromDay, toDay, filter = PAGE_FILTER_ALL) {
      const rows = await readAll<{
        day: string;
        dim: DimName;
        value: string;
        views: number;
        clicks: number;
      }>("daily_dim_stats", (from, to) =>
        rollupPage(
          db
            .from("daily_dim_stats")
            .select("day, dim, value, views, clicks")
            .eq("page_id", pageId)
            .gte("day", fromDay)
            .lte("day", toDay),
          filter,
        )
          .order("day")
          .order("sub_page_id")
          .order("dim")
          .order("value")
          .range(from, to),
      );
      return rows satisfies DimRow[];
    },

    async rawEvents(pageId, fromIso, filter = PAGE_FILTER_ALL) {
      // Keyset pagination on the primary key: stable while events keep arriving.
      const events: RawEvent[] = [];
      let lastId = 0;
      for (;;) {
        let query = db
          .from("events")
          .select("id, ts, block_id, type, referrer, device, country, visitor_hash, sub_page_id")
          .eq("page_id", pageId)
          .gte("ts", fromIso)
          .gt("id", lastId);
        // Raw events keep Home as null, the rollups as the nil uuid.
        if (filter === PAGE_FILTER_HOME) query = query.is("sub_page_id", null);
        else if (filter !== PAGE_FILTER_ALL) query = query.eq("sub_page_id", filter);
        const { data, error } = await query.order("id").limit(PAGE_SIZE);
        if (error) throw new Error(`Reading events failed: ${error.message}`);
        const batch = (data ?? []) as (RawEvent & { id: number })[];
        for (const row of batch) {
          events.push({
            ts: row.ts,
            block_id: row.block_id,
            type: row.type === "click" ? "click" : "view",
            referrer: row.referrer,
            device: row.device,
            country: row.country,
            visitor_hash: row.visitor_hash,
            sub_page_id: row.sub_page_id ?? null,
          });
        }
        if (batch.length < PAGE_SIZE) return events;
        lastId = batch[batch.length - 1]!.id;
        if (events.length >= MAX_ROWS) {
          throw new Error(`Reading events returned more than ${MAX_ROWS} rows`);
        }
      }
    },
  };
}
