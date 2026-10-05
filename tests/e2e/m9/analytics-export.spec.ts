import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { authCookies, cookieHeader, rawRequest, type RawResponse } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  ANALYTICS,
  GONE_BLOCK,
  LINKS,
  dayAt,
  kpi,
  makeOwner,
  seed,
  signInOwner,
  insertEvents,
  type Owner,
  type SeedEvent,
} from "../m4/analytics-dash-helpers";

/**
 * M9-26: the CSV export of the Analytics screen, on the phone (390x844) and desktop (1440x900)
 * projects. The route is plain HTTP, so its specs run once (desktop); the screen runs on both.
 *
 *   P  a Pro page whose events go back 80 days: the real nightly rollup for the past days, raw
 *      events for today. Recorded with referrers, devices and countries on purpose (none may reach
 *      a file).
 *   B  another Pro account with its own page and its own, different numbers.
 *   F  a Free account with a few days of events.
 *   E  a Pro page that has recorded nothing (the screen shows its sample set), and U a Pro page
 *      with events that was never published.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const HOST = "app.localhost:3000";
const BOM = "\uFEFF";

let p: Owner;
let b: Owner;
let f: Owner;
let e: Owner;
let u: Owner;

const views = (day: number, visitors: string[]): SeedEvent[] =>
  visitors.map((visitor) => ({
    type: "view",
    day: dayAt(day),
    visitor,
    referrer: "instagram.com",
    device: "mobile",
    country: "US",
  }));
const click = (day: number, visitor: string, blockId: string): SeedEvent => ({
  type: "click",
  day: dayAt(day),
  visitor,
  blockId,
  referrer: "instagram.com",
});

test.beforeAll(async () => {
  [p, b, f, e, u] = await Promise.all([
    makeOwner("xp", "pro"),
    makeOwner("xb", "pro"),
    makeOwner("xf", "free"),
    makeOwner("xe", "pro"),
    makeOwner("xu", "pro", { published: false }),
  ]);

  await seed(p.pageId, [
    ...views(-1, ["v1", "v2", "v3"]),
    click(-1, "v1", LINKS.portrait.id),
    click(-1, "v1", LINKS.portrait.id),
    click(-1, "v2", LINKS.instagram.id),
    ...views(-2, ["v1"]),
    click(-2, "v1", GONE_BLOCK),
    ...views(-3, ["v1", "v1"]),
    click(-3, "v1", LINKS.studio.id),
    ...views(-6, ["v9"]),
    ...views(-20, ["v1", "v2", "v3", "v4"]),
    click(-20, "v1", LINKS.night.id),
    click(-20, "v2", LINKS.night.id),
    ...views(-45, ["v1", "v2"]),
    click(-45, "v1", LINKS.prints.id),
    ...views(-80, ["v1", "v2", "v3", "v4", "v5"]),
    click(-80, "v1", LINKS.portrait.id),
    click(-80, "v2", LINKS.portrait.id),
    click(-80, "v3", LINKS.portrait.id),
  ]);
  // Today is raw: the nightly rollup has not seen it.
  const now = new Date().toISOString();
  await insertEvents(p.pageId, [
    { type: "view", ts: now, visitor: "t1" },
    { type: "view", ts: now, visitor: "t2" },
    { type: "click", ts: now, visitor: "t1", blockId: LINKS.portrait.id },
  ]);

  await seed(b.pageId, [...views(-1, ["b1", "b2"]), click(-1, "b1", LINKS.prints.id)]);
  await seed(f.pageId, [...views(-1, ["f1", "f2"]), click(-1, "f1", LINKS.portrait.id)]);
  await seed(u.pageId, [...views(-1, ["u1"]), click(-1, "u1", LINKS.portrait.id)]);

  // A link whose label would be a formula in a spreadsheet, on P's published page.
  const admin = adminClient();
  const row = await admin.from("pages").select("published").eq("id", p.pageId).single();
  if (row.error) throw new Error(row.error.message);
  const doc = row.data.published as {
    blocks: { id: string; type: string; label?: string; title?: string }[];
  };
  // Night Market is a card: its title is the name "Clicks by link" shows.
  const hostile = doc.blocks.find((block) => block.id === LINKS.night.id)!;
  expect(hostile.type).toBe("card");
  hostile.title = '=HYPERLINK("http://evil.example","x")';
  const saved = await admin.from("pages").update({ published: doc }).eq("id", p.pageId);
  if (saved.error) throw new Error(saved.error.message);
});

/** The signed-in user's cookie header, for plain HTTP. */
async function cookieOf(context: Parameters<typeof signInOwner>[0], owner: Owner): Promise<string> {
  await signInOwner(context, owner);
  return cookieHeader(await authCookies(context));
}

const exportPath = (kind: string, range?: string | number, extra = "") =>
  `/analytics/export?kind=${kind}${range === undefined ? "" : `&range=${range}`}${extra}`;
const get = (cookie: string, path: string, method = "GET") =>
  rawRequest(HOST, path, { cookie, method });

/** A parsed file: its rows without the BOM, split on CRLF (quoted line breaks do not occur here). */
function rowsOf(res: RawResponse): string[][] {
  expect(res.body.startsWith(BOM)).toBe(true);
  const lines = res.body.slice(1).split("\r\n");
  expect(lines.pop()).toBe(""); // the file ends with a line ending
  return lines.map((line) => line.split(","));
}
const sum = (rows: string[][], column: number) =>
  rows.reduce((n, row) => n + Number(row[column]), 0);

test.describe("M9-26 the route", () => {
  test("M9-26 the daily file: status, headers, name, byte order mark, CRLF, header row, one row per UTC day", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const cookie = await cookieOf(context, p);
    const res = await get(cookie, exportPath("daily", 30));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="${p.handle}-daily-${dayAt(-29)}-to-${dayAt(0)}.csv"`,
    );
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.setCookies).toEqual([]);
    expect(res.location).toBeNull();

    // Starts with the three bytes of a UTF-8 byte order mark; every line ends with CRLF.
    expect(Buffer.from(res.body, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(res.body.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const rows = rowsOf(res);
    expect(rows[0]).toEqual(["date", "page", "views", "clicks", "uniques"]);
    const days = rows.slice(1).map((row) => row[0]);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe(dayAt(-29));
    expect(days.at(-1)).toBe(dayAt(0));
    expect([...days].sort()).toEqual(days);
    // A day with no events is a row of zeros.
    expect(rows.find((row) => row[0] === dayAt(-4))).toEqual([dayAt(-4), "All pages", "0", "0", "0"]);
    // The numbers of a recorded day.
    expect(rows.find((row) => row[0] === dayAt(-1))).toEqual([dayAt(-1), "All pages", "3", "3", "3"]);
    expect(rows.find((row) => row[0] === dayAt(-3))).toEqual([dayAt(-3), "All pages", "2", "1", "1"]);
    expect(rows.find((row) => row[0] === dayAt(0))).toEqual([dayAt(0), "All pages", "2", "1", "2"]);
  });

  test("M9-26 the links file: link_id, link, clicks; most clicks first; labels as in 'Clicks by link'; formulas become text", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const cookie = await cookieOf(context, p);
    const res = await get(cookie, exportPath("links", 30));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="${p.handle}-links-${dayAt(-29)}-to-${dayAt(0)}.csv"`,
    );
    expect(res.body.startsWith(BOM)).toBe(true);
    const lines = res.body.slice(1).split("\r\n");
    expect(lines[0]).toBe("link_id,link,page,clicks");
    // Portrait: 2 (day -1) + 1 (today) = 3; Night Market 2; Studio, Instagram and the removed one 1 each.
    // The Night Market label was changed to a spreadsheet formula: written with an apostrophe, quoted.
    expect(lines.slice(1, 3)).toEqual([
      `${LINKS.portrait.id},${LINKS.portrait.label},Home,3`,
      `${LINKS.night.id},"'=HYPERLINK(""http://evil.example"",""x"")",Home,2`,
    ]);
    const rest = lines.slice(3, -1).sort();
    expect(rest).toEqual(
      [
        `${GONE_BLOCK},Removed link,,1`,
        `${LINKS.instagram.id},Instagram,Home,1`,
        `${LINKS.studio.id},${LINKS.studio.label},Home,1`,
      ].sort(),
    );
    expect(lines.at(-1)).toBe("");
    // The 45-day-old and 80-day-old clicks are outside the 30 day range.
    expect(res.body).not.toContain(LINKS.prints.id);
  });

  test("M9-26 the numbers equal the screen's: views, clicks and uniques sum to the KPI strip at 7, 30 and 90 days", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one project is enough");
    const cookie = await cookieOf(context, p);
    for (const range of [7, 30, 90]) {
      await page.goto(`${ANALYTICS()}?range=${range}`);
      const res = await get(cookie, exportPath("daily", range));
      expect(res.status, `range ${range}`).toBe(200);
      const rows = rowsOf(res).slice(1);
      expect(rows, `range ${range}`).toHaveLength(range);
      const number = async (label: string) => Number((await kpi(page, label)).replace(/,/g, ""));
      expect(sum(rows, 2), `views ${range}`).toBe(await number("Views"));
      expect(sum(rows, 3), `clicks ${range}`).toBe(await number("Clicks"));
      expect(sum(rows, 4), `uniques ${range}`).toBe(await number("Unique visitors"));

      // The links file adds up to the table's clicks.
      const links = await get(cookie, exportPath("links", range));
      const linkRows = rowsOf(links).slice(1);
      const table = await page
        .getByTestId("link-row")
        .locator("[role=cell]:nth-child(3)")
        .allInnerTexts();
      // A label may hold a comma (it is quoted), so the clicks are the LAST cell of every row.
      expect(linkRows.reduce((n, cells) => n + Number(cells.at(-1)), 0)).toBe(
        table.reduce((n, text) => n + Number(text.replace(/,/g, "")), 0),
      );
      expect(linkRows).toHaveLength(await page.getByTestId("link-row").count());
    }
    // 90 days reaches the 45 day old click (Prints) and 80 day old ones; 30 days does not.
    const ninety = await get(cookie, exportPath("links", 90));
    expect(ninety.body).toContain(`${LINKS.prints.id},${LINKS.prints.label},Home,1`);
    expect(ninety.body).toContain(`${LINKS.portrait.id},${LINKS.portrait.label},Home,6`);
  });

  test("M9-26 the daily file never holds a visitor, referrer, device or country", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const cookie = await cookieOf(context, p);
    for (const kind of ["daily", "links"]) {
      const res = await get(cookie, exportPath(kind, 90));
      expect(res.body, kind).not.toMatch(
        /instagram\.com|mobile|desktop|referrer|device|country|visitor|hash|"US"|,US/i,
      );
    }
  });

  test("M9-26 not signed in: 401 JSON and never a redirect", async ({}, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const res = await rawRequest(HOST, exportPath("daily", 30));
    expect(res.status).toBe(401);
    expect(res.location).toBeNull();
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: "unauthorized" });
    expect(res.body).not.toMatch(/csv|date,views/);
  });

  test("M9-26 any method but GET is 405", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const cookie = await cookieOf(context, p);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const res = await get(cookie, exportPath("daily", 30), method);
      expect(res.status, method).toBe(405);
      expect(res.headers.allow, method).toBe("GET");
      expect(res.headers["content-type"] ?? "", method).not.toMatch(/csv/);
    }
  });

  test("M9-26 an unknown or missing kind is 400; range is 7, 30, 90 or 365 and anything else is 30", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    // E: the shape of the answer does not depend on the data, and P's twenty requests a minute are spent elsewhere.
    const cookie = await cookieOf(context, e);
    for (const path of [
      "/analytics/export",
      "/analytics/export?kind=",
      exportPath("all", 30),
      exportPath("DAILY", 30),
      exportPath("daily,links", 30),
      exportPath("../daily", 30),
    ]) {
      const res = await get(cookie, path);
      expect(res.status, path).toBe(400);
      expect(JSON.parse(res.body), path).toEqual({ ok: false, error: "bad_kind" });
    }
    for (const range of ["", "abc", "0", "-7", "31", "7.5", "1e2", "30;rm", "%00"]) {
      const res = await get(cookie, exportPath("daily", range));
      expect(res.status, `range=${range}`).toBe(200);
      expect(res.headers["content-disposition"], `range=${range}`).toContain(
        `-daily-${dayAt(-29)}-to-${dayAt(0)}.csv`,
      );
    }
    for (const [range, days] of [
      [7, 7],
      [30, 30],
      [90, 90],
      [365, 365],
    ] as const) {
      const res = await get(cookie, exportPath("daily", range));
      expect(res.status, `range ${range}`).toBe(200);
      expect(rowsOf(res).length - 1).toBe(days);
    }
  });

  test("M9-26 Free may export 7 and 30 days; 90 and 365 are 403 plan_required with no data", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const cookie = await cookieOf(context, f);
    for (const range of [7, 30]) {
      const res = await get(cookie, exportPath("daily", range));
      expect(res.status, `range ${range}`).toBe(200);
      expect(rowsOf(res).length - 1).toBe(range);
    }
    for (const kind of ["daily", "links"]) {
      for (const range of [90, 365]) {
        const res = await get(cookie, exportPath(kind, range));
        expect(res.status, `${kind} ${range}`).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ ok: false, error: "plan_required" });
        expect(res.headers["content-disposition"]).toBeUndefined();
        expect(res.body).not.toContain("date,views");
        expect(res.setCookies).toEqual([]);
      }
    }
  });

  test("M9-26 no parameter names another page: ?page=, ?pageId=, ?owner= and ?user= are ignored", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    // B asks with A's page id and A's user id in every spelling: B's own data comes back.
    const cookie = await cookieOf(context, b);
    const own = await get(cookie, exportPath("daily", 30));
    expect(own.headers["content-disposition"]).toContain(`filename="${b.handle}-daily-`);
    const ownRows = rowsOf(own);
    expect(sum(ownRows.slice(1), 2)).toBe(2); // B's two views
    for (const extra of [
      `&page=${p.pageId}`,
      `&pageId=${p.pageId}`,
      `&owner=${p.userId}`,
      `&user=${p.userId}`,
      `&page=${p.handle}&pageId=${p.pageId}&owner=${p.userId}&user=${p.userId}&ownerId=${p.userId}`,
    ]) {
      for (const kind of ["daily", "links"]) {
        const res = await get(cookie, exportPath(kind, 30, extra));
        expect(res.status, `${kind} ${extra}`).toBe(200);
        expect(res.headers["content-disposition"], extra).toContain(
          `filename="${b.handle}-${kind}-`,
        );
        expect(res.body, extra).not.toContain(p.handle);
        if (kind === "daily") expect(res.body, extra).toBe(own.body);
        else expect(res.body, extra).not.toContain(LINKS.portrait.id);
      }
    }
  });

  test("M9-26 an account that has recorded nothing exports real zeros, not the sample numbers", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const cookie = await cookieOf(context, e);
    const daily = rowsOf(await get(cookie, exportPath("daily", 30)));
    expect(daily).toHaveLength(31);
    for (const row of daily.slice(1)) expect(row.slice(1)).toEqual(["All pages", "0", "0", "0"]);
    const links = await get(cookie, exportPath("links", 30));
    expect(links.body).toBe(`${BOM}link_id,link,page,clicks\r\n`);
  });

  test("M9-26 the 21st export in a minute is 429 with Retry-After; the first twenty are 200", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
    const owner = await makeOwner("xr", "pro");
    const cookie = await cookieOf(context, owner);
    const statuses: number[] = [];
    let last: RawResponse | null = null;
    for (let i = 0; i < 21; i += 1) {
      last = await get(cookie, exportPath("daily", 7));
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(200));
    expect(statuses[20]).toBe(429);
    expect(Number(last!.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(last!.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(JSON.parse(last!.body)).toEqual({ ok: false, error: "rate_limited" });
    // The limit is per user: another account is not slowed down.
    const other = await cookieOf(context, b);
    expect((await get(other, exportPath("daily", 7))).status).toBe(200);
  });
});

/** The two export controls inside the row. */
const row = (page: Page) => page.getByTestId("export-row");
const daily = (page: Page) => row(page).locator('[data-export="daily"]');
const linksControl = (page: Page) => row(page).locator('[data-export="links"]');

test.describe("M9-26 the screen", () => {
  test("M9-26 below the chart: 'Export this range' with two plain download links, the hint, and hrefs that follow the range without a reload", async ({
    page,
    context,
  }) => {
    await signInOwner(context, p);
    await page.goto(ANALYTICS());
    const panel = row(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Export this range" })).toBeVisible();

    const a = panel.getByRole("link", { name: "Download daily totals (CSV)" });
    const l = panel.getByRole("link", { name: "Download link clicks (CSV)" });
    await expect(a).toHaveAttribute("href", "/analytics/export?kind=daily&range=30");
    await expect(l).toHaveAttribute("href", "/analytics/export?kind=links&range=30");
    await expect(a).toHaveAttribute("download", "");
    await expect(panel).toContainText(
      "Unique visitors are counted per day, so they do not add up across days.",
    );

    // Order on the page: the chart, then the export row, then the links table.
    const order = await page.evaluate(() => {
      const top = (id: string) =>
        document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top;
      return [top("chart-card"), top("export-row"), top("links-card")];
    });
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);

    // The range control changes the hrefs, with no navigation.
    // (A same-document `replaceState` of ?range= is not a navigation: a marker on the window survives.)
    await page.evaluate(() => {
      (window as unknown as { __stays: boolean }).__stays = true;
    });
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    await expect(a).toHaveAttribute("href", "/analytics/export?kind=daily&range=7");
    await expect(l).toHaveAttribute("href", "/analytics/export?kind=links&range=7");
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "1y" })
      .click();
    await expect(a).toHaveAttribute("href", "/analytics/export?kind=daily&range=365");
    expect(await page.evaluate(() => (window as unknown as { __stays?: boolean }).__stays)).toBe(
      true,
    );
  });

  test("M9-26 a click on each link starts a download named {handle}-{kind}-{start}-to-{end}.csv; Enter does too", async ({
    page,
    context,
  }) => {
    await signInOwner(context, p);
    await page.goto(ANALYTICS());
    await expect(daily(page)).toBeVisible();

    const [first] = await Promise.all([page.waitForEvent("download"), daily(page).click()]);
    expect(first.suggestedFilename()).toBe(`${p.handle}-daily-${dayAt(-29)}-to-${dayAt(0)}.csv`);
    const [second] = await Promise.all([page.waitForEvent("download"), linksControl(page).click()]);
    expect(second.suggestedFilename()).toBe(`${p.handle}-links-${dayAt(-29)}-to-${dayAt(0)}.csv`);

    // Keyboard: focus the link and press Enter.
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    await expect(daily(page)).toHaveAttribute("href", /range=7$/);
    await daily(page).focus();
    const [viaKeyboard] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    expect(viaKeyboard.suggestedFilename()).toBe(
      `${p.handle}-daily-${dayAt(-6)}-to-${dayAt(0)}.csv`,
    );
  });

  test("M9-26 a page with sample numbers, and a page that was never published, have disabled buttons and the 'real data' hint", async ({
    page,
    context,
  }) => {
    for (const owner of [e, u]) {
      await signInOwner(context, owner);
      await page.goto(ANALYTICS());
      const panel = row(page);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Export is available once your page has real data.");
      await expect(panel).not.toContainText("do not add up across days");
      await expect(panel.getByRole("link")).toHaveCount(0);
      await expect(daily(page)).toBeDisabled();
      await expect(linksControl(page)).toBeDisabled();
      expect(await daily(page).evaluate((el) => el.tagName)).toBe("BUTTON");
    }
  });

  test("M9-26 Free: the row is there on 7d and 30d, and 90d and 1y show the upgrade card and no export row", async ({
    page,
    context,
  }) => {
    await signInOwner(context, f);
    await page.goto(ANALYTICS());
    await expect(row(page)).toBeVisible();
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "7d" })
      .click();
    await expect(daily(page)).toHaveAttribute("href", /range=7$/);
    for (const label of ["90d", "1y"]) {
      await page
        .getByRole("group", { name: "Date range" })
        .getByRole("button", { name: label })
        .click();
      await expect(page.getByTestId("upgrade-card")).toBeVisible();
      await expect(row(page)).toHaveCount(0);
    }
    // Back to a range Free has: the row returns.
    await page
      .getByRole("group", { name: "Date range" })
      .getByRole("button", { name: "30d" })
      .click();
    await expect(row(page)).toBeVisible();
  });

  test("M9-26 at 390x844 the buttons stack full width at 44px, the hint wraps and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the phone layout is checked on the phone project");
    await signInOwner(context, p);
    await page.goto(ANALYTICS());
    await expect(row(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="export-row"]')!.getBoundingClientRect();
      const box = (key: string) =>
        document.querySelector(`[data-export="${key}"]`)!.getBoundingClientRect();
      const hint = document.querySelector('[data-testid="export-row"] p')!.getBoundingClientRect();
      return {
        panel: { left: panel.left, right: panel.right },
        daily: {
          top: box("daily").top,
          bottom: box("daily").bottom,
          w: box("daily").width,
          h: box("daily").height,
        },
        links: { top: box("links").top, w: box("links").width, h: box("links").height },
        hint: { height: hint.height, right: hint.right },
        view: window.innerWidth,
      };
    });
    expect(geometry.links.top).toBeGreaterThanOrEqual(geometry.daily.bottom - 1); // stacked
    expect(geometry.daily.h).toBeGreaterThanOrEqual(44);
    expect(geometry.links.h).toBeGreaterThanOrEqual(44);
    expect(Math.abs(geometry.daily.w - geometry.links.w)).toBeLessThanOrEqual(1);
    expect(geometry.daily.w).toBeGreaterThan(390 - 32 - 32 - 4); // full width of the card's content
    expect(geometry.hint.height).toBeGreaterThan(18); // wraps onto more than one line
    expect(geometry.hint.right).toBeLessThanOrEqual(geometry.panel.right);
    expect(geometry.panel.left).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.view);
    await expectTapTargets(page, '[data-testid="export-row"]');

    // A tap names the file as above.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      daily(page)
        .tap()
        .catch(() => daily(page).click()),
    ]);
    expect(download.suggestedFilename()).toBe(`${p.handle}-daily-${dayAt(-29)}-to-${dayAt(0)}.csv`);
  });

  test("M9-26 at 1440x900 the two buttons sit side by side under the chart, in the same column as the other cards", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the desktop layout is checked on the desktop project");
    await signInOwner(context, p);
    await page.goto(ANALYTICS());
    await expect(row(page)).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const panel = rect('[data-testid="export-row"]');
      const chart = rect('[data-testid="chart-card"]');
      const daily = rect('[data-export="daily"]');
      const links = rect('[data-export="links"]');
      return {
        panel: { left: panel.left, right: panel.right, top: panel.top },
        chart: { left: chart.left, right: chart.right, bottom: chart.bottom },
        daily: { top: daily.top, right: daily.right, height: daily.height },
        links: { top: links.top, left: links.left, height: links.height },
      };
    });
    expect(geometry.panel.top).toBeGreaterThanOrEqual(geometry.chart.bottom);
    expect(Math.round(geometry.panel.left)).toBe(Math.round(geometry.chart.left));
    expect(Math.round(geometry.panel.right)).toBe(Math.round(geometry.chart.right));
    expect(Math.abs(geometry.daily.top - geometry.links.top)).toBeLessThanOrEqual(1);
    expect(geometry.links.left).toBeGreaterThan(geometry.daily.right);
    expect(geometry.daily.height).toBeGreaterThanOrEqual(44);
    expect(geometry.links.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
  });
});
