import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import {
  APP_ORIGIN,
  getShare,
  makeLink,
  randomIp,
  revokeLink,
  visibleText,
} from "../m6/pages-helpers";
import { ITEMS, makeLiveSite, type LiveSite } from "../m11/tenant-helpers";

/**
 * M16-16: the private share link shows a post's saved draft at `/share/{token}/entry/{entryId}`, on
 * the app host only, signed out, never stored and never indexed. Raw HTTP for the rules (once, on
 * the desktop project): a token of one site never shows an entry of another, and a page entry, a
 * trashed post, a malformed id and a dead link are the one share 404. The preview itself is opened
 * signed out at both projects (phone 390x844 and desktop 1440x900).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

const TITLE = "A post nobody has published";
const BODY = [
  // A body "#" is drawn one level down: the post title is the page's one <h1>.
  "# A heading in the draft",
  "",
  "First paragraph with a [link](https://example.com/out).",
  "",
  "<script>window.__pwned = 1</script>",
  "",
  "[bad](javascript:alert(1))",
  "",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
].join("\n");

/** A draft post of the site (never published), with the blog left off: a preview needs neither. */
async function addDraftPost(site: LiveSite, title = TITLE, body = BODY): Promise<string> {
  const admin = adminClient();
  const type = await admin
    .from("content_types")
    .select("id")
    .eq("site_id", site.pageId)
    .eq("key", "post")
    .single();
  if (type.error) throw new Error(`the post type is missing: ${type.error.message}`);
  const made = await admin
    .from("content_entries")
    .insert({
      site_id: site.pageId,
      type_id: type.data.id,
      draft: { title, slug: "", body, excerpt: "An excerpt" } as never,
    })
    .select("id")
    .single();
  if (made.error) throw new Error(`adding a draft post failed: ${made.error.message}`);
  return made.data.id as string;
}

test("M16-16 /share/{token}/entry/{id} draws the post's draft with the share headers", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await makeLiveSite("spa", { live: false });
  const postId = await addDraftPost(site);
  const link = await makeLink(site.user.id, site.pageId);

  const shown = await getShare(link.token, randomIp(), { rest: `/entry/${postId}` });
  expect(shown.status).toBe(200);
  expect(shown.body).toContain(TITLE);
  expect(shown.body).toContain("A heading in the draft");
  expect(shown.headers["cache-control"]).toMatch(/no-store|no-cache/);
  expect(shown.headers["x-robots-tag"]).toContain("noindex");
  expect(shown.headers["referrer-policy"]).toBe("no-referrer");
  expect(shown.headers["content-security-policy"]).toContain("script-src 'self' 'nonce-");
  expect(shown.headers["set-cookie"]).toBeUndefined();
  expect(shown.body).toContain('name="robots" content="noindex, nofollow"');
  // Raw HTML is text, a javascript: link has no href, and nothing points at a tenant host.
  expect(shown.body).not.toContain("<script>window.__pwned");
  expect(shown.body).toContain("&lt;script&gt;window.__pwned");
  expect(shown.body).not.toMatch(/href="javascript:/i);
  expect(shown.body).not.toContain(`${site.handle}.localhost`);
  // The embed is an inert poster: no player frame in a private preview.
  expect(shown.body).not.toMatch(/<iframe[^>]+youtube/i);
  // The menu is this link's own addresses.
  expect(shown.body).toContain(`href="/share/${link.token}/${ITEMS.path}"`);
});

test("M16-16 a token of one site never shows an entry of another; every refusal is the one 404", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const mine = await makeLiveSite("spm", { live: false });
  const theirs = await makeLiveSite("spt", { live: false });
  const SECRET = `Their secret draft ${randomUUID()}`;
  const myPost = await addDraftPost(mine);
  const theirPost = await addDraftPost(theirs, SECRET, "Their body.");
  const link = await makeLink(mine.user.id, mine.pageId);

  const inactive = await getShare("a".repeat(43), randomIp(), { rest: `/entry/${myPost}` });
  expect(inactive.status).toBe(404);
  const refused = async (rest: string) => {
    const response = await getShare(link.token, randomIp(), { rest });
    expect(response.status, rest).toBe(404);
    expect(response.body, rest).not.toContain(SECRET);
    // One body for every refusal: nothing tells a foreign entry from a dead link.
    expect(visibleText(response.body), rest).toBe(visibleText(inactive.body));
    expect(response.headers["cache-control"]).toMatch(/no-store|no-cache/);
  };

  // Another site's post, with my (valid) token.
  await refused(`/entry/${theirPost}`);
  // A page entry of my own site (the items page and Home's entry) is not a post.
  await refused(`/entry/${mine.itemsId}`);
  // Malformed ids and shapes.
  for (const rest of [
    "/entry",
    "/entry/not-a-uuid",
    `/entry/${myPost}/extra`,
    `/entry/${myPost.toUpperCase().replace(/[0-9]/, "A")}`,
    `/entry/${randomUUID()}`,
    `/entries/${myPost}`,
    `/entry/${myPost}%2F..`,
  ]) {
    await refused(rest);
  }

  // A trashed post.
  expect((await getShare(link.token, randomIp(), { rest: `/entry/${myPost}` })).status).toBe(200);
  const trashed = await adminClient()
    .from("content_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", myPost);
  if (trashed.error) throw new Error(trashed.error.message);
  await refused(`/entry/${myPost}`);

  // A link that is turned off shows no post, at once.
  const restored = await adminClient()
    .from("content_entries")
    .update({ deleted_at: null })
    .eq("id", myPost);
  if (restored.error) throw new Error(restored.error.message);
  expect((await getShare(link.token, randomIp(), { rest: `/entry/${myPost}` })).status).toBe(200);
  await revokeLink(link.id);
  await refused(`/entry/${myPost}`);
});

test("M16-16 the post address exists on the app host only", async ({}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const site = await makeLiveSite("sph");
  const postId = await addDraftPost(site);
  const link = await makeLink(site.user.id, site.pageId);
  const { rawRequest } = await import("../fixtures/http");
  for (const host of [`${site.handle}.localhost:3000`, "localhost:3000"]) {
    const response = await rawRequest(host, `/share/${link.token}/entry/${postId}`);
    expect(response.status, host).toBe(404);
    expect(response.body, host).not.toContain(TITLE);
  }
});

test("M16-16 a signed-out visitor previews a draft post", async ({ page, context }) => {
  const site = await makeLiveSite("spv", { live: false });
  const postId = await addDraftPost(site);
  const link = await makeLink(site.user.id, site.pageId);
  await context.clearCookies();
  const address = `${APP_ORIGIN}/share/${link.token}/entry/${postId}`;
  const response = await page.goto(address);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "A heading in the draft" })).toBeVisible();
  await expect(page).toHaveTitle(`Preview of ${TITLE}`);
  // The draft's raw HTML never ran.
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // A link in the body goes nowhere inside a preview; the menu stays inside the preview.
  await page.getByRole("link", { name: "link", exact: true }).click();
  await expect(page).toHaveURL(address);
  await page
    .getByRole("navigation", { name: "Site menu" })
    .getByRole("link", { name: ITEMS.title })
    .click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/share/${link.token}/${ITEMS.path}`);
});
