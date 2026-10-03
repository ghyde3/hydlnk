import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import {
  ANALYTICS,
  dayAt,
  kpi,
  makeOwner,
  seed,
  signInOwner,
  type Owner,
  type SeedEvent,
} from "./analytics-dash-helpers";

/**
 * M4-28 (referrer, device and country cards) and the zero-range part of M5-17, on Pro pages whose
 * events went through the real rollup.
 *
 *   R  100 views five days ago: referrers instagram.com 54, tiktok.com 21, direct 14, google.com 7,
 *      bing.com 2, duckduckgo.com 2; devices mobile 86, desktop 12, tablet 2; countries US 71,
 *      DE 9, CA 8, GB 6, FR 6.
 *   T  three views yesterday, one per device.
 *   U  one view 20 days ago with no referrer, device or country.
 *   Y  views 120 days ago, rolled up and then purged from `events` (the 90 day retention), and one
 *      recent view: the one-year range must still show the old breakdowns.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

let r: Owner;
let t: Owner;
let u: Owner;
let y: Owner;

const spread = <T>(counts: [T, number][]): T[] =>
  counts.flatMap(([value, n]) => Array<T>(n).fill(value));

test.beforeAll(async () => {
  [r, t, u, y] = await Promise.all([
    makeOwner("bkr", "pro"),
    makeOwner("bkt", "pro"),
    makeOwner("bku", "pro"),
    makeOwner("bky", "pro"),
  ]);

  const referrers = spread<string | null>([
    ["instagram.com", 54],
    ["tiktok.com", 21],
    [null, 14],
    ["google.com", 7],
    ["bing.com", 2],
    ["duckduckgo.com", 2],
  ]);
  const devices = spread([
    ["mobile", 86],
    ["desktop", 12],
    ["tablet", 2],
  ]);
  const countries = spread([
    ["US", 71],
    ["DE", 9],
    ["CA", 8],
    ["GB", 6],
    ["FR", 6],
  ]);
  const day = dayAt(-5);
  await seed(
    r.pageId,
    referrers.map<SeedEvent>((referrer, i) => ({
      type: "view",
      day,
      visitor: `r${i}`,
      referrer,
      device: devices[i],
      country: countries[i],
    })),
  );

  await seed(
    t.pageId,
    ["mobile", "desktop", "tablet"].map<SeedEvent>((device, i) => ({
      type: "view",
      day: dayAt(-1),
      visitor: `t${i}`,
      device,
    })),
  );

  await seed(u.pageId, [
    { type: "view", day: dayAt(-20), visitor: "u1", referrer: null, device: null, country: null },
  ]);

  const old = dayAt(-120);
  await seed(y.pageId, [
    ...Array.from({ length: 12 }, (_, i): SeedEvent => ({
      type: "view",
      day: old,
      visitor: `y${i}`,
      referrer: "old.example",
      country: "FR",
      device: "desktop",
    })),
    ...Array.from({ length: 8 }, (_, i): SeedEvent => ({
      type: "view",
      day: old,
      visitor: `z${i}`,
      referrer: null,
      country: "FR",
      device: "desktop",
    })),
    {
      type: "view",
      day: dayAt(-3),
      visitor: "y-new",
      referrer: "new.example",
      country: "US",
      device: "mobile",
    },
  ]);
  // The 90 day retention: the raw rows go (after being rolled up), the rollups stay.
  const purged = await adminClient().rpc("purge_old_events");
  if (purged.error) throw new Error(`purge_old_events failed: ${purged.error.message}`);
});

const card = (page: import("@playwright/test").Page, id: "referrers" | "devices" | "countries") =>
  page.getByTestId(`breakdown-${id}`);

test.describe("M4-28 breakdown cards", () => {
  test("M4-28 shares of the range's views, exact whole percentages, top values plus Other", async ({
    page,
    context,
  }) => {
    await signInOwner(context, r);
    await page.goto(ANALYTICS());
    expect(await kpi(page, "Views")).toBe("100");

    for (const [id, title] of [
      ["referrers", "Top referrers"],
      ["devices", "Devices"],
      ["countries", "Countries"],
    ] as const) {
      await expect(card(page, id).getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(card(page, "referrers").getByTestId("breakdown-row")).toHaveText([
      "instagram.com 54%",
      "tiktok.com 21%",
      "Direct 14%",
      "google.com 7%",
      "Other 4%",
    ]);
    await expect(card(page, "devices").getByTestId("breakdown-row")).toHaveText([
      "Mobile 86%",
      "Desktop 12%",
      "Tablet 2%",
    ]);
    await expect(card(page, "countries").getByTestId("breakdown-row")).toHaveText([
      "United States 71%",
      "Germany 9%",
      "Canada 8%",
      "Other 12%",
    ]);

    // The bar is as wide as the percentage says (6px tall, brass on a track).
    const bar = card(page, "referrers")
      .getByTestId("breakdown-row")
      .first()
      .locator("span[aria-hidden]");
    const track = await bar.boundingBox();
    const fill = await bar.locator("span").boundingBox();
    expect(track!.height).toBe(6);
    expect(fill!.width / track!.width).toBeCloseTo(0.54, 2);
    expect(
      await card(page, "referrers")
        .getByTestId("breakdown-row")
        .first()
        .locator("span.font-mono")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toMatch(/mono/i);
  });

  test("M4-28 three equal thirds read 34, 33 and 33", async ({ page, context }) => {
    await signInOwner(context, t);
    await page.goto(`${ANALYTICS()}?range=7`);
    await expect(card(page, "devices").getByTestId("breakdown-row")).toHaveText([
      "Mobile 34%",
      "Desktop 33%",
      "Tablet 33%",
    ]);
  });

  test("M4-28 an empty referrer is Direct, unknown device and country are Unknown, and a card with no views says so", async ({
    page,
    context,
  }) => {
    await signInOwner(context, u);
    await page.goto(ANALYTICS());
    await expect(card(page, "referrers").getByTestId("breakdown-row")).toHaveText(["Direct 100%"]);
    await expect(card(page, "devices").getByTestId("breakdown-row")).toHaveText(["Unknown 100%"]);
    await expect(card(page, "countries").getByTestId("breakdown-row")).toHaveText(["Unknown 100%"]);

    // 7 days: the only view is 20 days old. Every card is empty and says so.
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    for (const id of ["referrers", "devices", "countries"] as const) {
      await expect(card(page, id)).toContainText("No data in this range yet.");
      await expect(card(page, id).getByTestId("breakdown-row")).toHaveCount(0);
    }
  });

  test("M4-28 one year reads daily_dim_stats rows older than 90 days even though the raw events are gone", async ({
    page,
    context,
  }) => {
    const raw = await adminClient()
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("page_id", y.pageId)
      .lt("ts", `${dayAt(-90)}T00:00:00Z`);
    expect(raw.count).toBe(0); // purged by the 90 day retention
    const rolled = await adminClient()
      .from("daily_dim_stats")
      .select("day")
      .eq("page_id", y.pageId)
      .eq("day", dayAt(-120));
    expect((rolled.data ?? []).length).toBeGreaterThan(0);

    await signInOwner(context, y);
    await page.goto(`${ANALYTICS()}?range=365`);
    expect(await kpi(page, "Views")).toBe("21");
    await expect(card(page, "referrers").getByTestId("breakdown-row")).toHaveText([
      "old.example 57%",
      "Direct 38%",
      "new.example 5%",
    ]);
    await expect(card(page, "countries").getByTestId("breakdown-row")).toHaveText([
      "France 95%",
      "United States 5%",
    ]);

    // 90 days sees only the recent view.
    await page.goto(`${ANALYTICS()}?range=90`);
    expect(await kpi(page, "Views")).toBe("1");
    await expect(card(page, "referrers").getByTestId("breakdown-row")).toHaveText([
      "new.example 100%",
    ]);
  });

  test("M4-28 the cards stack on a phone and sit three across on a desktop", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, r);
    await page.goto(ANALYTICS());
    await expect(card(page, "countries")).toBeVisible();
    await expectNoHorizontalScroll(page);
    const boxes = await Promise.all(
      (["referrers", "devices", "countries"] as const).map((id) => card(page, id).boundingBox()),
    );
    if (phoneOnly(info)) {
      expect(new Set(boxes.map((b) => Math.round(b!.x))).size).toBe(1);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
      expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y);
    }
    if (desktopOnly(info)) {
      expect(new Set(boxes.map((b) => Math.round(b!.y))).size).toBe(1);
      expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
      expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x);
      const strip = await page.getByTestId("kpi-strip").boundingBox();
      expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
    }
  });
});

test.describe("M5-17 a range with no events", () => {
  test("M5-17 zeros, a fallback axis maximum, no NaN heights, and 'No views in this range.'", async ({
    page,
    context,
  }) => {
    await signInOwner(context, u); // its only view is 20 days old
    await page.goto(`${ANALYTICS()}?range=7`);

    expect(await kpi(page, "Views")).toBe("0");
    expect(await kpi(page, "Clicks")).toBe("0");
    expect(await kpi(page, "Click-through")).toBe("—");
    expect(await kpi(page, "Unique visitors")).toBe("0");
    await expect(page.getByTestId("no-views")).toHaveText("No views in this range.");
    await expect(page.getByTestId("sample-chip")).toHaveCount(0);

    const chart = page.getByRole("img", { name: /^Daily views and clicks for / });
    await expect(chart.locator("[data-bar]")).toHaveCount(7);
    await expect(chart.locator('[data-bar="drawn"]')).toHaveCount(0);
    await expect(
      page.locator('[aria-hidden="true"]').filter({ hasText: /^10\s*5\s*0$/ }),
    ).toHaveCount(1);

    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    const html = await page.locator("main").innerHTML();
    expect(html).not.toMatch(/NaN|Infinity/);
    await expect(page.getByTestId("links-empty")).toContainText("No clicks in this range yet.");
  });

  test("M5-17 views without clicks: the table says no clicks yet and click-through is an em dash, never NaN", async ({
    page,
    context,
  }) => {
    await signInOwner(context, t);
    await page.goto(`${ANALYTICS()}?range=7`);
    expect(await kpi(page, "Views")).toBe("3");
    expect(await kpi(page, "Clicks")).toBe("0");
    expect(await kpi(page, "Click-through")).toBe("\u2014");
    await expect(page.getByTestId("links-empty")).toContainText(
      "No clicks yet. Clicks appear here once someone taps a link.",
    );
    await expect(page.getByTestId("link-row")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toMatch(/NaN|Infinity/);
  });
});
