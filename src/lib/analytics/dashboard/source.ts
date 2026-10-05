import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { StatsSource } from "../stats";
import type { DailyRow, DimName, DimRow, RawEvent } from "./aggregate";
import {
  HOME_SUB_PAGE_ID,
  PAGE_FILTER_ALL,
  PAGE_FILTER_HOME,
  type PageFilter,
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

/** The title a sub-page document carries ("" when it has none), read defensively from JSON. */
function titleOf(doc: unknown): string {
  if (typeof doc !== "object" || doc === null) return "";
  const title = (doc as { title?: unknown }).title;
  return typeof title === "string" ? title.trim() : "";
}

export function createAdminStatsSource(client?: SupabaseClient): StatsSource {
  // The generated types do not know daily_dim_stats until they are regenerated; one untyped client
  // serves every read here, and the row shapes are declared where they are used.
  const db = client ?? (createAdminSupabase() as unknown as SupabaseClient);

  return {
    async resolvePage(ownerId, pageId) {
      const { data, error } = await db
        .from("pages")
        .select("published, accounts!inner(plan), site_pages(id, draft, published, created_at)")
        .eq("id", pageId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (error) throw new Error(`Looking up the page failed: ${error.message}`);
      if (!data) return null;
      const account = data.accounts as { plan?: unknown } | { plan?: unknown }[] | null;
      const plan = Array.isArray(account) ? account[0]?.plan : account?.plan;
      const rows = (data.site_pages ?? []) as {
        id: string;
        draft: unknown;
        published: unknown;
        created_at: string;
      }[];
      const subPages = rows
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((row) => ({
          id: row.id.toLowerCase(),
          title: titleOf(row.published) || titleOf(row.draft) || "Untitled page",
          published: row.published ?? null,
        }));
      return { plan: toPlanId(plan), published: data.published ?? null, subPages };
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
      return [...ids];
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
