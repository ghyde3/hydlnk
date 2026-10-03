import { expect, test } from "@playwright/test";
import { accessTokenFor, cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  ANALYTICS,
  GONE_BLOCK,
  LINKS,
  dayAt,
  kpi,
  makeOwner,
  seed,
  shortDay,
  signInOwner,
  windowLabel,
  insertEvents,
  createPublishedPage,
  type Owner,
  type SeedEvent,
} from "./analytics-dash-helpers";

/**
 * M4-26 (overview: range, KPIs, daily bars) and M4-27 (clicks by link) on a Pro page with 29
 * completed days (rolled up by the real nightly rollup) and a few raw events today.
 *
 * Per completed day o = 1..29 (o days ago): 4 views from 3 visitors, 1 click on Portrait; on even o
 * also 1 click on Studio; on o = 3 also 1 click on a block that is no longer on the page. Today:
 * 3 views from 2 visitors and 2 clicks on Portrait, all raw. Totals for the 30 days:
 *   views 29 x 4 + 3 = 119     clicks 29 + 14 + 1 + 2 = 46     uniques 29 x 3 + 2 = 89
 *   click-through 46 / 119 = 38.7%      Portrait 31 (26.1%), Studio 14 (11.8%), Removed link 1 (0.8%)
 * and for the last 7 days (o = 1..6 and today): views 27, clicks 6 + 3 + 1 + 2 = 12, uniques 20.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

let pro: Owner;
let other: Owner;
let multi: Owner;
let multiSecondPage: string;

test.beforeAll(async () => {
  pro = await makeOwner("ov", "pro");
  other = await makeOwner("ovx", "pro");

  const past: SeedEvent[] = [];
  for (let o = 1; o <= 29; o++) {
    const day = dayAt(-o);
    for (const visitor of ["v1", "v2", "v3", "v1"]) {
      past.push({ type: "view", day, visitor, referrer: o % 2 === 0 ? "instagram.com" : null });
    }
    past.push({ type: "click", day, visitor: "v1", blockId: LINKS.portrait.id });
    if (o % 2 === 0) past.push({ type: "click", day, visitor: "v2", blockId: LINKS.studio.id });
    if (o === 3) past.push({ type: "click", day, visitor: "v3", blockId: GONE_BLOCK });
  }
  await seed(pro.pageId, past);

  const now = new Date().toISOString();
  await insertEvents(pro.pageId, [
    { type: "view", ts: now, visitor: "t1", referrer: "instagram.com" },
    { type: "view", ts: now, visitor: "t1", referrer: "instagram.com" },
    { type: "view", ts: now, visitor: "t2", referrer: "instagram.com" },
    { type: "click", ts: now, visitor: "t1", blockId: LINKS.portrait.id },
    { type: "click", ts: now, visitor: "t2", blockId: LINKS.portrait.id },
  ]);

  // One account, two pages with different numbers: the page switcher decides which one this is.
  multi = await makeOwner("ovm", "pro");
  multiSecondPage = await createPublishedPage(multi.userId, `${multi.handle}-b`.slice(0, 30));
  await seed(
    multi.pageId,
    Array.from({ length: 3 }, (_, i): SeedEvent => ({
      type: "view",
      day: dayAt(-1),
      visitor: `m${i}`,
    })),
  );
  await seed(
    multiSecondPage,
    Array.from({ length: 5 }, (_, i): SeedEvent => ({
      type: "view",
      day: dayAt(-1),
      visitor: `n${i}`,
    })),
  );

  // Another account's page with numbers nobody could mistake for the first one's.
  await insertEvents(
    other.pageId,
    Array.from({ length: 7 }, (_, i) => ({
      type: "view" as const,
      ts: new Date().toISOString(),
      visitor: `x${i}`,
    })),
  );
});

test.describe("M4-26 overview", () => {
  test("M4-26 header, range control and the numbers of the default 30 days", async ({
    page,
    context,
  }, info) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await signInOwner(context, pro);
    await page.goto(ANALYTICS());

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Analytics");
    await expect(page.getByText("Last 30 days", { exact: true })).toBeVisible();
    await expect(page.getByTestId("date-label")).toHaveText(windowLabel(30));

    const group = page.getByRole("group", { name: "Date range" });
    await expect(group.getByRole("button")).toHaveText(["7d", "30d", "90d", "1y"]);
    await expect(group.getByRole("button", { name: "30d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of ["7d", "90d", "1y"]) {
      await expect(group.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    // Pro accounts have no Pro chips on the control.
    await expect(group.getByText("Pro", { exact: true })).toHaveCount(0);

    await expect(page.getByTestId("sample-chip")).toHaveCount(0);
    expect(await kpi(page, "Views")).toBe("119");
    expect(await kpi(page, "Clicks")).toBe("46");
    expect(await kpi(page, "Click-through")).toBe("38.7%");
    expect(await kpi(page, "Unique visitors")).toBe("89");
    await expect(page.getByTestId("kpi-strip").getByTitle("Counted per day")).toContainText(
      "Unique visitors",
    );

    await expect(
      page.getByText("Counted without cookies. Bots are filtered out before anything is stored."),
    ).toBeVisible();
    // Pro never sees the sentence about Free.
    await expect(page.getByTestId("analytics-footnote")).not.toContainText("On Free");

    // No hydration mismatch or other error while the screen renders and the control is used.
    await group.getByRole("button", { name: "7d" }).click();
    await expect.poll(() => kpi(page, "Views")).toBe("27");
    expect(problems).toEqual([]);

    if (info.project.name === "phone") {
      await expect(
        page.getByRole("navigation", { name: "App sections" }).getByRole("link", { name: "Stats" }),
      ).toHaveAttribute("aria-current", "page");
    }
  });

  test("M4-26 the range lives in the URL: a button sets it, an invalid value falls back to 30", async ({
    page,
    context,
  }) => {
    await signInOwner(context, pro);
    const group = () => page.getByRole("group", { name: "Date range" });

    for (const [value, crumb, pressed] of [
      ["7", "Last 7 days", "7d"],
      ["90", "Last 90 days", "90d"],
      ["365", "Last year", "1y"],
      ["30", "Last 30 days", "30d"],
    ] as const) {
      await page.goto(`${ANALYTICS()}?range=${value}`);
      await expect(page.getByText(crumb, { exact: true })).toBeVisible();
      await expect(group().getByRole("button", { name: pressed })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    for (const bad of ["0", "14", "abc", "7d", "-30", "", "30.5"]) {
      await page.goto(`${ANALYTICS()}?range=${encodeURIComponent(bad)}`);
      await expect(group().getByRole("button", { name: "30d" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByText("Last 30 days", { exact: true })).toBeVisible();
    }

    // Clicking changes the numbers and the address, and a reload keeps the choice.
    await page.goto(ANALYTICS());
    await group().getByRole("button", { name: "7d" }).click();
    await expect(group().getByRole("button", { name: "7d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page).toHaveURL(/[?&]range=7(&|$)/);
    await expect(page.getByTestId("date-label")).toHaveText(windowLabel(7));
    await expect.poll(() => kpi(page, "Views")).toBe("27");
    expect(await kpi(page, "Clicks")).toBe("12");
    expect(await kpi(page, "Unique visitors")).toBe("20");
    expect(await kpi(page, "Click-through")).toBe("44.4%");
    await page.reload();
    await expect(group().getByRole("button", { name: "7d" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await kpi(page, "Views")).toBe("27");
  });

  test("M4-26 the chart: one bar per day, tooltips, brass share, axis and labels", async ({
    page,
    context,
  }) => {
    await signInOwner(context, pro);
    await page.goto(ANALYTICS());

    const chart = page.getByRole("img", { name: `Daily views and clicks for ${windowLabel(30)}` });
    await expect(chart).toBeVisible();
    await expect(chart.locator("[data-bar]")).toHaveCount(30);
    await expect(chart.locator('[data-bar="drawn"]')).toHaveCount(30);
    await expect(page.getByRole("heading", { name: "Views and clicks per day" })).toBeVisible();

    const bars = chart.locator("[data-bar]");
    // Oldest day first, today last.
    await expect(bars.nth(29)).toHaveAttribute(
      "title",
      `${shortDay(dayAt(0))} — 3 views, 2 clicks`,
    );
    await expect(bars.nth(28)).toHaveAttribute(
      "title",
      `${shortDay(dayAt(-1))} — 4 views, 1 click`,
    );
    await expect(bars.nth(27)).toHaveAttribute(
      "title",
      `${shortDay(dayAt(-2))} — 4 views, 2 clicks`,
    );

    // The peak is 4 views, so the axis is 10 / 5 / 0.
    const axis = page.locator('[aria-hidden="true"]').filter({ hasText: /^10\s*5\s*0$/ });
    await expect(axis).toHaveCount(1);

    // Brass share of a bar is clicks over views: 1 of 4 on yesterday's bar, 2 of 3 on today's.
    const share = async (index: number) =>
      bars.nth(index).evaluate((el) => {
        const bar = el.firstElementChild as HTMLElement | null;
        const brass = bar?.firstElementChild as HTMLElement | null;
        return {
          bar: bar?.getBoundingClientRect().height ?? 0,
          brass: brass?.getBoundingClientRect().height ?? 0,
        };
      });
    const yesterday = await share(28);
    expect(yesterday.brass / yesterday.bar).toBeCloseTo(0.25, 1);
    const today = await share(29);
    expect(today.brass / today.bar).toBeCloseTo(2 / 3, 1);
    // A 4-view bar on a 10 axis is 40% of the 200px plot (the plot has a 1px baseline).
    expect(yesterday.bar).toBeGreaterThan(70);
    expect(yesterday.bar).toBeLessThan(90);

    // Five date labels, first and last are the ends of the window.
    const labels = page
      .locator('[aria-hidden="true"].font-mono')
      .filter({ hasText: new RegExp(shortDay(dayAt(-29))) });
    await expect(labels).toHaveCount(1);
    await expect(labels.locator("span")).toHaveCount(5);
    await expect(labels.locator("span").first()).toHaveText(shortDay(dayAt(-29)));
    await expect(labels.locator("span").last()).toHaveText(shortDay(dayAt(0)));
  });

  test("M4-26 one year draws 52 weekly bars named 'Week of ...'", async ({ page, context }) => {
    await signInOwner(context, pro);
    await page.goto(`${ANALYTICS()}?range=365`);
    const chart = page.getByRole("img", { name: `Daily views and clicks for ${windowLabel(365)}` });
    await expect(chart.locator("[data-bar]")).toHaveCount(52);
    const titles = await chart
      .locator("[data-bar]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("title") ?? ""));
    expect(
      titles.every((t) =>
        /^Week of [A-Z][a-z]{2} \d{1,2} — [\d,]+ views?, [\d,]+ clicks?$/.test(t),
      ),
    ).toBe(true);
    // The first drawn week is a Monday; the last is this week's Monday.
    const monday = (() => {
      const d = new Date(`${dayAt(0)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    })();
    expect(titles[51]!.startsWith(`Week of ${shortDay(monday)} `)).toBe(true);
    // 119 views fall in the 52 weeks drawn (29 days of data lie well inside them).
    const views = titles.map((t) => Number(/ — ([\d,]+) view/.exec(t)![1]!.replace(/,/g, "")));
    expect(views.reduce((a, b) => a + b, 0)).toBe(119);
    expect(await kpi(page, "Views")).toBe("119");
  });

  test("M4-26 ownership: another account's page id in the cookie or the request never shows their numbers", async ({
    page,
    context,
  }) => {
    await signInOwner(context, pro);
    await context.addCookies([{ name: "hl-page", value: other.pageId, url: ANALYTICS() }]);
    await page.goto(ANALYTICS());
    expect(await kpi(page, "Views")).toBe("119");

    const viaApi = await page.request.get(
      `${ANALYTICS()}/stats?range=30&page=${other.pageId}&pageId=${other.pageId}`,
    );
    expect(viaApi.status()).toBe(200);
    const body = await viaApi.json();
    expect(body.ok).toBe(true);
    expect(body.data.kpis.views).toBe(119);
    expect(body.data.kpis.views).not.toBe(7);
  });

  test("M4-26 direct API: the publishable key and a user's JWT see no other account's stats or any events", async ({
    context,
  }) => {
    await signInOwner(context, pro);
    const token = await accessTokenFor(pro.email);
    const foreign = await restAs(token, `/daily_stats?page_id=eq.${other.pageId}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
    const events = await restAs(token, "/events?select=id&limit=5");
    expect(events.status >= 400 || (Array.isArray(events.body) && events.body.length === 0)).toBe(
      true,
    );
    const mine = await restAs(
      token,
      `/daily_stats?page_id=eq.${pro.pageId}&block_id=eq.&select=day`,
    );
    expect(Array.isArray(mine.body) && mine.body.length).toBeGreaterThan(0);
  });

  test("M4-26 the numbers follow the page switcher, and the range keeps working on the new page", async ({
    page,
    context,
  }) => {
    await signInOwner(context, multi);
    await page.goto(ANALYTICS());
    expect(await kpi(page, "Views")).toBe("3");

    const switcher = page.getByRole("button", { name: /^Switch page, current:/ });
    await switcher.click();
    await page.getByRole("menuitemradio", { name: new RegExp(`${multi.handle}-b`) }).click();
    await expect(switcher).toHaveAttribute("aria-label", new RegExp(`current: ${multi.handle}-b`));
    await expect.poll(() => kpi(page, "Views")).toBe("5");

    // The stats route and the range control read the same current page.
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    await expect.poll(() => kpi(page, "Views")).toBe("5");
    await expect(page.getByTestId("date-label")).toHaveText(windowLabel(7));
    const viaApi = await (await page.request.get(`${ANALYTICS()}/stats?range=30`)).json();
    expect(viaApi.data.kpis.views).toBe(5);
  });

  test("M4-26 the signed-out stats route answers 401 JSON, not a redirect", async ({ request }) => {
    const res = await request.get(`${ANALYTICS()}/stats?range=30`, { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(res.headers()["cache-control"]).toMatch(/no-store/);
  });

  test("M4-26 layout: phone wraps the KPIs to two columns and fits; desktop is one row, 1180px, 200px chart", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, pro);
    await page.goto(ANALYTICS());
    await expect(page.getByTestId("kpi-strip")).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (process.env.HL_SHOTS) {
      await page.screenshot({
        path: `tmp/screens/analytics-${info.project.name}.png`,
        fullPage: true,
      });
    }

    const tops = await page
      .getByTestId("kpi-strip")
      .locator("> div")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    const chartBox = await page.getByTestId("chart-bars").boundingBox();

    if (phoneOnly(info)) {
      expect(tops[0]).toBe(tops[1]);
      expect(tops[2]).toBe(tops[3]);
      expect(tops[2]!).toBeGreaterThan(tops[0]!);
      const group = page.getByRole("group", { name: "Date range" });
      for (const button of await group.getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expectTapTargets(page, "main");
      // The chart fills the card: it is as wide as the card's content, less the axis.
      const card = await page.getByTestId("chart-card").boundingBox();
      expect(chartBox!.x + chartBox!.width).toBeGreaterThan(card!.x + card!.width - 24);
    }
    if (desktopOnly(info)) {
      expect(new Set(tops).size).toBe(1);
      await expect(page.getByRole("navigation", { name: "App" })).toBeVisible();
      const strip = await page.getByTestId("kpi-strip").boundingBox();
      expect(strip!.width).toBeLessThanOrEqual(1180);
      expect(strip!.width).toBeGreaterThan(1000);
      expect(Math.round(chartBox!.height)).toBe(200);
    }
  });
});

test.describe("M4-27 clicks by link", () => {
  test("M4-27 rows sorted by clicks, with names from the published page, CTR and a relative share bar", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, pro);
    await page.goto(ANALYTICS());

    const card = page.getByTestId("links-card");
    await expect(card.getByRole("heading", { name: "Clicks by link" })).toBeVisible();
    const rows = card.getByTestId("link-row");
    await expect(rows).toHaveCount(3);
    // The share bar is its own (empty) cell from 760px up; on a phone it is not there at all.
    const share = info.project.name === "desktop" ? [""] : [];
    const cells = (label: string, clicks: string, ctr: string) => [label, ...share, clicks, ctr];
    await expect(rows.nth(0).getByRole("cell")).toHaveText(
      cells(LINKS.portrait.label, "31", "26.1%"),
    );
    await expect(rows.nth(1).getByRole("cell")).toHaveText(
      cells(LINKS.studio.label, "14", "11.8%"),
    );
    await expect(rows.nth(2).getByRole("cell")).toHaveText(cells("Removed link", "1", "0.8%"));
  });

  test("M4-27 the header row and the share bar widths and columns per viewport", async ({
    page,
    context,
  }, info) => {
    await signInOwner(context, pro);
    await page.goto(ANALYTICS());
    const card = page.getByTestId("links-card");
    await expect(card.getByTestId("link-row")).toHaveCount(3);
    await expectNoHorizontalScroll(page);

    const columns = await card
      .getByTestId("link-row")
      .first()
      .evaluate((el) =>
        getComputedStyle(el)
          .gridTemplateColumns.split(" ")
          .map((v) => Number.parseFloat(v)),
      );

    if (phoneOnly(info)) {
      await expect(card.getByRole("columnheader", { name: "Share of clicks" })).toBeHidden();
      expect(columns.slice(-2)).toEqual([60, 52]);
      expect(columns).toHaveLength(3);
      for (const row of await card.getByTestId("link-row").all()) {
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      // A long name is cut with an ellipsis, not wrapped.
      const name = card.getByTestId("link-row").first().getByRole("cell").first();
      expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    }
    if (desktopOnly(info)) {
      await expect(card.getByRole("columnheader")).toHaveText([
        "Link",
        "Share of clicks",
        "Clicks",
        "CTR",
      ]);
      expect(columns).toHaveLength(4);
      expect(columns.slice(-2)).toEqual([80, 70]);
      expect(columns[0]! / columns[1]!).toBeCloseTo(2.2 / 2, 1);
      // Studio's bar is 14 / 31 of Portrait's.
      const widths = await card.getByTestId("link-row").evaluateAll((els) =>
        els.map((el) => {
          const bar = el.querySelectorAll('[role="cell"]')[1]!.firstElementChild as HTMLElement;
          return bar.getBoundingClientRect().width;
        }),
      );
      expect(widths[1]! / widths[0]!).toBeCloseTo(14 / 31, 1);
      expect(widths[2]! / widths[0]!).toBeCloseTo(1 / 31, 1);
    }
  });
});
