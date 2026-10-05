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

test("M11-07 the share preview shows the menu as plain text, in the owner's order, with no links in it", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await makeLiveSite("shm");
  const link = await makeLink(site.user.id, site.pageId);
  const res = await getShare(link.token, randomIp());
  expect(res.status).toBe(200);

  const nav = res.body.match(/<nav[^>]*class="pg-menu"[\s\S]*?<\/nav>/)?.[0];
  expect(nav, "the menu is drawn").toBeDefined();
  expect(nav).toContain('data-menu-mode="text"');
  // Plain text: spans, never anchors, so nothing in the menu can leave the draft.
  expect(nav).not.toMatch(/<a[\s>]/);
  expect(nav).not.toMatch(/href=/);
  const labels = [...nav!.matchAll(/<span class="pg-menu-item"[^>]*>([^<]*)<\/span>/g)].map(
    (m) => m[1],
  );
  expect(labels).toEqual(["Home", ITEMS.title, DIRECTIONS.title]);
  expect(nav).toMatch(/<span class="pg-menu-item" aria-current="page">Home<\/span>/);
});
