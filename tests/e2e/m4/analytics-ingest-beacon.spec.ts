import type { Request } from "@playwright/test";
import { PHONE, DESKTOP } from "../../../scripts/lib/viewports";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll } from "../helpers";
import { openEditor, showView, userWithDraft, draftOf, previewScreen } from "../m2/blocks-helpers";
import {
  DESKTOP_UA,
  HEADLESS_UA,
  IDS,
  IPHONE_UA,
  countEvents,
  eventsOf,
  expect,
  ingestPage,
  postBeacon,
  randomIp,
  settledCount,
  test,
  waitForEvents,
} from "./analytics-ingest-helpers";

/**
 * M4-20, M4-21, M4-23 (view side): the beacon in the browser and on the wire.
 *
 * Browser tests run at 390x844 (iPhone user agent) and 1440x900 (desktop Chrome). Everything about
 * exact status codes and what is NOT recorded is raw HTTP, once, on the desktop project. Each test
 * has its own user, page and client IP.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const isBeacon = (request: Request) =>
  request.method() === "POST" && new URL(request.url()).pathname === "/api/e";

test.describe("M4-21 the beacon in the browser", () => {
  test("M4-21 a published page sends one beacon per load, to its own host, and records one view", async ({
    page,
    context,
  }, info) => {
    const p = await ingestPage("vb");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    const beacons: Request[] = [];
    page.on("request", (request) => {
      if (isBeacon(request)) beacons.push(request);
    });

    const response = await page.goto(p.url);
    // The document itself: static, identical for every visitor, no cookie.
    expect(await response!.headerValue("set-cookie")).toBeNull();
    await expect(page.locator("[data-page-root]")).toBeVisible();
    await expect.poll(() => beacons.length).toBe(1);

    const beacon = beacons[0]!;
    expect(beacon.url()).toBe(`${p.origin}/api/e`);
    expect(JSON.parse(beacon.postData() ?? "")).toEqual({ pageId: p.pageId, referrer: "" });
    const answered = (await beacon.response())!;
    expect(answered.status()).toBe(204);
    expect(await answered.headerValue("cache-control")).toBe("no-store");
    expect(await answered.headerValue("set-cookie")).toBeNull();

    const [row] = await waitForEvents(p.pageId, 1);
    expect(row).toMatchObject({
      page_id: p.pageId,
      block_id: "",
      type: "view",
      referrer: null,
      device: info.project.name === "phone" ? "mobile" : "desktop",
      country: null,
    });
    expect(row!.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.abs(Date.now() - new Date(row!.ts).getTime())).toBeLessThan(60_000);

    // One POST per navigation: a reload is a second load and a second beacon.
    await page.reload();
    await expect.poll(() => beacons.length).toBe(2);
    await waitForEvents(p.pageId, 2);
    expect(await countEvents(p.pageId)).toBe(2);

    // No cookie anywhere, and no banner asking about one.
    expect(await context.cookies()).toEqual([]);
    await expect(page.getByText(/cookie/i)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("M4-21 the referrer is recorded as a lowercased hostname without www, never a path or query", async ({
    page,
    context,
  }) => {
    const p = await ingestPage("vr");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url, { referer: "https://l.instagram.com/?u=x" });
    const [row] = await waitForEvents(p.pageId, 1);
    expect(row!.referrer).toBe("l.instagram.com");

    const q = await ingestPage("vw");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(q.url, { referer: "https://www.Example.COM/some/path?token=secret#frag" });
    const [row2] = await waitForEvents(q.pageId, 1);
    expect(row2!.referrer).toBe("example.com");
  });

  test("M4-21 a page with unpublished draft changes records views against the published page; an unpublished page sends no beacon", async ({
    page,
    context,
  }) => {
    const live = await ingestPage("vd", {
      draft: { ...draftOf("vd", []), blocks: [], profile: { name: "Draft name", bio: "", photo: null } },
    });
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(live.url);
    await expect(page.getByText("Draft name")).toHaveCount(0);
    const [row] = await waitForEvents(live.pageId, 1);
    expect(row!.page_id).toBe(live.pageId);

    // Nothing published: the placeholder shows, and the placeholder is not a page to count.
    const draftOnly = await ingestPage("vu", { published: false });
    const beacons: Request[] = [];
    page.on("request", (request) => {
      if (isBeacon(request)) beacons.push(request);
    });
    await page.goto(draftOnly.url);
    await page.waitForLoadState("load");
    await page.waitForTimeout(800);
    expect(beacons).toHaveLength(0);
    expect(await countEvents(draftOnly.pageId)).toBe(0);
  });

  test("M4-21 the editor preview never reports a view", async ({ page, context }) => {
    const user = await userWithDraft(context, "ev", (handle) =>
      draftOf(handle, [
        { id: IDS.link, type: "link", visible: true, label: "Book", url: "https://example.com/book" },
      ]),
    );
    const beacons: Request[] = [];
    page.on("request", (request) => {
      if (isBeacon(request)) beacons.push(request);
    });
    await openEditor(page);
    await showView(page, "Preview");
    await expect(previewScreen(page).locator(`a[data-block-id="${IDS.link}"]`)).toBeVisible();
    await page.waitForTimeout(1200);
    expect(beacons).toHaveLength(0);
    expect(await countEvents(user.pageId)).toBe(0);
  });

  test("M4-23 a browser that sends the default HeadlessChrome user agent is a bot: its beacon is answered and nothing is recorded", async ({
    browser,
  }, info) => {
    const p = await ingestPage("vh");
    const base = info.project.name === "phone" ? PHONE : DESKTOP;
    const context = await browser.newContext({
      ...base,
      userAgent: HEADLESS_UA,
      extraHTTPHeaders: { "x-forwarded-for": randomIp() },
    });
    const page = await context.newPage();
    const beacons: Request[] = [];
    page.on("request", (request) => {
      if (isBeacon(request)) beacons.push(request);
    });
    await page.goto(p.url);
    await expect.poll(() => beacons.length).toBe(1);
    expect((await beacons[0]!.response())!.status()).toBe(204);
    expect(await settledCount(p.pageId)).toBe(0);
    await context.close();
  });
});

test.describe("M4-21 raw requests: what is recorded and what is ignored", () => {
  test("M4-21 a valid beacon answers 204 and records one row with device, country and a 64-hex visitor hash", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rv");
    const cases: Array<[string, string, string]> = [
      ["iPhone Safari", IPHONE_UA, "mobile"],
      [
        "iPad Safari",
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "tablet",
      ],
      ["desktop Chrome", DESKTOP_UA, "desktop"],
    ];
    for (const [, ua, device] of cases) {
      const res = await postBeacon(
        p,
        { pageId: p.pageId, referrer: "https://l.instagram.com/?u=x" },
        { ua, headers: { "x-vercel-ip-country": "de" } },
      );
      expect(res.status).toBe(204);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.setCookies).toEqual([]);
      expect(res.body).toBe("");
      expect((await eventsOf(p.pageId)).at(-1)).toMatchObject({
        type: "view",
        block_id: "",
        referrer: "l.instagram.com",
        device,
        country: "DE",
      });
    }
    expect(await countEvents(p.pageId)).toBe(3);
    const hashes = (await eventsOf(p.pageId)).map((row) => row.visitor_hash);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(hashes).size).toBe(3);
  });

  test("M4-20 the same visitor (IP and user agent) gets the same hash on one day, another IP or user agent a different one", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rh");
    const ip = randomIp();
    await postBeacon(p, undefined, { ip });
    await postBeacon(p, undefined, { ip });
    await postBeacon(p, undefined, { ip: randomIp() });
    await postBeacon(p, undefined, { ip, ua: IPHONE_UA });
    const hashes = (await eventsOf(p.pageId)).map((row) => row.visitor_hash);
    expect(hashes).toHaveLength(4);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
    expect(hashes[3]).not.toBe(hashes[0]);
  });

  test("M4-21 unknown, malformed, unpublished and wrong-origin beacons get the identical 204 and record nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("ri");
    const unpublished = await ingestPage("rj", { published: false });
    const other = await ingestPage("rk");
    const reference = await postBeacon(p);
    expect(reference.status).toBe(204);
    const baseline = await countEvents(p.pageId);

    const cases: Array<[string, () => ReturnType<typeof postBeacon>]> = [
      ["an unknown page id", () => postBeacon(p, { pageId: "00000000-0000-4000-8000-0000000000ff" })],
      ["a malformed page id", () => postBeacon(p, { pageId: "not-a-uuid" })],
      ["a page id in the wrong type", () => postBeacon(p, { pageId: 5 })],
      ["a body that is not JSON", () => postBeacon(p, "pageId=" + p.pageId)],
      ["an empty body", () => postBeacon(p, "")],
      ["a page with nothing published", () => postBeacon(unpublished, { pageId: unpublished.pageId }, { origin: unpublished.origin })],
      ["another page's origin", () => postBeacon(p, { pageId: p.pageId }, { origin: other.origin })],
      ["a foreign origin", () => postBeacon(p, { pageId: p.pageId }, { origin: "https://evil.example" })],
      ["a missing origin", () => postBeacon(p, { pageId: p.pageId }, { origin: null })],
      ["the origin with a path", () => postBeacon(p, { pageId: p.pageId }, { origin: `${p.origin}/` })],
    ];
    for (const [name, send] of cases) {
      const res = await send();
      expect(res.status, name).toBe(204);
      expect(res.headers["cache-control"], name).toBe(reference.headers["cache-control"]);
      expect(res.setCookies, name).toEqual([]);
      expect(res.body, name).toBe("");
    }
    expect(await countEvents(p.pageId)).toBe(baseline);
    expect(await countEvents(unpublished.pageId)).toBe(0);
    expect(await countEvents(other.pageId)).toBe(0);
  });

  test("M4-21 a body over 2 KB returns 413 and records nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rb");
    const big = JSON.stringify({ pageId: p.pageId, referrer: `https://example.com/${"x".repeat(2200)}` });
    const res = await postBeacon(p, big);
    expect(res.status).toBe(413);
    expect(await settledCount(p.pageId, 300)).toBe(0);
  });

  test("M4-21 a forged beacon (right page id, Origin https://evil.example) records nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rf");
    const res = await postBeacon(p, { pageId: p.pageId, referrer: "https://spam.example" }, { origin: "https://evil.example" });
    expect(res.status).toBe(204);
    expect(await countEvents(p.pageId)).toBe(0);
  });

  test("M4-21 a page's verified custom host may report views; an unverified one may not", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("rc", { plan: "pro" });
    const verified = `links-${rand(6)}.example.test`;
    const pending = `wait-${rand(6)}.example.test`;
    const admin = adminClient();
    const added = await admin.from("domains").insert([
      { page_id: p.pageId, hostname: verified, status: "verified", verified_at: new Date().toISOString() },
    ]);
    expect(added.error?.message).toBeUndefined();
    // Free of the plan's one-domain limit: the second row is another account's page.
    const q = await ingestPage("rd", { plan: "pro" });
    const added2 = await admin.from("domains").insert([{ page_id: q.pageId, hostname: pending, status: "pending" }]);
    expect(added2.error?.message).toBeUndefined();

    // The Origin a browser sends from the custom host (local development serves it over http on the dev port).
    const ok = await postBeacon(p, { pageId: p.pageId }, { origin: `http://${verified}:3000` });
    expect(ok.status).toBe(204);
    expect(await countEvents(p.pageId)).toBe(1);

    const notVerified = await postBeacon(q, { pageId: q.pageId }, { origin: `http://${pending}:3000` });
    expect(notVerified.status).toBe(204);
    expect(await countEvents(q.pageId)).toBe(0);

    // A verified host of ANOTHER page does not unlock this one.
    const crossed = await postBeacon(q, { pageId: q.pageId }, { origin: `http://${verified}:3000` });
    expect(crossed.status).toBe(204);
    expect(await countEvents(q.pageId)).toBe(0);
  });
});

test.describe("M4-23 bots and methods never leave a row", () => {
  test("M4-23 a bot user agent, no user agent, HEAD and GET record nothing", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("bt");
    const bots = [
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Twitterbot/1.0",
      "WhatsApp/2.23.20",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Go-http-client/2.0",
      HEADLESS_UA,
    ];
    for (const ua of bots) {
      const res = await postBeacon(p, undefined, { ua });
      expect(res.status, ua).toBe(204);
    }
    const noUa = await postBeacon(p, undefined, { ua: null });
    expect(noUa.status).toBe(204);
    expect(await countEvents(p.pageId)).toBe(0);

    for (const method of ["HEAD", "GET"]) {
      const res = await postBeacon(p, undefined, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow).toBe("POST");
    }
    expect(await settledCount(p.pageId, 300)).toBe(0);

    // A human on the same page still counts.
    expect((await postBeacon(p)).status).toBe(204);
    expect(await countEvents(p.pageId)).toBe(1);
  });
});

test.describe("M4-20 / M4-21 the events table is closed to the publishable key", () => {
  test("M4-21 direct API: anon and a signed-in user can neither insert into nor read events", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const p = await ingestPage("ra");
    await postBeacon(p);
    expect(await countEvents(p.pageId)).toBe(1);
    const token = await accessTokenFor(p.email);

    for (const bearer of [publishableKey(), token]) {
      const headers = {
        apikey: publishableKey(),
        Authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        Prefer: "return=representation",
      };
      const insert = await fetch(`${supabaseUrl()}/rest/v1/events`, {
        method: "POST",
        headers,
        body: JSON.stringify({ page_id: p.pageId, type: "view", visitor_hash: "h".repeat(64) }),
      });
      expect(insert.status).toBeGreaterThanOrEqual(400);

      const read = await fetch(`${supabaseUrl()}/rest/v1/events?page_id=eq.${p.pageId}`, { headers });
      const body = await read.text();
      if (read.ok) expect(JSON.parse(body)).toEqual([]);
      else expect([401, 403]).toContain(read.status);

      const wipe = await fetch(`${supabaseUrl()}/rest/v1/events?page_id=eq.${p.pageId}`, {
        method: "DELETE",
        headers,
      });
      expect(wipe.status).toBeGreaterThanOrEqual(400);
    }
    expect(await countEvents(p.pageId)).toBe(1);
  });
});

test.describe("M4-21 the public document is static", () => {
  test("M4-21 the page is identical for every visitor and sets no cookie; the beacon is the only per-visit request", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("st");
    const get = (ua: string) =>
      rawRequest(p.host, "/", { headers: { "user-agent": ua, "x-forwarded-for": randomIp() } });
    const [a, b] = [await get(IPHONE_UA), await get(DESKTOP_UA)];
    expect(a.status).toBe(200);
    expect(a.setCookies).toEqual([]);
    expect(b.setCookies).toEqual([]);
    // Dev-mode flight ids vary between renders (see m3-done.spec.ts), so compare what a visitor sees,
    // and the beacon script on its own: it is the same bytes for everyone.
    const visible = (html: string) => html.replace(/<script\b[\s\S]*?<\/script>/g, "");
    expect(visible(a.body)).toBe(visible(b.body));
    const beaconScript = (html: string) => /<script>\(function\(\)\{var id=[\s\S]*?<\/script>/.exec(html)?.[0];
    expect(beaconScript(a.body)).toBeDefined();
    expect(beaconScript(a.body)).toBe(beaconScript(b.body));
    expect(beaconScript(a.body)).toContain(p.pageId);
    // Loading the page recorded nothing: only the beacon does.
    expect(await countEvents(p.pageId)).toBe(0);
  });
});

test.describe("M4-21 layout is untouched by the beacon", () => {
  test("M4-21 the public page has no horizontal scroll with the beacon script in place", async ({ page, context }) => {
    const p = await ingestPage("ls");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await page.goto(p.url);
    await expectNoHorizontalScroll(page);
    expect(await page.locator("script").count()).toBeGreaterThanOrEqual(1);
  });
});
