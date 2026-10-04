import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M7-10 against the local Supabase stack, the one thing pgTAP cannot do: two flag jobs running at the
 * same moment. The rule's own cases are supabase/tests/database/140-traffic-two-months.test.sql; this
 * proves the advisory lock (and the one-unreviewed-flag index behind it) holds when the nightly job and
 * a manual call overlap, and that the two-month rule works through the real events -> rollup -> flag
 * pipeline with the secret key.
 */
const { run } = await stackIsUp();

/** The earlier month's last day and the later month's first day, UTC: both inside the 90 days of raw events. */
function seedDays(now = new Date()): { earlier: string; later: string; current: string } {
  const laterStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  return {
    earlier: new Date(laterStart - 86_400_000).toISOString().slice(0, 10),
    later: new Date(laterStart).toISOString().slice(0, 10),
    current: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10),
  };
}

describe.skipIf(!run)("M7-10 the flag job through the real pipeline (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];

  async function viewsOn(owner: TestOwner, day: string, count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      page_id: owner.pageId,
      block_id: "",
      type: "view",
      ts: `${day}T12:00:00Z`,
      referrer: "example.com",
      device: "mobile",
      country: "US",
      visitor_hash: `v${i % 50}`,
    }));
    const insert = await admin.from("events").insert(rows);
    expect(insert.error).toBeNull();
    const rolled = await admin.rpc("rollup_daily_stats", { p_day: day });
    expect(rolled.error).toBeNull();
  }

  const flagsOf = async (owner: TestOwner) => {
    const { data, error } = await admin
      .from("traffic_flags")
      .select("views, views_previous_month, window_start, window_end, reviewed_at")
      .eq("page_id", owner.pageId);
    expect(error).toBeNull();
    return data ?? [];
  };

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (owners.length > 0) await removeOwners(admin, owners);
  });

  it("two overlapping calls create exactly one flag for a page, and neither fails", async () => {
    const owner = await makeOwner(admin, "tmlock");
    owners.push(owner);
    const days = seedDays();
    await viewsOn(owner, days.earlier, 60);
    await viewsOn(owner, days.later, 61);

    // A threshold of 50: this page is over it in both months. Whatever else the local database holds
    // that is also over it gets flagged by the first call; the point is this page's rows.
    const [first, second] = await Promise.all([
      admin.rpc("flag_high_traffic_pages", { threshold: 50 }),
      admin.rpc("flag_high_traffic_pages", { threshold: 50 }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(typeof first.data).toBe("number");
    expect(typeof second.data).toBe("number");

    const flags = await flagsOf(owner);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ views: 61, views_previous_month: 60, reviewed_at: null });
    expect(flags[0]!.window_start).toBe(
      new Date(Date.parse(days.later) - 86_400_000).toISOString().slice(0, 7) + "-01",
    );
    expect(flags[0]!.window_end).toBe(
      new Date(Date.parse(days.current) - 86_400_000).toISOString().slice(0, 10),
    );
  });

  it("one big month, or views only in the month so far, is never flagged, however low the threshold", async () => {
    const spike = await makeOwner(admin, "tmspike");
    const current = await makeOwner(admin, "tmcur");
    owners.push(spike, current);
    const days = seedDays();
    await viewsOn(spike, days.later, 80);
    await viewsOn(current, days.current, 80);
    // The current month's first day is today's month: it is rolled up like any day and must not count.
    const result = await admin.rpc("flag_high_traffic_pages", { threshold: 10 });
    expect(result.error).toBeNull();
    expect(await flagsOf(spike)).toEqual([]);
    expect(await flagsOf(current)).toEqual([]);
  });

  it("the function returns the number of flags it created, and a second call the same night returns 0 for the same pages", async () => {
    const owner = await makeOwner(admin, "tmcount");
    owners.push(owner);
    const days = seedDays();
    await viewsOn(owner, days.earlier, 30);
    await viewsOn(owner, days.later, 30);
    const first = await admin.rpc("flag_high_traffic_pages", { threshold: 25 });
    expect(first.error).toBeNull();
    expect(first.data as number).toBeGreaterThanOrEqual(1);
    expect(await flagsOf(owner)).toHaveLength(1);
    const second = await admin.rpc("flag_high_traffic_pages", { threshold: 25 });
    expect(second.error).toBeNull();
    expect(second.data).toBe(0);
    expect(await flagsOf(owner)).toHaveLength(1);
  });
});
