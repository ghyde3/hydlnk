import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectDenied, rest, rowsOf } from "../m4/analytics-db-helpers";
import { signInAsUser, tenantRaw } from "./admin-helpers";
import { SEED_VIEWS, flagOf, seedFlaggedPage, type FlaggedPage } from "./traffic-helpers";

/**
 * M5-10, through the front door: traffic_flags and the two functions around it are server only, and
 * a flag never changes how a page serves. The nightly job's thresholds, idempotence and 30-day
 * quiet period are in supabase/tests/database/113-traffic-flags (pgTAP).
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.afterAll(cleanupUsers);

test.describe("M5-10 traffic_flags is server only", () => {
  let flagged: FlaggedPage;
  let jwt: string;

  test.beforeAll(async ({ browser }, info) => {
    if (!desktopOnly(info)) return;
    flagged = await seedFlaggedPage(browser, "tfapi");
    jwt = await accessTokenFor(flagged.email);
  });

  test("M5-10 select, insert, update and delete on traffic_flags are rejected with the publishable key, anonymous and authenticated (even for the flagged page's owner)", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    const insert = {
      page_id: flagged.pageId,
      window_start: "2026-01-01",
      window_end: "2026-01-30",
      views: 1,
    };
    const attempts: [string, string, unknown][] = [
      ["GET", "traffic_flags", undefined],
      ["POST", "traffic_flags", insert],
      ["PATCH", `traffic_flags?id=eq.${flagged.flagId}`, { reviewed_at: new Date().toISOString() }],
      ["DELETE", `traffic_flags?id=eq.${flagged.flagId}`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      expectDenied(await rest(path, { method, body }), `anon ${method} ${path}`);
      expectDenied(await rest(path, { method, body, jwt }), `owner ${method} ${path}`);
    }
    // Untouched.
    const flag = await flagOf(flagged.pageId);
    expect(flag?.reviewed_at).toBeNull();
    expect(flag?.views).toBe(SEED_VIEWS);
  });

  test("M5-10 rpc/flag_high_traffic_pages and rpc/admin_traffic_flags are rejected with the publishable key", async ({}, info) => {
    test.skip(!desktopOnly(info), "API only");
    for (const [name, body] of [
      ["flag_high_traffic_pages", {}],
      ["flag_high_traffic_pages", { threshold: 1 }],
      ["admin_traffic_flags", {}],
    ] as const) {
      expectDenied(await rest(`rpc/${name}`, { method: "POST", body }), `anon ${name}`);
      expectDenied(await rest(`rpc/${name}`, { method: "POST", body, jwt }), `owner ${name}`);
    }
  });

  test("M5-10 flagged pages keep serving: the public page still returns 200 and pages.published is unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "serving does not depend on the viewport");
    const admin = adminClient();
    const page = await admin
      .from("pages")
      .select("published, published_at")
      .eq("id", flagged.pageId)
      .single();
    expect(page.error).toBeNull();
    expect(page.data?.published_at).not.toBeNull();

    const served = await tenantRaw(flagged.handle);
    expect(served.status).toBe(200);
    expect(served.body).toContain(flagged.handle);

    // The seeded demo page (Pro, never flagged) is a control: it serves too.
    expect((await tenantRaw("mara")).status).toBe(200);

    const after = await admin
      .from("pages")
      .select("published, published_at")
      .eq("id", flagged.pageId)
      .single();
    expect(after.data?.published).toEqual(page.data?.published);
    expect(after.data?.published_at).toBe(page.data?.published_at);
  });

  test("M5-10 another user's flagged page is not listed or readable through any client path", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "API only");
    const other = await signInAsUser(await browser.newContext(), "tfother");
    const otherJwt = await accessTokenFor(other.email);
    // They can read their own page row, and the flag table is closed to them all the same.
    expectDenied(
      await rest(`traffic_flags?page_id=eq.${flagged.pageId}`, { jwt: otherJwt }),
      "other user reads a flag",
    );
    // And they cannot see the flagged page's rollups either.
    expect(
      rowsOf(
        await rest(`daily_stats?page_id=eq.${flagged.pageId}`, { jwt: otherJwt }),
        "other user reads the flagged page's stats",
      ),
    ).toEqual([]);
  });
});
