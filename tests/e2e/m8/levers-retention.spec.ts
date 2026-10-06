import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { url } from "../helpers";
import {
  ANALYTICS,
  dayAt,
  kpi,
  makeOwner,
  seed,
  signInOwner,
  type Owner,
  type SeedEvent,
} from "../m4/analytics-dash-helpers";

/**
 * M8-12: raw events are kept 60 days. A page whose views are 70 days old (rolled up by the nightly job,
 * then their raw events purged) still shows them in the 90-day and 1-year ranges, with their referrers,
 * devices and countries; a Free page still gets its 30 days and the upgrade cards for 90 days and a
 * year; the privacy page says 60 days. The nightly job itself is `purge_old_events()`, called here with
 * the secret key the way pg_cron calls it (the SQL is proved in supabase/tests/database/150-*.test.sql).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

let pro: Owner;
let free: Owner;

const views = (n: number, day: string, extra: Partial<SeedEvent> & { tag: string }): SeedEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    type: "view" as const,
    day,
    visitor: `${extra.tag}${i}`,
    referrer: extra.referrer,
    device: extra.device,
    country: extra.country,
  }));

const rawOlderThan60 = async (pageId: string) => {
  const { count, error } = await adminClient()
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("page_id", pageId)
    .lt("ts", `${dayAt(-60)}T00:00:00Z`);
  if (error) throw new Error(error.message);
  return count ?? 0;
};

test.beforeAll(async ({}, info) => {
  if (!desktopOnly(info)) return;
  [pro, free] = await Promise.all([makeOwner("rtp", "pro"), makeOwner("rtf", "free")]);

  // Pro: 12 views 70 days ago (mid.example, Germany, tablet), 20 views 120 days ago (old.example, France,
  // desktop) and 8 recent ones (new.example, United States, mobile): whole percentages in both ranges.
  await seed(pro.pageId, [
    ...views(12, dayAt(-70), { tag: "m", referrer: "mid.example", country: "DE", device: "tablet" }),
    ...views(20, dayAt(-120), {
      tag: "o",
      referrer: "old.example",
      country: "FR",
      device: "desktop",
    }),
    ...views(8, dayAt(-3), { tag: "n", referrer: "new.example", country: "US", device: "mobile" }),
  ]);
  // Free: 4 views 70 days ago and 3 views 5 days ago.
  await seed(free.pageId, [
    ...views(4, dayAt(-70), { tag: "fo" }),
    ...views(3, dayAt(-5), { tag: "fn" }),
  ]);

  // Before the purge the raw rows of 70 and 120 days ago are still there ...
  expect(await rawOlderThan60(pro.pageId)).toBe(32);
  const purged = await adminClient().rpc("purge_old_events");
  expect(purged.error).toBeNull();
  // ... and after it they are gone, for both pages.
  expect(await rawOlderThan60(pro.pageId)).toBe(0);
  expect(await rawOlderThan60(free.pageId)).toBe(0);
});

test.describe("M8-12 the dashboard reads the rollups, not the purged raw events", () => {
  test("M8-12 a Pro page still shows views from 70 days ago in the 90-day and 1-year ranges, with their breakdowns", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    await signInOwner(context, pro);

    await page.goto(`${ANALYTICS()}?range=90`);
    expect(await kpi(page, "Views")).toBe("20");
    await expect(page.getByTestId("breakdown-referrers").getByTestId("breakdown-row")).toHaveText([
      "mid.example 60%",
      "new.example 40%",
    ]);
    await expect(page.getByTestId("breakdown-devices").getByTestId("breakdown-row")).toHaveText([
      "Tablet 60%",
      "Mobile 40%",
    ]);
    await expect(page.getByTestId("breakdown-countries").getByTestId("breakdown-row")).toHaveText([
      "Germany 60%",
      "United States 40%",
    ]);

    await page.goto(`${ANALYTICS()}?range=365`);
    expect(await kpi(page, "Views")).toBe("40");
    await expect(page.getByTestId("breakdown-referrers").getByTestId("breakdown-row")).toHaveText([
      "old.example 50%",
      "mid.example 30%",
      "new.example 20%",
    ]);

    // Thirty days is only the recent views.
    await page.goto(`${ANALYTICS()}?range=30`);
    expect(await kpi(page, "Views")).toBe("8");
  });

  test("M8-12 a Free page still reads 30 days and gets the upgrade cards for 90 days and a year", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one project is enough");
    await signInOwner(context, free);
    await page.goto(`${ANALYTICS()}?range=30`);
    expect(await kpi(page, "Views")).toBe("3");

    for (const range of [90, 365]) {
      await page.goto(`${ANALYTICS()}?range=${range}`);
      const card = page.getByTestId("upgrade-card");
      await expect(
        card.getByRole("heading", { name: "Longer ranges come with Pro" }),
      ).toBeVisible();
      await expect(page.getByTestId("kpi-strip")).toHaveCount(0);
    }
  });
});

test.describe("M8-12 the copy says 60 days", () => {
  test("M8-12 the privacy page and the Link analytics page name the 60 days, and none of them says the raw retention is 90", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "static copy: one project is enough");
    await page.goto(url(null, "/privacy"));
    const privacy = page.locator(".prose-hl");
    await expect(privacy).toContainText("kept for 60 days, then combined into daily totals");
    await expect(privacy).toContainText(
      "Individual visitor events: 60 days, then only daily totals remain",
    );
    await expect(privacy).not.toContainText(/kept for 90 days/);

    await page.goto(url(null, "/link-analytics"));
    await expect(page.locator("main")).toContainText(
      "Individual views and clicks are kept for 60 days, then combined into daily totals.",
    );
    await expect(page.locator("main")).not.toContainText(/kept for 90 days/);
  });
});
