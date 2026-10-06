import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
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
 * M4-30: what a Free account may read, on the screen, in the stats route and in the database.
 *
 *   F  the account whose plan the tests flip. 34 completed days, 2 views from 2 visitors and 1
 *      click each, with referrers: older than the 30 day window on purpose.
 *   FE a Free account with a page that recorded nothing, and PE a Pro one, for the layout of
 *      the locked cards against the real ones (both show the sample set, so the cards line up).
 *
 * 30 days (Free window, today minus 29 .. today): 29 completed days = 58 views, 29 clicks, 50.0%,
 * 58 unique visitors. 7 days: 6 completed days = 12 views.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000, mode: "serial" });

let f: Owner;
let fe: Owner;
let pe: Owner;

const setPlan = async (owner: Owner, plan: "free" | "pro" | "studio") => {
  const { error } = await adminClient().from("accounts").update({ plan }).eq("id", owner.userId);
  if (error) throw new Error(`setting the plan failed: ${error.message}`);
};

test.beforeAll(async () => {
  [f, fe, pe] = await Promise.all([
    makeOwner("plf", "pro"),
    makeOwner("plfe", "free"),
    makeOwner("plpe", "pro"),
  ]);
  const events: SeedEvent[] = [];
  for (let o = 1; o <= 34; o++) {
    const day = dayAt(-o);
    events.push(
      { type: "view", day, visitor: "f1", referrer: "instagram.com" },
      { type: "view", day, visitor: "f2", referrer: null },
      { type: "click", day, visitor: "f1" },
    );
  }
  await seed(f.pageId, events);
});

const chips = (page: Page) =>
  page.getByRole("group", { name: "Date range" }).getByText("Pro", { exact: true });
const group = (page: Page) => page.getByRole("group", { name: "Date range" });

test.describe("M4-30 Free on the screen", () => {
  test.beforeAll(async () => setPlan(f, "free"));

  test("M4-30 7d and 30d work, 90d and 1y carry a Pro chip and show the upgrade card instead of data", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    await page.goto(ANALYTICS());

    expect(await kpi(page, "Views")).toBe("58");
    expect(await kpi(page, "Clicks")).toBe("29");
    expect(await kpi(page, "Click-through")).toBe("50.0%");
    expect(await kpi(page, "Unique visitors")).toBe("58");
    await expect(page.getByTestId("link-row")).toHaveCount(1);
    await expect(page.getByTestId("link-row")).toContainText("29");

    // Chips on exactly the two ranges Free cannot open.
    await expect(chips(page)).toHaveCount(2);
    await expect(
      group(page).getByRole("button", { name: "90d" }).getByText("Pro", { exact: true }),
    ).toBeVisible();
    await expect(
      group(page).getByRole("button", { name: "1y" }).getByText("Pro", { exact: true }),
    ).toBeVisible();
    await expect(group(page).getByRole("button", { name: "7d" }).getByText("Pro")).toHaveCount(0);
    await expect(group(page).getByRole("button", { name: "30d" }).getByText("Pro")).toHaveCount(0);

    await group(page).getByRole("button", { name: "7d" }).click();
    await expect.poll(() => kpi(page, "Views")).toBe("12");
    await expect(page.getByTestId("upgrade-card")).toHaveCount(0);

    // Choosing 90d: the request is refused, the card replaces the data.
    const refused = page.waitForResponse((res) => res.url().includes("/analytics/stats?range=90"));
    await group(page).getByRole("button", { name: "90d" }).click();
    const response = await refused;
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual(
      expect.objectContaining({ ok: false, error: "plan_required" }),
    );
    const card = page.getByTestId("upgrade-card");
    await expect(card.getByRole("heading", { name: "Longer ranges come with Pro" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Upgrade to Pro" })).toHaveAttribute(
      "href",
      "/settings#plans",
    );
    await expect(page.getByTestId("kpi-strip")).toHaveCount(0);
    await expect(page.getByTestId("links-card")).toHaveCount(0);
    await expect(group(page).getByRole("button", { name: "90d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page).toHaveURL(/range=90/);

    // Back to a range Free has: the data is back.
    await group(page).getByRole("button", { name: "30d" }).click();
    await expect.poll(() => kpi(page, "Views")).toBe("58");
  });

  test("M4-30 loading ?range=90 or ?range=365 shows the card, not data", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    for (const value of ["90", "365"]) {
      await page.goto(`${ANALYTICS()}?range=${value}`);
      await expect(page.getByTestId("upgrade-card")).toContainText("Longer ranges come with Pro");
      await expect(page.getByTestId("kpi-strip")).toHaveCount(0);
      await expect(page.getByTestId("chart-card")).toHaveCount(0);
      // The server rendered the card: the HTML itself has no numbers of the page.
      const html = await (await page.request.get(`${ANALYTICS()}?range=${value}`)).text();
      expect(html).toContain("Longer ranges come with Pro");
      expect(html).not.toContain("Views and clicks per day");
    }
  });

  test("M4-30 the three breakdown cards are locked and the footnote says what Free gets", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    await page.goto(ANALYTICS());
    const locked = page.getByTestId("locked-card");
    await expect(locked).toHaveCount(3);
    await expect(page.getByTestId("breakdown-referrers")).toHaveCount(0);
    for (const [index, title] of ["Top referrers", "Devices", "Countries"].entries()) {
      await expect(locked.nth(index).getByRole("heading", { name: title })).toBeVisible();
      await expect(locked.nth(index)).toContainText("Included with Pro");
      await expect(locked.nth(index).getByRole("link", { name: "See plans" })).toHaveAttribute(
        "href",
        "/settings#plans",
      );
    }
    await expect(page.getByTestId("analytics-footnote")).toHaveText(
      "Counted without cookies. Bots are filtered out before anything is stored. On Free, your site shows 30 days of per-link clicks; referrers, devices and countries come with Pro.",
    );
    // Neither the raw referrers of the page nor a breakdown row leaks into the HTML.
    expect(await page.locator("main").innerText()).not.toContain("instagram.com");
  });

  test("M4-30 the stats route refuses 90 and 365 for Free and sends no breakdowns for 7 and 30", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    for (const range of [90, 365]) {
      const res = await page.request.get(`${ANALYTICS()}/stats?range=${range}`);
      expect(res.status()).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: "plan_required" });
      expect(JSON.stringify(body)).not.toMatch(/kpis|views|instagram/);
    }
    for (const range of [7, 30]) {
      const res = await page.request.get(`${ANALYTICS()}/stats?range=${range}`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.breakdowns).toBeNull();
      expect(JSON.stringify(body)).not.toContain("instagram");
    }
  });

  test("M4-30 abuse: a Free JWT and the publishable key read nothing older than 30 days and no breakdowns", async ({
    context,
  }) => {
    await signInOwner(context, f);
    const token = await accessTokenFor(f.email);
    const old = await restAs(token, `/daily_stats?page_id=eq.${f.pageId}&day=lt.${dayAt(-30)}`);
    expect(old).toEqual({ status: 200, body: [] });
    const edge = await restAs(token, `/daily_stats?page_id=eq.${f.pageId}&day=eq.${dayAt(-30)}`);
    expect(edge.body).toEqual([]);
    const dims = await restAs(token, `/daily_dim_stats?page_id=eq.${f.pageId}`);
    expect(dims).toEqual({ status: 200, body: [] });
    // The 30 days that are allowed are there.
    const inside = await restAs(
      token,
      `/daily_stats?page_id=eq.${f.pageId}&day=gte.${dayAt(-29)}&block_id=eq.&select=day`,
    );
    expect(Array.isArray(inside.body) ? inside.body.length : 0).toBe(29);
  });

  test("M4-30 layout: the locked cards and the upgrade card are full width on a phone, in the real cards' cells on a desktop", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, fe);
    await page.goto(ANALYTICS());
    const locked = page.getByTestId("locked-card");
    await expect(locked).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    if (process.env.HL_SHOTS) {
      await page.screenshot({
        path: `tmp/screens/analytics-free-${info.project.name}.png`,
        fullPage: true,
      });
    }
    const lockedBoxes = await Promise.all([0, 1, 2].map((i) => locked.nth(i).boundingBox()));

    if (phoneOnly(info)) {
      const column = (await page.getByTestId("kpi-strip").boundingBox())!;
      for (const box of lockedBoxes) {
        expect(Math.abs(box!.width - column.width)).toBeLessThanOrEqual(2);
      }
      for (const link of await locked.getByRole("link", { name: "See plans" }).all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expectTapTargets(page, "main");

      await page.goto(`${ANALYTICS()}?range=90`);
      const upgrade = page.getByTestId("upgrade-card");
      await expect(upgrade).toBeVisible();
      const card = (await upgrade.boundingBox())!;
      expect(Math.abs(card.width - column.width)).toBeLessThanOrEqual(2);
      const link = (await upgrade.getByRole("link", { name: "Upgrade to Pro" }).boundingBox())!;
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(link.width).toBeGreaterThan(card.width - 48);
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "main");
      if (process.env.HL_SHOTS) {
        await page.screenshot({ path: "tmp/screens/analytics-upgrade-phone.png" });
      }
    }

    if (desktopOnly(info)) {
      // Pro's real cards (the sample set) occupy the same cells.
      const { signIn } = await import("../fixtures/data");
      await signIn(context, pe.email);
      await page.goto(ANALYTICS());
      const real = [
        page.getByTestId("breakdown-referrers"),
        page.getByTestId("breakdown-devices"),
        page.getByTestId("breakdown-countries"),
      ];
      const realBoxes = await Promise.all(real.map((card) => card.boundingBox()));
      for (const [i, box] of lockedBoxes.entries()) {
        expect(Math.round(box!.x)).toBe(Math.round(realBoxes[i]!.x));
        expect(Math.round(box!.width)).toBe(Math.round(realBoxes[i]!.width));
      }
      expect(new Set(lockedBoxes.map((b) => Math.round(b!.y))).size).toBe(1);
    }
  });
});

test.describe("M4-30 Pro and Studio", () => {
  test.beforeAll(async () => setPlan(f, "pro"));

  test("M4-30 Pro opens 90d and 1y, sees the breakdown cards, no locks and no sentence about Free", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    await page.goto(ANALYTICS());
    await expect(chips(page)).toHaveCount(0);
    await expect(page.getByTestId("locked-card")).toHaveCount(0);
    await expect(page.getByTestId("analytics-footnote")).not.toContainText("On Free");
    await expect(page.getByTestId("breakdown-referrers").getByTestId("breakdown-row")).toHaveText([
      "Direct 50%",
      "instagram.com 50%",
    ]);

    await group(page).getByRole("button", { name: "90d" }).click();
    await expect.poll(() => kpi(page, "Views")).toBe("68"); // 34 days x 2
    await expect(page.getByTestId("upgrade-card")).toHaveCount(0);
    await group(page).getByRole("button", { name: "1y" }).click();
    await expect.poll(() => kpi(page, "Views")).toBe("68");
    await expect(
      page.getByRole("img", { name: /^Daily views and clicks for / }).locator("[data-bar]"),
    ).toHaveCount(52);
  });

  test("M4-30 Studio is treated like Pro: a year, the breakdowns, no locks", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    try {
      await setPlan(f, "studio");
      await page.goto(`${ANALYTICS()}?range=365`);
      expect(await kpi(page, "Views")).toBe("68");
      await expect(page.getByTestId("locked-card")).toHaveCount(0);
      await expect(page.getByTestId("upgrade-card")).toHaveCount(0);
      await expect(page.getByTestId("analytics-footnote")).not.toContainText("On Free");
      await expect(chips(page)).toHaveCount(0);
    } finally {
      await setPlan(f, "pro");
    }
  });

  test("M4-30 Pro's JWT reads every row and the breakdowns", async ({ context }) => {
    await signInOwner(context, f);
    const token = await accessTokenFor(f.email);
    const old = await restAs(
      token,
      `/daily_stats?page_id=eq.${f.pageId}&day=lt.${dayAt(-30)}&block_id=eq.&select=day`,
    );
    expect(Array.isArray(old.body) ? old.body.length : 0).toBe(4); // days -31 .. -34
    const dims = await restAs(token, `/daily_dim_stats?page_id=eq.${f.pageId}&select=day`);
    expect(Array.isArray(dims.body) && dims.body.length).toBeGreaterThan(0);
  });

  test("M4-30 a plan flip takes effect on the next request: the same JWT and session lose and regain the old rows", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    const token = await accessTokenFor(f.email);
    const older = `/daily_stats?page_id=eq.${f.pageId}&day=lt.${dayAt(-30)}&select=day`;
    expect(((await restAs(token, older)).body as unknown[]).length).toBeGreaterThan(0);
    expect((await page.request.get(`${ANALYTICS()}/stats?range=365`)).status()).toBe(200);

    try {
      await setPlan(f, "free"); // what the Stripe webhook does on a cancellation
      expect((await restAs(token, older)).body).toEqual([]);
      expect((await restAs(token, `/daily_dim_stats?page_id=eq.${f.pageId}`)).body).toEqual([]);
      expect((await page.request.get(`${ANALYTICS()}/stats?range=365`)).status()).toBe(403);
      await page.goto(`${ANALYTICS()}?range=90`);
      await expect(page.getByTestId("upgrade-card")).toBeVisible();
    } finally {
      await setPlan(f, "pro");
    }
    expect(((await restAs(token, older)).body as unknown[]).length).toBeGreaterThan(0);
    expect((await page.request.get(`${ANALYTICS()}/stats?range=365`)).status()).toBe(200);
  });
});
