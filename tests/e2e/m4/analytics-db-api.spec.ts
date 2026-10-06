import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  setPlan,
  uniq,
} from "../fixtures/data";
import { addEvents, expectDenied, rest, rollupDay, rowsOf, utcDay } from "./analytics-db-helpers";

/**
 * M4-24, M4-25 and M4-30 (database side), through the front door: PostgREST with the publishable key.
 * The rollup, retention and plan-gating rules themselves are in supabase/tests/database/111-analytics
 * (pgTAP); these specs prove that nobody outside the server can run, write or read past them.
 *
 * Three users: A (Pro) and B (Free) for the cross-tenant checks, F (Free) for the 30-day window and
 * the plan flips. Their rollup rows come from real events and the secret-key rollup.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.afterAll(cleanupUsers);

interface Owner {
  id: string;
  email: string;
  pageId: string;
  jwt: string;
}

async function owner(label: string, plan: "free" | "pro"): Promise<Owner> {
  const user = await makeUser(label, { plan });
  const pageId = await insertPage(user.id, uniq(label));
  return { id: user.id, email: user.email, pageId, jwt: await accessTokenFor(user.email) };
}

let a: Owner;
let b: Owner;
let f: Owner;

test.beforeAll(async () => {
  a = await owner("adba", "pro");
  b = await owner("adbb", "free");
  f = await owner("adbf", "free");

  // A: day -3 (3 views from instagram, 2 clicks) and day -2 (2 views).
  await addEvents(a.pageId, [
    { day: utcDay(3), visitor: "a1", referrer: "instagram.com" },
    { day: utcDay(3), visitor: "a1", referrer: "instagram.com" },
    { day: utcDay(3), visitor: "a2", referrer: null },
    { day: utcDay(3), visitor: "a1", type: "click" },
    { day: utcDay(3), visitor: "a2", type: "click" },
    { day: utcDay(2), visitor: "a3" },
    { day: utcDay(2), visitor: "a4" },
  ]);
  // F: yesterday (2 views, 1 click) and 40 days ago (2 views).
  await addEvents(f.pageId, [
    { day: utcDay(1), visitor: "f1" },
    { day: utcDay(1), visitor: "f2" },
    { day: utcDay(1), visitor: "f1", type: "click" },
    { day: utcDay(40), visitor: "f3" },
    { day: utcDay(40), visitor: "f4" },
  ]);
  for (const day of [3, 2, 1, 40]) await rollupDay(utcDay(day));
});

const ROLLUP_RPCS = [
  ["rollup_daily_stats", { p_day: "2026-01-01" }],
  ["rollup_recent_days", { n: 1 }],
  ["run_nightly_maintenance", {}],
] as const;

test.describe("M4-24 the rollup and its tables", () => {
  test("M4-24 the secret-key rollup wrote the page and block rows and the breakdowns the owner reads", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    const stats = rowsOf(
      await rest(`daily_stats?page_id=eq.${a.pageId}&order=day,block_id`, { jwt: a.jwt }),
      "A's daily_stats",
    );
    expect(stats.map((r) => [r.day, r.block_id, r.views, r.clicks, r.uniques])).toEqual([
      [utcDay(3), "", 3, 2, 2],
      [utcDay(3), "Bt5rJ1fGz6Os", 0, 2, 2],
      [utcDay(2), "", 2, 0, 2],
    ]);
    const referrers = rowsOf(
      await rest(
        `daily_dim_stats?page_id=eq.${a.pageId}&dim=eq.referrer&day=eq.${utcDay(3)}&order=value`,
        { jwt: a.jwt },
      ),
      "A's referrers",
    );
    expect(referrers.map((r) => [r.value, r.views])).toEqual([
      ["direct", 1],
      ["instagram.com", 2],
    ]);
  });

  test("M4-24 rpc/rollup_daily_stats, rollup_recent_days and run_nightly_maintenance are rejected for anon and authenticated", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    for (const [name, body] of ROLLUP_RPCS) {
      expectDenied(await rest(`rpc/${name}`, { method: "POST", body }), `anon ${name}`);
      expectDenied(
        await rest(`rpc/${name}`, { method: "POST", body, jwt: a.jwt }),
        `authenticated ${name}`,
      );
    }
  });

  test("M4-24 POST, PATCH and DELETE on daily_stats and daily_dim_stats are rejected for anon and authenticated, and the rows are unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    const attempts: [string, string, unknown][] = [
      [
        "daily_stats",
        "POST",
        { page_id: a.pageId, block_id: "", day: utcDay(10), views: 999999, clicks: 0, uniques: 0 },
      ],
      ["daily_stats", "PATCH", { views: 999999 }],
      ["daily_stats", "DELETE", undefined],
      [
        "daily_dim_stats",
        "POST",
        { page_id: a.pageId, day: utcDay(10), dim: "device", value: "mobile", views: 999999 },
      ],
      ["daily_dim_stats", "PATCH", { views: 999999 }],
      ["daily_dim_stats", "DELETE", undefined],
    ];
    for (const [table, method, body] of attempts) {
      const path = method === "POST" ? table : `${table}?page_id=eq.${a.pageId}`;
      expectDenied(await rest(path, { method, body }), `anon ${method} ${table}`);
      expectDenied(await rest(path, { method, body, jwt: a.jwt }), `owner ${method} ${table}`);
    }
    const admin = adminClient();
    const stats = await admin
      .from("daily_stats")
      .select("views")
      .eq("page_id", a.pageId)
      .eq("block_id", "");
    expect(stats.data?.map((r) => r.views).sort()).toEqual([2, 3]);
    const dims = await admin.from("daily_dim_stats").select("views").eq("page_id", a.pageId);
    expect(Math.max(...(dims.data ?? []).map((r) => r.views as number))).toBeLessThan(999999);
    expect(dims.data?.length ?? 0).toBeGreaterThan(0);
  });

  test("M4-24 tenant B's select on tenant A's daily_stats and daily_dim_stats returns no rows while A sees them", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    expect(
      rowsOf(await rest(`daily_stats?page_id=eq.${a.pageId}`, { jwt: b.jwt }), "B reads A stats"),
    ).toEqual([]);
    expect(
      rowsOf(
        await rest(`daily_dim_stats?page_id=eq.${a.pageId}`, { jwt: b.jwt }),
        "B reads A breakdowns",
      ),
    ).toEqual([]);
    expect(
      rowsOf(await rest(`daily_stats?page_id=eq.${a.pageId}`, { jwt: a.jwt }), "A reads A").length,
    ).toBe(3);
    // Anonymous: no privilege at all.
    expectDenied(await rest(`daily_stats?page_id=eq.${a.pageId}`), "anon reads daily_stats");
    expectDenied(
      await rest(`daily_dim_stats?page_id=eq.${a.pageId}`),
      "anon reads daily_dim_stats",
    );
  });
});

test.describe("M4-25 raw events are kept 60 days (M8-12, was 90)", () => {
  test("M4-25 rpc/purge_old_events is rejected for anon and authenticated and no events row is deleted", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    // 70 days old: past the 60 days of raw events, so the nightly purge would take it.
    const marker = `old70-${Date.now().toString(36)}`;
    await addEvents(a.pageId, [{ day: utcDay(70), visitor: marker }]);
    const present = async () =>
      (await adminClient().from("events").select("id").eq("visitor_hash", marker)).data?.length;
    expect(await present()).toBe(1);

    expectDenied(await rest("rpc/purge_old_events", { method: "POST", body: {} }), "anon purge");
    expectDenied(
      await rest("rpc/purge_old_events", { method: "POST", body: {}, jwt: a.jwt }),
      "authenticated purge",
    );
    // Not through the table either.
    expectDenied(
      await rest("events?visitor_hash=eq.x", { method: "DELETE" }),
      "anon delete events",
    );
    expectDenied(
      await rest(`events?visitor_hash=eq.${marker}`, { method: "DELETE", jwt: a.jwt }),
      "owner delete events",
    );
    expect(await present()).toBe(1);
    // And the table is unreadable: raw events never reach a client.
    expectDenied(await rest("events", { jwt: a.jwt }), "owner reads events");
  });
});

test.describe("M4-30 Free owners see 30 days of daily_stats and no breakdowns", () => {
  test("M4-30 a Free JWT gets [] for stats older than 30 days and for daily_dim_stats; a plan flip applies at once", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    const oldStats = `daily_stats?page_id=eq.${f.pageId}&day=lt.${utcDay(30)}`;
    const dims = `daily_dim_stats?page_id=eq.${f.pageId}`;
    const recent = `daily_stats?page_id=eq.${f.pageId}&select=day,block_id&order=day,block_id`;

    // Free: the last 30 days only, and no breakdowns.
    expect(rowsOf(await rest(oldStats, { jwt: f.jwt }), "free, older rows")).toEqual([]);
    expect(rowsOf(await rest(dims, { jwt: f.jwt }), "free, breakdowns")).toEqual([]);
    expect(rowsOf(await rest(recent, { jwt: f.jwt }), "free, recent rows")).toEqual([
      { day: utcDay(1), block_id: "" },
      { day: utcDay(1), block_id: "Bt5rJ1fGz6Os" },
    ]);

    // Upgrade (what the Stripe webhook does): the same JWT now reads everything, at once.
    await setPlan(f.id, "pro");
    expect(rowsOf(await rest(oldStats, { jwt: f.jwt }), "pro, older rows")).toHaveLength(1);
    expect(rowsOf(await rest(dims, { jwt: f.jwt }), "pro, breakdowns").length).toBeGreaterThan(0);

    // Downgrade: gone again.
    await setPlan(f.id, "free");
    expect(rowsOf(await rest(oldStats, { jwt: f.jwt }), "free again, older rows")).toEqual([]);
    expect(rowsOf(await rest(dims, { jwt: f.jwt }), "free again, breakdowns")).toEqual([]);
  });

  test("M4-30 the 30-day window ends at today minus 29: that day is readable, the day before it is not", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    await addEvents(f.pageId, [
      { day: utcDay(29), visitor: "edge29" },
      { day: utcDay(30), visitor: "edge30" },
    ]);
    await rollupDay(utcDay(29));
    await rollupDay(utcDay(30));
    const days = rowsOf(
      await rest(`daily_stats?page_id=eq.${f.pageId}&block_id=eq.&select=day&order=day`, {
        jwt: f.jwt,
      }),
      "free, window edge",
    ).map((r) => r.day);
    expect(days).toContain(utcDay(29));
    expect(days).not.toContain(utcDay(30));
    expect(days).not.toContain(utcDay(40));
  });
});
