import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  APP_ORIGIN,
  getShare,
  makeLink,
  randomIp,
  revokeLink,
  visibleText,
} from "../m6/pages-helpers";
import {
  BACK_PAGE_LINK,
  DIRECTIONS,
  HOME_PAGE_LINK,
  ITEMS,
  makeLiveSite,
} from "../m11/tenant-helpers";

/**
 * M12-06: the private share preview shows every page of the site, with a working menu, on the app
 * host only. Raw HTTP for the token rules (once, desktop project); the menu and page links are
 * clicked at both projects (phone 390x844 and desktop 1440x900).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M12-06 /share/{token}/{path} previews that page's draft; unknown, reserved and nested paths are the 404", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await makeLiveSite("shp", { live: false });
  const link = await makeLink(site.user.id, site.pageId);

  const page = await getShare(link.token, randomIp(), { rest: `/${ITEMS.path}` });
  expect(page.status).toBe(200);
  // The page's own title and block, even though it was never published.
  expect(page.body).toContain(ITEMS.title);
  expect(page.body).toContain(`Open ${ITEMS.title}`);
  expect(page.headers["cache-control"]).toMatch(/no-store|no-cache/);
  expect(page.headers["x-robots-tag"]).toContain("noindex");
  expect(page.headers["referrer-policy"]).toBe("no-referrer");

  // The menu is a set of working links to this preview, never to a tenant host.
  const nav = page.body.match(/<nav[^>]*class="pg-menu"[\s\S]*?<\/nav>/)?.[0] ?? "";
  expect(nav).toContain('data-menu-mode="links"');
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  expect(hrefs).toEqual([
    `/share/${link.token}`,
    `/share/${link.token}/${ITEMS.path}`,
    `/share/${link.token}/${DIRECTIONS.path}`,
  ]);
  expect(nav).toMatch(new RegExp(`aria-current="page"[^>]*>${ITEMS.title}<`));
  // The back link on the page points at Home's preview, not at "/".
  expect(page.body).toContain(`href="/share/${link.token}"`);
  expect(page.body).not.toContain(`${site.handle}.localhost`);

  const dead = await getShare(link.token, randomIp(), { rest: "/nope" });
  expect(dead.status).toBe(404);
  const inactive = await getShare("a".repeat(43), randomIp(), { rest: `/${ITEMS.path}` });
  expect(inactive.status).toBe(404);
  // One body for every refusal: a bad path under a good token tells nothing a bad token does not.
  expect(visibleText(dead.body)).toBe(visibleText(inactive.body));
  for (const rest of ["/og", "/share", "/hl-x", "/api", "/items/extra", "/Items"]) {
    const response = await getShare(link.token, randomIp(), { rest: rest });
    expect(response.status, rest).toBe(404);
  }
});

test("M12-06 the token rules hold for a page: turned off is 404 at once", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await makeLiveSite("shq");
  const link = await makeLink(site.user.id, site.pageId);
  expect((await getShare(link.token, randomIp(), { rest: `/${DIRECTIONS.path}` })).status).toBe(
    200,
  );
  await revokeLink(link.id);
  expect((await getShare(link.token, randomIp(), { rest: `/${DIRECTIONS.path}` })).status).toBe(
    404,
  );
  expect((await getShare(link.token, randomIp())).status).toBe(404);
});

test("M12-06 the menu and the page links inside the preview navigate within the preview", async ({
  page,
}) => {
  const site = await makeLiveSite("shn");
  const link = await makeLink(site.user.id, site.pageId);
  const home = `${APP_ORIGIN}/share/${link.token}`;
  await page.goto(home);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, ".pg-menu-item");

  // A page link on Home goes to the page in the preview.
  await page.getByText(HOME_PAGE_LINK.label).click();
  await expect(page).toHaveURL(`${home}/${ITEMS.path}`);
  await expect(page.getByRole("heading", { level: 1, name: ITEMS.title })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // The menu takes you to another page, and back to Home.
  await page.getByRole("link", { name: DIRECTIONS.title }).click();
  await expect(page).toHaveURL(`${home}/${DIRECTIONS.path}`);
  await expect(page.getByRole("heading", { level: 1, name: DIRECTIONS.title })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Site menu" })
    .getByRole("link", { name: "Home" })
    .click();
  await expect(page).toHaveURL(home);

  // The back link of the items page goes to Home's preview.
  await page.goto(`${home}/${ITEMS.path}`);
  await page.getByText(BACK_PAGE_LINK.label).click();
  await expect(page).toHaveURL(home);

  // An ordinary link in the preview still goes nowhere.
  await page.goto(`${home}/${ITEMS.path}`);
  await page.getByText(`Open ${ITEMS.title}`).click();
  await expect(page).toHaveURL(`${home}/${ITEMS.path}`);
});
