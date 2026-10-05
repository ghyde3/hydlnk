import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly, signIn } from "../fixtures/data";
import { authCookies, cookieHeader, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { ANALYTICS, kpi } from "../m4/analytics-dash-helpers";
import { HOME_LINK, ITEMS_LINK, ITEMS_TITLE, trafficSite } from "./analytics-helpers";

/**
 * M11-09: the Analytics page filter, on the phone (390x844) and desktop (1440x900). One site with
 * traffic recorded by the real routes on two pages and a deleted one, rolled up by the real nightly
 * rollup: the filter lists All pages, Home, each page by title and "Deleted page", every number on
 * the screen follows it, the CSV export names the page, and nothing scrolls sideways at 390px.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

let traffic: Awaited<ReturnType<typeof trafficSite>>;

test.beforeAll(async () => {
  traffic = await trafficSite("pf");
});

/** "views/clicks" of the KPI strip: polled as one value so a stale screen never satisfies a wait. */
const totals = async (page: Page) => `${await kpi(page, "Views")}/${await kpi(page, "Clicks")}`;

const filter = (page: Page) => page.getByTestId("page-filter");

async function open(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  query = "range=7",
) {
  await signIn(context, traffic.site.email);
  await page.goto(`${ANALYTICS()}?${query}`);
  await expect(page.getByTestId("kpi-strip")).toBeVisible();
}

test("M11-09 the page filter lists All pages, Home, each page by its title and Deleted page", async ({
  page,
  context,
}) => {
  await open(page, context);
  await expect(filter(page)).toBeVisible();
  const labels = await filter(page).locator("option").allInnerTexts();
  expect(labels).toEqual(["All pages", "Home", ITEMS_TITLE, "Deleted page"]);
  await expect(filter(page)).toHaveValue("all");
  expect(await kpi(page, "Views")).toBe("5");
  expect(await kpi(page, "Clicks")).toBe("3");
});

test("M11-09 choosing a page switches every number to that page, and the address remembers it", async ({
  page,
  context,
}) => {
  await open(page, context);

  await filter(page).selectOption({ label: ITEMS_TITLE });
  await expect.poll(() => totals(page)).toBe("3/2");
  await expect(page.getByTestId("link-row")).toHaveCount(1);
  await expect(page.getByTestId("link-row")).toContainText(ITEMS_LINK.label);
  expect(page.url()).toContain(`filter=${traffic.items.id}`);

  await filter(page).selectOption({ label: "Home" });
  await expect.poll(() => totals(page)).toBe("1/1");
  await expect(page.getByTestId("link-row")).toContainText(HOME_LINK.label);

  await filter(page).selectOption({ label: "Deleted page" });
  await expect.poll(() => totals(page)).toBe("1/0");

  await filter(page).selectOption({ label: "All pages" });
  await expect.poll(() => totals(page)).toBe("5/3");
  await expect(page.getByTestId("link-row")).toHaveCount(2);
});

test("M11-09 a reload keeps the chosen page, and the export link follows it", async ({
  page,
  context,
}) => {
  await open(page, context, `range=7&filter=${traffic.items.id}`);
  await expect(filter(page)).toHaveValue(traffic.items.id);
  expect(await kpi(page, "Views")).toBe("3");
  await expect(page.locator('[data-export="daily"]')).toHaveAttribute(
    "href",
    new RegExp(`filter=${traffic.items.id}`),
  );
});

test("M11-09 at 390px the filter is a 44px target and nothing scrolls sideways", async ({
  page,
  context,
}, info) => {
  await open(page, context);
  await expectNoHorizontalScroll(page);
  if (phoneOnly(info)) {
    await expectTapTargets(page, '[data-testid="page-filter"]');
    const box = await filter(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await filter(page).selectOption({ label: ITEMS_TITLE });
  await expect.poll(() => kpi(page, "Views")).toBe("3");
  await expectNoHorizontalScroll(page);
});

test("M11-09 the CSV export has a page column and follows the filter", async ({
  context,
}, info) => {
  test.skip(!desktopOnly(info), "plain HTTP: one project is enough");
  await signIn(context, traffic.site.email);
  const cookie = cookieHeader(await authCookies(context));
  const get = (path: string) => rawRequest("app.localhost:3000", path, { cookie });

  const links = await get("/analytics/export?kind=links&range=7");
  expect(links.status).toBe(200);
  const lines = links.body.slice(1).split("\r\n");
  expect(lines[0]).toBe("link_id,link,page,clicks");
  expect(lines).toContain(`${ITEMS_LINK.id},${ITEMS_LINK.label},${ITEMS_TITLE},2`);
  expect(lines).toContain(`${HOME_LINK.id},${HOME_LINK.label},Home,1`);

  const daily = await get(`/analytics/export?kind=daily&range=7&filter=${traffic.items.id}`);
  const rows = daily.body
    .slice(1)
    .split("\r\n")
    .filter(Boolean)
    .map((l) => l.split(","));
  expect(rows[0]).toEqual(["date", "page", "views", "clicks", "uniques"]);
  expect(rows.slice(1).every((r) => r[1] === ITEMS_TITLE)).toBe(true);
  expect(rows.slice(1).reduce((n, r) => n + Number(r[2]), 0)).toBe(3);

  // A page id that belongs to nobody changes nothing: zeros, labeled "Deleted page".
  const none = await get(
    "/analytics/export?kind=daily&range=7&filter=11111111-1111-4111-8111-111111111111",
  );
  expect(none.body).toContain(",Deleted page,");
});
