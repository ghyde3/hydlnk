import { expect, test } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { expectNoHorizontalScroll, url } from "../helpers";
import { MARA_EMAIL } from "../m2/editor-helpers";
import { ANALYTICS } from "../m4/analytics-dash-helpers";
import { makeLink, revokeLink, sharePath } from "../m6/pages-helpers";

/**
 * M15-06 steps 6 and 7: the seed site (`mara`, moved to page entries by the cutover migration on
 * db:reset) through its readers, on the phone (390x844) and desktop (1440x900): Home and a sub-page
 * render on the tenant host, a menu link opens the sub-page, the analytics dashboard lists Home and
 * the sub-pages, a shared draft link renders, and nothing scrolls sideways. Read-only on the seed
 * data, except the share link it makes and revokes.
 */

const HANDLE = "mara";
const SITE_ID = "00000000-0000-4000-8000-0000000000b1";
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const ITEMS = {
  id: "00000000-0000-4000-8000-0000000000c1",
  path: "items",
  title: "Prints and gear",
};
const DIRECTIONS = { path: "directions", title: "Directions" };

test.describe.configure({ timeout: 120_000 });

test("M15-06 the seed site is served from page entries: Home and its sub-pages have their entries", async () => {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("id, live_path, published, deleted_at")
    .eq("site_id", SITE_ID)
    .not("published", "is", null);
  expect(error).toBeNull();
  const paths = (data ?? []).map((row) => row.live_path as string).sort();
  expect(paths).toEqual(["/", DIRECTIONS.path, ITEMS.path].sort());
  // The moved sub-page kept its id; Home got a new one.
  expect(data!.find((row) => row.live_path === ITEMS.path)!.id).toBe(ITEMS.id);
  expect(data!.find((row) => row.live_path === "/")!.id).not.toBe(SITE_ID);
});

test("M15-06 Home and a sub-page render, and a menu link opens the sub-page", async ({ page }) => {
  const home = await page.goto(url(HANDLE, "/"));
  expect(home?.status()).toBe(200);
  const menu = page.locator("nav.pg-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator("a.pg-menu-item")).toHaveText(["Home", ITEMS.title, DIRECTIONS.title]);
  await expect(menu.locator('a[aria-current="page"]')).toHaveText("Home");
  // Home's own blocks, from its page entry.
  await expect(page.locator("main.pg-blocks [data-block-id]").first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await menu.getByRole("link", { name: ITEMS.title, exact: true }).click();
  await page.waitForURL(url(HANDLE, `/${ITEMS.path}`));
  await expect(page).toHaveTitle(new RegExp(ITEMS.title));
  await expect(page.locator('nav.pg-menu a[aria-current="page"]')).toHaveText(ITEMS.title);
  await expect(page.locator("main.pg-blocks [data-block-id]").first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The other sub-page, opened by its address.
  const directions = await page.goto(url(HANDLE, `/${DIRECTIONS.path}`));
  expect(directions?.status()).toBe(200);
  await expect(page.getByText("Open in maps")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("M15-06 the dashboard lists Home and the sub-pages", async ({ page, context }) => {
  await signInAs(context, MARA_EMAIL);
  await page.goto(`${ANALYTICS()}?range=7`);
  await expect(page.getByTestId("kpi-strip")).toBeVisible();
  const filter = page.getByTestId("page-filter");
  await expect(filter).toBeVisible();
  const labels = await filter.locator("option").allInnerTexts();
  expect(labels.slice(0, 2)).toEqual(["All pages", "Home"]);
  expect(labels).toContain(ITEMS.title);
  expect(labels).toContain(DIRECTIONS.title);
  // Each page is listed once: Home's entry is not a second "page".
  expect(labels.filter((label) => label === "Home")).toHaveLength(1);
  expect(labels.filter((label) => label === ITEMS.title)).toHaveLength(1);
  // The sub-page is chosen by its entry id, which is its old id.
  await filter.selectOption({ label: ITEMS.title });
  await expect(page).toHaveURL(new RegExp(`filter=${ITEMS.id}`));
  await expect(page.getByTestId("kpi-strip")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("M15-06 a shared draft link renders Home and a sub-page from the entries", async ({
  page,
}) => {
  const link = await makeLink(OWNER_ID, SITE_ID);
  try {
    const response = await page.goto(url("app", sharePath(link.token)));
    expect(response?.status()).toBe(200);
    const menu = page.locator("nav.pg-menu");
    await expect(menu.locator(".pg-menu-item")).toHaveText(["Home", ITEMS.title, DIRECTIONS.title]);
    await expect(page.locator("main.pg-blocks [data-block-id]").first()).toBeVisible();
    await expectNoHorizontalScroll(page);

    await menu.getByRole("link", { name: ITEMS.title, exact: true }).click();
    await expect(page).toHaveURL(/\/share\//);
    await expect(page.locator('nav.pg-menu [aria-current="page"]')).toHaveText(ITEMS.title);
    await expect(page.locator("main.pg-blocks [data-block-id]").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  } finally {
    await revokeLink(link.id);
  }
});
