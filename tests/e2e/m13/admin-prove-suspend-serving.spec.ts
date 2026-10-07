import { expect, test, type Browser } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { rollupDay } from "../m4/analytics-db-helpers";
import { addDomainRow, hostnameFor } from "../m4/domains-core-helpers";
import {
  IDS,
  eventsOf,
  getClick,
  ingestPage,
  postBeacon,
  settledCount,
  waitForEvents,
} from "../m4/analytics-ingest-helpers";
import {
  json,
  postApp,
  sessionCookie,
  signInAsAdmin,
  suspendPath,
  unsuspendPath,
} from "../m5/admin-helpers";

/**
 * M13-12: the steps of M5-08 that the earlier spec (tests/e2e/m5/suspend-serving.spec.ts) could not
 * cover when it was written, because the code did not exist yet: tracking stops at request time while
 * the owner is suspended (the click redirect and the view beacon write nothing and the page's events
 * and daily stats stay), it resumes on unsuspend, and a custom-domain host and its OG image answer the
 * same unavailable 404. The real admin suspend route, the real hosts, the real proxy.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const UNAVAILABLE = "This page isn’t available.";

async function adminCookieFor(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  await signInAsAdmin(context, "m13ps");
  const cookie = await sessionCookie(context);
  await context.close();
  return cookie;
}

const stats = async (pageId: string) => {
  const { data, error } = await adminClient().from("daily_stats").select("*").eq("page_id", pageId);
  if (error) throw new Error(error.message);
  return data ?? [];
};

test.describe("M5-08 tracking stops with the suspension (proved in Wave N)", () => {
  test("M5-08 while suspended /r answers 404 with no Location and /api/e answers 204, neither writes an events row and existing events and daily_stats stay; after unsuspend both work again", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const page = await ingestPage("m13tk");
    const adminCookie = await adminCookieFor(browser);

    // Live: a click redirects and is recorded, a beacon is recorded.
    const live = await getClick(page, IDS.link);
    expect(live.status).toBe(302);
    expect(live.location).toBe("https://example.com/book");
    expect((await postBeacon(page)).status).toBe(204);
    await waitForEvents(page.pageId, 2);
    // The nightly rollup turns today's events into daily_stats rows (the secret key may call it).
    expect(await rollupDay(new Date().toISOString().slice(0, 10))).toBeGreaterThan(0);
    const eventsBefore = await eventsOf(page.pageId);
    const statsBefore = await stats(page.pageId);
    expect(eventsBefore.length).toBeGreaterThanOrEqual(2);
    expect(statsBefore.length).toBeGreaterThan(0);

    // Suspend through the real route.
    const suspended = await postApp(suspendPath(page.userId), { cookie: adminCookie });
    expect(suspended.status, suspended.body).toBe(200);
    expect(json(suspended)).toMatchObject({ ok: true, changed: true });

    // The click target is a 404 with no way out; the beacon is a quiet 204; nothing is written.
    for (const id of [IDS.link, IDS.card, IDS.iconWeb, IDS.cellA]) {
      const click = await getClick(page, id);
      expect(click.status, id).toBe(404);
      expect(click.location, id).toBeNull();
    }
    expect((await postBeacon(page)).status).toBe(204);
    expect((await postBeacon(page)).status).toBe(204);
    expect(await settledCount(page.pageId)).toBe(eventsBefore.length);
    expect(await eventsOf(page.pageId)).toEqual(eventsBefore);
    expect(await stats(page.pageId)).toEqual(statsBefore);

    // Unsuspend: the same URLs work again, with no republish.
    const restored = await postApp(unsuspendPath(page.userId), { cookie: adminCookie });
    expect(json(restored)).toMatchObject({ ok: true, changed: true });
    const back = await getClick(page, IDS.link);
    expect(back.status).toBe(302);
    expect(back.location).toBe("https://example.com/book");
    expect((await postBeacon(page)).status).toBe(204);
    const after = await waitForEvents(page.pageId, eventsBefore.length + 2);
    expect(after.length).toBe(eventsBefore.length + 2);
    expect(after.slice(0, eventsBefore.length)).toEqual(eventsBefore);
  });

  test("M5-08 a custom-domain host and the page's OG image are the same unavailable 404 while suspended, and the page is back after unsuspend", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const page = await ingestPage("m13cd", { plan: "studio" });
    const adminCookie = await adminCookieFor(browser);
    const host = hostnameFor("m13cd");
    await addDomainRow({ pageId: page.pageId, hostname: host, status: "verified" });
    // What only this page says about itself.
    const markers = [
      page.doc.profile.name,
      ...page.doc.blocks.flatMap((block) => ("label" in block && block.label ? [block.label] : [])),
    ].filter((marker) => marker.length >= 3);
    expect(markers.length).toBeGreaterThan(1);

    const get = (path: string) => rawRequest(host, path);
    const liveHome = await get("/");
    expect(liveHome.status).toBe(200);
    expect(liveHome.body).toContain(markers[0]!);
    expect((await get("/og")).status).toBe(200);

    const suspended = await postApp(suspendPath(page.userId), { cookie: adminCookie });
    expect(suspended.status, suspended.body).toBe(200);

    const gone = await get("/");
    expect(gone.status).toBe(404);
    expect(gone.body).toContain(UNAVAILABLE);
    expect(gone.body).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex/i);
    for (const marker of markers) expect(gone.body, marker).not.toContain(marker);
    for (const tag of ['property="og:', 'name="twitter:', 'name="description"']) {
      expect(gone.body, tag).not.toContain(tag);
    }
    const ogGone = await get("/og");
    expect(ogGone.status).toBe(404);
    expect(ogGone.headers["content-type"] ?? "").not.toContain("image/png");
    // The tracking routes on the custom host are quiet too.
    expect((await getClick(page, IDS.link, { host })).status).toBe(404);
    expect((await postBeacon(page, undefined, { host, origin: `http://${host}` })).status).toBe(
      204,
    );
    expect(await settledCount(page.pageId)).toBe(0);

    const restored = await postApp(unsuspendPath(page.userId), { cookie: adminCookie });
    expect(json(restored)).toMatchObject({ ok: true });
    const back = await get("/");
    expect(back.status).toBe(200);
    expect(back.body).toContain(markers[0]!);
    expect((await get("/og")).status).toBe(200);
  });
});
