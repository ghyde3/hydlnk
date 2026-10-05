import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { getShare, makeLink, randomIp } from "../m6/pages-helpers";
import { DIRECTIONS, ITEMS, makeLiveSite } from "./tenant-helpers";

/**
 * M11-07 step 1: the private share preview (`/share/{token}`) draws the site's menu as plain text,
 * from the DRAFT titles, because a link in it would leave the draft. Raw HTTP through the route, so
 * it runs once (desktop project).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M11-07, M12-06 the share preview shows the menu from the DRAFT titles, in the owner's order, as working preview links", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await makeLiveSite("shm");
  const link = await makeLink(site.user.id, site.pageId);
  const res = await getShare(link.token, randomIp());
  expect(res.status).toBe(200);

  const nav = res.body.match(/<nav[^>]*class="pg-menu"[\s\S]*?<\/nav>/)?.[0];
  expect(nav, "the menu is drawn").toBeDefined();
  // M12-06 supersedes the plain-text menu: the entries are links to this same preview.
  expect(nav).toContain('data-menu-mode="links"');
  const labels = [...nav!.matchAll(/<a class="pg-menu-item"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
  expect(labels).toEqual(["Home", ITEMS.title, DIRECTIONS.title]);
  expect(nav).toMatch(
    /<a class="pg-menu-item"[^>]*aria-current="page"[^>]*>Home<\/a>|<a class="pg-menu-item" aria-current="page"[^>]*>Home<\/a>/,
  );
  for (const [, href] of nav!.matchAll(/href="([^"]+)"/g)) expect(href).toMatch(/^\/share\//);
});
