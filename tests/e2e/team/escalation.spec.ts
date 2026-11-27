import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { url } from "../helpers";
import { memberOf, openApp, signInMember, studioOwner } from "./team-helpers";

/**
 * M19-07 at 390 and 1440: an accepted publisher's requests to the owner's operations change nothing
 * and are refused: the owner-only screens and files, the blog's settings, deleting the site, and the
 * publishable-key writes the owner alone may make (rename).
 */
test.afterAll(cleanupUsers);

test("M19-07 a publisher cannot do the owner's operations", async ({ browser, context }) => {
  test.setTimeout(120_000);
  const owner = await studioOwner(context, "m19esc");
  const publisher = await memberOf(owner, "publisher", "m19esc-pub");
  const memberContext = await browser.newContext();
  await signInMember(memberContext, publisher);
  const page = await memberContext.newPage();
  await openApp(page, "/editor");
  const origin = url("app").replace(/\/$/, "");
  const headers = { origin, "content-type": "application/json" };

  const blog = await page.request.post(url("app", `/api/pages/${owner.pageId}/types/post`), {
    headers,
    data: { enabled: true },
  });
  expect(blog.status()).toBe(404);
  // With the confirmation the owner would type: the delete core's owner check refuses.
  const del = await page.request.delete(url("app", `/api/pages/${owner.pageId}`), {
    headers,
    data: { confirm: owner.handle },
  });
  expect([403, 404]).toContain(del.status());
  for (const path of ["/analytics/stats?range=30d", "/analytics/export?kind=summary", "/audience/export?form=all"]) {
    expect((await page.request.get(url("app", path))).status(), path).toBe(404);
  }
  const row = await adminClient().from("pages").select("id, name").eq("id", owner.pageId).single();
  expect(row.data?.id).toBe(owner.pageId);
  const type = await adminClient().from("content_types").select("enabled").eq("site_id", owner.pageId).eq("key", "post").single();
  expect(type.data?.enabled).toBe(false);
  // No rename control on a shared site.
  await expect(page.getByRole("button", { name: /Rename/ })).toHaveCount(0);
  await memberContext.close();
});
