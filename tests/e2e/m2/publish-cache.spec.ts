import { expect, test, type Page } from "@playwright/test";
import { emptyDraft, publishedDocSchema, toPublishForm, type Block } from "@/lib/document";
import { adminClient, publishableKey, signInAs, supabaseUrl } from "../fixtures/auth";
import { addPage, cleanupUsers, makeUser, rand } from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import { pageRow, setDraft, accessToken, emptyUser } from "./editor-helpers";
import { SERVER_PORT, pngSizeOf, rawBuffer, tenantGet } from "./publish-helpers";

/**
 * M2-26: the public page is cached under one tag per page and Publish expires it with updateTag.
 * x-nextjs-cache only exists in a production build, so this spec runs against `next start`:
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm build
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm start -p 3100
 *   HL_PROD_PORT=3100 pnpm test:e2e tests/e2e/m2/publish-cache.spec.ts
 *
 * The root domain is baked into the build, so the port in it is the port of the server. The shared
 * dev server on :3000 is only used to sign in (the session cookie is host-only, not per port).
 * HYDLNK_QUERY_COUNTER=1 turns on GET /hl-query-count on a tenant host: how many times the public
 * query really read Postgres for that page.
 */

test.skip(!process.env.HL_PROD_PORT, "needs a production build: set HL_PROD_PORT (see the header)");
test.describe.configure({ mode: "serial" });

test.afterAll(cleanupUsers);

const APP = `http://app.localhost:${SERVER_PORT}`;
const decode = (html: string) =>
  html
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

const link = (id: string, label: string, href = "https://example.com/x"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url: href,
});

const cacheState = (res: { headers: Record<string, unknown> }) =>
  String(res.headers["x-nextjs-cache"] ?? "");

async function queryCount(handle: string): Promise<number> {
  const res = await tenantGet(handle, "/hl-query-count");
  expect(res.status, "the server must run with HYDLNK_QUERY_COUNTER=1").toBe(200);
  return (JSON.parse(res.text) as { count: number }).count;
}

/** A user with a published page (name, bio and one link) and a draft equal to it. */
async function publishedUser(
  context: Parameters<typeof emptyUser>[0],
  label: string,
  plan?: "free" | "pro" | "studio",
) {
  const user = await emptyUser(context, label, plan ? { plan } : {});
  const draft = emptyDraft(user.handle);
  draft.profile.name = `Zq ${label}`;
  draft.profile.bio = `Bio of ${label}`;
  draft.blocks = [link("lnk-cache-0001", "Book now")];
  await setDraft(user.pageId, draft);
  const { error } = await adminClient()
    .from("pages")
    .update({ published: toPublishForm(draft, null), published_at: new Date().toISOString() })
    .eq("id", user.pageId);
  expect(error).toBeNull();
  return { ...user, draft };
}

/**
 * Opens the editor with the browser kept off the page's `/og` image. Since M6-33 the share preview
 * loads the live `/og?v=<publishedAt>` on open and again the moment Publish finishes. Each of those
 * is a second reader of the page's cache entry: it reads the database once for itself, or races the
 * GET under test (two concurrent misses are two reads). The OG image is fetched explicitly where a
 * test needs it, over plain HTTP, which this does not touch.
 */
async function openEditor(page: Page) {
  await page.route(/\/og\?v=/, (route) => route.abort());
  await page.goto(`${APP}/editor`);
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
}

const publishButton = (page: Page) => page.getByRole("button", { name: /^Publish/ });
const chip = (page: Page) => page.locator("[data-publish-status]");

test.describe("M2-26 Publish invalidates the page cache with updateTag (production build)", () => {
  test("M2-05 the dev-only renderer fixture route is a 404 in a production build", async () => {
    const res = await rawBuffer(`localhost:${SERVER_PORT}`, "/dev/renderer");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("data-page-root");
  });

  test("M2-26 two GETs: the second is a HIT and the public query ran once", async ({ context }) => {
    const user = await publishedUser(context, "ca");
    const first = await tenantGet(user.handle);
    const second = await tenantGet(user.handle);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(cacheState(first)).toBe("MISS");
    expect(cacheState(second)).toBe("HIT");
    expect(second.text).toBe(first.text);
    expect(String(second.headers["cache-control"])).toMatch(/s-maxage=\d+/);
    expect(await queryCount(user.handle)).toBe(1);

    // The seeded page is cached the same way.
    await tenantGet("mara");
    expect(cacheState(await tenantGet("mara"))).toBe("HIT");
  });

  test("M2-26 Publish shows the new bio at once, OG image and metadata included; autosave and other pages are untouched", async ({
    page,
    context,
    browser,
  }) => {
    const a = await publishedUser(context, "cb");
    const otherContext = await browser.newContext(); // a second session, so b is a different user
    const b = await publishedUser(otherContext, "cc");
    for (const user of [a, b]) {
      await tenantGet(user.handle);
      expect(cacheState(await tenantGet(user.handle)), user.handle).toBe("HIT");
    }
    const ogBefore = await tenantGet(a.handle, "/og");
    expect(ogBefore.status).toBe(200);
    const bodyBefore = (await tenantGet(a.handle)).text;
    const countA = await queryCount(a.handle);
    const countB = await queryCount(b.handle);

    await openEditor(page);
    const bio = page.getByLabel("Bio", { exact: true });
    await bio.fill("A new bio zq77");

    // Autosave does not invalidate: the page is still a HIT with the same bytes and no query.
    await expect
      .poll(async () => (await pageRow(a.pageId)).draft.profile.bio, { timeout: 20_000 })
      .toBe("A new bio zq77");
    const afterAutosave = await tenantGet(a.handle);
    expect(cacheState(afterAutosave)).toBe("HIT");
    expect(afterAutosave.text).toBe(bodyBefore);
    expect(await queryCount(a.handle)).toBe(countA);

    // Publish, then GET with no waiting and no second request.
    await publishButton(page).click();
    await expect(chip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });
    const live = await tenantGet(a.handle);
    expect(decode(live.text)).toContain("A new bio zq77");
    expect(cacheState(live)).toBe("MISS"); // regenerated for this request: nothing stale in between
    expect(await queryCount(a.handle)).toBe(countA + 1);
    expect(cacheState(await tenantGet(a.handle))).toBe("HIT");

    // The metadata and the OG image refreshed with the page (same tag).
    expect(decode(live.text)).toMatch(/<meta name="description" content="A new bio zq77"/);
    const ogMeta = /property="og:image" content="([^"]*)"/.exec(decode(live.text))![1]!;
    expect(ogMeta).not.toBe(/property="og:image" content="([^"]*)"/.exec(decode(bodyBefore))![1]);
    const target = new URL(ogMeta);
    const ogAfter = await rawBuffer(target.host, `${target.pathname}${target.search}`);
    expect(ogAfter.status).toBe(200);
    expect(pngSizeOf(ogAfter.body)).toEqual({ width: 1200, height: 630 });
    expect(ogAfter.body.equals(ogBefore.body)).toBe(false);

    // Tags are per page: B is still a HIT and its query count did not move.
    expect(cacheState(await tenantGet(b.handle))).toBe("HIT");
    expect(await queryCount(b.handle)).toBe(countB);
    await otherContext.close();
  });

  test("M2-26 a Publish that fails validation does not touch the cache", async ({
    page,
    context,
  }) => {
    const user = await publishedUser(context, "cd");
    await tenantGet(user.handle);
    const hit = await tenantGet(user.handle);
    expect(cacheState(hit)).toBe("HIT");
    const count = await queryCount(user.handle);

    // A client writes a javascript: URL straight into the draft with the publishable key.
    const token = await accessToken(context);
    const bad = {
      ...user.draft,
      rev: 50,
      blocks: [link("lnk-cache-0001", "Click", "javascript:alert(1)")],
    };
    const write = await fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ draft: bad }),
    });
    expect(write.status).toBeLessThan(300);
    // A draft write is not a publish: the live page stays a HIT.
    const afterDraft = await tenantGet(user.handle);
    expect(cacheState(afterDraft)).toBe("HIT");
    expect(afterDraft.text).toBe(hit.text);

    await openEditor(page);
    await publishButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /before publishing/ })).toBeVisible({
      timeout: 30_000,
    });
    const after = await tenantGet(user.handle);
    expect(cacheState(after)).toBe("HIT");
    expect(after.text).toBe(hit.text);
    expect(await queryCount(user.handle)).toBe(count);
  });

  test("M2-26 first publish: the placeholder switches to the real page on the first successful Publish", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "ce");
    const draft = emptyDraft(user.handle);
    draft.profile.name = "Zq First";
    draft.profile.bio = "First bio";
    draft.blocks = [link("lnk-cache-0001", "Book now")];
    await setDraft(user.pageId, draft);

    await tenantGet(user.handle);
    const placeholder = await tenantGet(user.handle);
    expect(placeholder.text).toContain("Nothing published here yet.");
    expect(cacheState(placeholder)).toBe("HIT");

    await openEditor(page);
    await publishButton(page).click();
    await expect(chip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });
    const live = await tenantGet(user.handle);
    expect(live.text).not.toContain("Nothing published here yet.");
    expect(decode(live.text)).toContain("First bio");
  });

  test("M2-26 direct-API abuse: a draft write does not change the live page, a published write is rejected", async ({
    context,
  }) => {
    const user = await publishedUser(context, "cf");
    await tenantGet(user.handle);
    const hit = await tenantGet(user.handle);
    expect(cacheState(hit)).toBe("HIT");
    const token = await accessToken(context);
    const patch = (body: unknown) =>
      fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${user.pageId}`, {
        method: "PATCH",
        headers: {
          apikey: publishableKey(),
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

    expect(
      (
        await patch({
          draft: {
            ...user.draft,
            rev: 77,
            profile: { ...user.draft.profile, name: "POISON-DRAFT" },
          },
        })
      ).status,
    ).toBeLessThan(300);
    expect(
      (
        await patch({
          published: {
            ...toPublishForm(user.draft, null),
            profile: { name: "POISON-PUBLISHED", bio: "", photo: null },
          },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await patch({ published_at: "2026-01-01T00:00:00Z" })).status).toBeGreaterThanOrEqual(
      400,
    );

    const after = await tenantGet(user.handle);
    expect(cacheState(after)).toBe("HIT");
    expect(after.text).toBe(hit.text);
    expect(after.text).not.toContain("POISON");
    const row = await pageRow(user.pageId);
    expect(publishedDocSchema.parse(row.published).profile.name).toBe(user.draft.profile.name);
  });

  test("M2-26 an unknown handle is not kept: a claimed handle shows its placeholder within seconds", async ({}) => {
    const handle = `zq-cg-${rand(5)}`;
    const unknown = await tenantGet(handle);
    expect(unknown.status).toBe(404);
    // A 404 may be cached, but only for a few seconds (not a year).
    expect(String(unknown.headers["cache-control"])).toMatch(/s-maxage=([0-9]|10)\b/);

    const owner = await makeUser("cg");
    const { error } = await adminClient()
      .from("pages")
      .insert({ owner_id: owner.id, handle, draft: emptyDraft(handle) });
    expect(error).toBeNull();
    await expect
      .poll(async () => (await tenantGet(handle)).status, {
        timeout: 20_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(200);
    expect((await tenantGet(handle)).text).toContain("Nothing published here yet.");
  });

  test("M2-26 claiming a handle through the app expires its cached 404 at once, with no waiting", async ({
    context,
  }) => {
    const handle = `zq-ch-${rand(5)}`;
    const unknown = await tenantGet(handle);
    expect(unknown.status).toBe(404);
    // Served again from the cache: still a 404 for the few seconds it may live.
    expect((await tenantGet(handle)).status).toBe(404);

    const owner = await makeUser("ch");
    await signInAs(context, owner.email);
    const claimed = await context.request.post(`${APP}/api/handles/claim`, {
      data: { handle },
      headers: { origin: APP },
    });
    expect(claimed.status()).toBe(201);

    // The very next request: the claim called invalidateHandle, so the placeholder is already up.
    const after = await tenantGet(handle);
    expect(after.status).toBe(200);
    expect(after.text).toContain("Nothing published here yet.");
  });
  test("M1-22 / M2-26 deleting the account expires the cached page at once, with no waiting", async ({
    page,
    context,
  }) => {
    const user = await publishedUser(context, "cd");
    await tenantGet(user.handle);
    expect(cacheState(await tenantGet(user.handle))).toBe("HIT");

    await page.goto(`${APP}/settings`);
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/\/login/);

    // The very next request: the page is gone from the cache, not served stale for a year.
    const after = await tenantGet(user.handle);
    expect(after.status).toBe(404);
    expect(after.text).not.toContain(user.draft.profile.name);
  });

  test("M4-19 deleting a page expires its cached page at once, with no waiting", async ({
    context,
  }) => {
    const user = await publishedUser(context, "pd", "pro");
    await addPage(user.id, `zq-pd2-${rand(5)}`); // the account keeps a page: this is not the last one
    await tenantGet(user.handle);
    expect(cacheState(await tenantGet(user.handle))).toBe("HIT");

    const res = await rawBuffer(`app.localhost:${SERVER_PORT}`, `/api/pages/${user.pageId}`, {
      method: "DELETE",
      cookie: cookieHeader(await authCookies(context)),
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ confirm: user.handle })),
    });
    expect(res.status, res.text).toBe(200);

    // The very next request: the page's tag and its handle's cached 404 were expired by the delete.
    const after = await tenantGet(user.handle);
    expect(after.status).toBe(404);
    expect(after.text).not.toContain(user.draft.profile.name);
  });
});
