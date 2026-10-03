import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toPlanId } from "@/lib/limits";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { StatsSource } from "../stats";
import type { DailyRow, DimName, DimRow, RawEvent } from "./aggregate";

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

export function createAdminStatsSource(client?: SupabaseClient): StatsSource {
  // The generated types do not know daily_dim_stats until they are regenerated; one untyped client
  // serves every read here, and the row shapes are declared where they are used.
  const db = client ?? (createAdminSupabase() as unknown as SupabaseClient);

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
      return { plan: toPlanId(plan), published: data.published ?? null };
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

    async dailyStats(pageId, fromDay, toDay) {
      return readAll<DailyRow>("daily_stats", (from, to) =>
        db
          .from("daily_stats")
          .select("day, block_id, views, clicks, uniques")
          .eq("page_id", pageId)
          .gte("day", fromDay)
          .lte("day", toDay)
          .order("day")
          .order("block_id")
          .range(from, to),
      );
    },

    async dailyDims(pageId, fromDay, toDay) {
      const rows = await readAll<{
        day: string;
        dim: DimName;
        value: string;
        views: number;
        clicks: number;
      }>("daily_dim_stats", (from, to) =>
        db
          .from("daily_dim_stats")
          .select("day, dim, value, views, clicks")
          .eq("page_id", pageId)
          .gte("day", fromDay)
          .lte("day", toDay)
          .order("day")
          .order("dim")
          .order("value")
          .range(from, to),
      );
      return rows satisfies DimRow[];
    },

    async rawEvents(pageId, fromIso) {
      // Keyset pagination on the primary key: stable while events keep arriving.
      const events: RawEvent[] = [];
      let lastId = 0;
      for (;;) {
        const { data, error } = await db
          .from("events")
          .select("id, ts, block_id, type, referrer, device, country, visitor_hash")
          .eq("page_id", pageId)
          .gte("ts", fromIso)
          .gt("id", lastId)
          .order("id")
          .limit(PAGE_SIZE);
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
