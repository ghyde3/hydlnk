import { expect, test, type Browser } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { appRaw, sessionOf } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  json,
  postApp,
  sessionCookie,
  signInAsAdmin,
  signInAsUser,
  suspendedAt,
  suspendPath,
  tenantRaw,
  unsuspendPath,
} from "./admin-helpers";

/**
 * M5-08: suspended pages stop serving. The real admin suspend route (a signed-in admin's POST), the
 * real tenant host, the real proxy. `next dev` never caches a page, so "no stale copy" holds there
 * trivially; the cache tags themselves are proven by tests/unit/admin-actions.test.ts (the actions
 * call invalidateAccountPages and invalidateHandle) and by the production-build spec
 * tests/e2e/m5/suspend-cache.spec.ts (HL_PROD_PORT).
 *
 * Not covered because the code does not exist yet: the click redirect /r/{pageId}/{blockId} and
 * POST /api/e (Milestone 4 analytics) and a custom-domain host (the /sites route is a stub).
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

async function adminCookieFor(browser: Browser, label = "sadm"): Promise<string> {
  const context = await browser.newContext();
  await signInAsAdmin(context, label);
  const cookie = await sessionCookie(context);
  await context.close();
  return cookie;
}

const UNAVAILABLE = "This page isn’t available.";

/**
 * What the page says about itself: a name distinct from the handle (the fixture copies the handle
 * into the name, and the handle is in the URL, so it would be in any 404), the bio, every link's
 * label and URL.
 */
async function publishedMarkers(pageId: string) {
  const admin = adminClient();
  const stored = await admin.from("pages").select("published").eq("id", pageId).single();
  const renamed = JSON.parse(JSON.stringify(stored.data!.published));
  renamed.profile.name = "Zq Distinct Display Name";
  await admin.from("pages").update({ published: renamed }).eq("id", pageId);
  const { data } = await admin.from("pages").select("published").eq("id", pageId).single();
  const doc = data!.published as {
    profile: { name: string; bio: string };
    blocks: { label?: string; url?: string }[];
  };
  const markers = [doc.profile.name, doc.profile.bio];
  for (const block of doc.blocks) {
    if (block.label) markers.push(block.label);
    if (block.url) markers.push(block.url);
  }
  return markers.filter((m) => m && m.length >= 3);
}

test.describe("M5-08 suspended pages stop serving", () => {
  test("M5-08 a suspended page is the 404 'This page isn’t available.' with noindex and none of the page's content, then unsuspending restores it without republishing", async ({
    browser,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const owner = await signInAsUser(context, "srv");
    const bystander = await signInAsUser(await browser.newContext(), "byst");
    const adminCookie = await adminCookieFor(browser);
    const markers = await publishedMarkers(owner.pageId!);
    expect(markers.length).toBeGreaterThan(2);
    const publishedBefore = (
      await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", owner.pageId!)
        .single()
    ).data!;

    // Live first: 200 with the page's content and its social tags.
    const live = await tenantRaw(owner.handle!);
    expect(live.status).toBe(200);
    expect(live.body).toContain(markers[0]!);
    expect(live.body).toContain('property="og:title"');
    const liveOg = await tenantRaw(owner.handle!, "/og");
    expect(liveOg.status).toBe(200);

    // Suspend, then fetch again at once: never the old 200.
    const suspended = await postApp(suspendPath(owner.userId), { cookie: adminCookie });
    expect(suspended.status, suspended.body).toBe(200);
    expect(json(suspended)).toMatchObject({ ok: true, changed: true });
    const gone = await tenantRaw(owner.handle!);
    expect(gone.status).toBe(404);
    expect(gone.body).toContain(UNAVAILABLE);
    expect(gone.body).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex/i);
    for (const marker of markers) {
      expect(gone.body, `the 404 must not contain "${marker}"`).not.toContain(marker);
    }
    for (const tag of ['property="og:', 'name="twitter:', 'name="description"']) {
      expect(gone.body, tag).not.toContain(tag);
    }
    expect(gone.body).not.toContain("Claim");
    expect(gone.body).not.toContain("isn’t claimed");
    // The social image is a 404 too.
    const ogGone = await tenantRaw(owner.handle!, "/og");
    expect(ogGone.status).toBe(404);
    expect(ogGone.headers["content-type"] ?? "").not.toContain("image/png");
    // Another account is unaffected.
    const other = await tenantRaw(bystander.handle!);
    expect(other.status).toBe(200);
    expect(other.body).not.toContain(UNAVAILABLE);

    // The handle stays held.
    const check = await appRaw(`/api/handles/check?handle=${owner.handle}`);
    expect(JSON.parse(check.body)).toMatchObject({ status: "taken" });

    // Unsuspend: the original content again, without a republish.
    const restored = await postApp(unsuspendPath(owner.userId), { cookie: adminCookie });
    expect(json(restored)).toMatchObject({ ok: true, changed: true });
    expect(await suspendedAt(owner.userId)).toBeNull();
    const back = await tenantRaw(owner.handle!);
    expect(back.status).toBe(200);
    expect(back.body).toContain(markers[0]!);
    expect(back.body).not.toContain(UNAVAILABLE);
    expect((await tenantRaw(owner.handle!, "/og")).status).toBe(200);
    const publishedAfter = (
      await adminClient()
        .from("pages")
        .select("published, published_at")
        .eq("id", owner.pageId!)
        .single()
    ).data!;
    expect(publishedAfter).toEqual(publishedBefore);
  });

  test("M5-08 a double click on Suspend and on Unsuspend shows no error", async ({
    browser,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const owner = await signInAsUser(context, "dbl");
    const adminCookie = await adminCookieFor(browser, "sadm2");
    const [a, b] = await Promise.all([
      postApp(suspendPath(owner.userId), { cookie: adminCookie }),
      postApp(suspendPath(owner.userId), { cookie: adminCookie }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const stamp = await suspendedAt(owner.userId);
    expect(stamp).not.toBeNull();
    expect((await postApp(suspendPath(owner.userId), { cookie: adminCookie })).status).toBe(200);
    expect(await suspendedAt(owner.userId)).toBe(stamp);
    const [c, d] = await Promise.all([
      postApp(unsuspendPath(owner.userId), { cookie: adminCookie }),
      postApp(unsuspendPath(owner.userId), { cookie: adminCookie }),
    ]);
    expect([c.status, d.status]).toEqual([200, 200]);
    expect(await suspendedAt(owner.userId)).toBeNull();
  });

  test("M5-08 a suspended owner cannot bring the page back: republishing is refused (account_suspended) and writing `published` with the publishable key is rejected", async ({
    page,
    browser,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "needs the editor and the captured Server Action");
    const owner = await signInAsUser(context, "rep");
    const adminCookie = await adminCookieFor(browser, "sadm3");
    const row = async () =>
      (
        await adminClient()
          .from("pages")
          .select("published, published_at")
          .eq("id", owner.pageId!)
          .single()
      ).data!;

    // Capture the exact Publish request from the editor (never sent), as an owner would.
    await page.goto(url("app", "/editor"));
    let recorded: { headers: Record<string, string>; body: string } | undefined;
    await page.route("**/editor", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        recorded = { headers: request.headers(), body: request.postData() ?? "" };
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.getByRole("button", { name: /^Publish/ }).click();
    await expect.poll(() => recorded).toBeTruthy();
    await page.unroute("**/editor");

    const before = await row();
    expect((await postApp(suspendPath(owner.userId), { cookie: adminCookie })).status).toBe(200);

    const headers: Record<string, string> = {};
    for (const name of ["next-action", "content-type", "accept", "next-router-state-tree"]) {
      if (recorded!.headers[name]) headers[name] = recorded!.headers[name]!;
    }
    const replay = await appRaw("/editor", {
      method: "POST",
      cookie: await sessionCookie(context),
      headers: { ...headers, origin: "http://app.localhost:3000" },
      body: recorded!.body,
    });
    expect(replay.body, replay.body.slice(0, 300)).toContain("account_suspended");
    expect(replay.body).not.toContain('"ok":true');
    expect(await row()).toEqual(before);
    expect((await tenantRaw(owner.handle!)).status).toBe(404);

    // The publishable key cannot write `published` either (column grant), suspended or not.
    const session = await sessionOf(context);
    const write = await fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${owner.pageId}`, {
      method: "PATCH",
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ published: { hacked: true }, published_at: new Date().toISOString() }),
    });
    expect(write.status).toBeGreaterThanOrEqual(400);
    expect(await row()).toEqual(before);
    expect((await tenantRaw(owner.handle!)).status).toBe(404);
  });
});

test.describe("M5-08 the unavailable page", () => {
  test("M5-08 at 390x844 it is centered with no horizontal scroll and 'Go to hydlnk.com' is at least 44px tall", async ({
    browser,
    context,
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    const owner = await signInAsUser(context, "uph");
    const adminCookie = await adminCookieFor(browser, "sadm4");
    expect((await postApp(suspendPath(owner.userId), { cookie: adminCookie })).status).toBe(200);
    const response = await page.goto(url(owner.handle!));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const link = page.getByRole("link", { name: "Go to hydlnk.com" });
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectTapTargets(page);
    // Centered horizontally.
    const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
    const centre = h1!.x + h1!.width / 2;
    expect(Math.abs(centre - 390 / 2)).toBeLessThan(8);
  });

  test("M5-08 at 1440x900 it uses HYDLNK UI tokens (charcoal and brass), never tenant tokens", async ({
    browser,
    context,
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    const owner = await signInAsUser(context, "udt");
    const adminCookie = await adminCookieFor(browser, "sadm5");
    expect((await postApp(suspendPath(owner.userId), { cookie: adminCookie })).status).toBe(200);
    const response = await page.goto(url(owner.handle!));
    expect(response?.status()).toBe(404);
    const main = page.locator("main.tenant-unavailable");
    await expect(main).toBeVisible();
    expect(await main.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    const link = page.getByRole("link", { name: "Go to hydlnk.com" });
    expect(await link.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(184, 145, 79)",
    );
    expect(await link.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(28, 27, 26)");
    const html = await page.content();
    expect(html).not.toContain("--t-");
    expect(html).not.toContain("tenant-root");
    await expectNoHorizontalScroll(page);
  });
});
