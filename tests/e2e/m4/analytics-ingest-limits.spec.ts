import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  DESKTOP_UA,
  IDS,
  TARGETS,
  countEvents,
  eventsOf,
  expect,
  getClick,
  ingestPage,
  postBeacon,
  randomIp,
  randomIpv6,
  settledCount,
  test,
  waitForEvents,
  type IngestPage,
} from "./analytics-ingest-helpers";
import type { RawResponse } from "../fixtures/http";

/**
 * M5-01 (per-IP limit on the view beacon /api/e) and M5-02 (per-IP limit on the click redirect /r).
 *
 * The limiter is one sliding window in Postgres (rateLimit() in src/lib/rate-limit). Every test
 * picks its own random client IP and makes its own page, so nothing here depends on a quiet minute
 * and nothing touches mara. The counter store failing open is proven in Vitest (a throwing store);
 * a request with no client-IP header cannot be sent through `next dev`, which adds the socket
 * address itself, so the shared 'unknown' bucket is proven at the handler (Vitest) level.
 */

test.describe.configure({ timeout: 240_000 });
test.afterAll(cleanupUsers);

/** Sends `n` requests, a few at a time (the database serialises them per bucket, so the count is exact). */
async function burst<T>(n: number, send: (index: number) => Promise<T>, width = 8): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < n; start += width) {
    const batch = Array.from({ length: Math.min(width, n - start) }, (_, i) => send(start + i));
    results.push(...(await Promise.all(batch)));
  }
  return results;
}

const statuses = (responses: RawResponse[]) => responses.map((r) => r.status);

test.describe("M5-01 the view beacon limit", () => {
  test("M5-01 120 beacons a minute per IP: 1-120 answer 204, the 121st answers 429 with Retry-After and records nothing, another IP still answers 204", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("lb");
    const ip = randomIp();
    const other = randomIp();

    const first = await burst(120, () => postBeacon(p, undefined, { ip }));
    expect(statuses(first).every((status) => status === 204), statuses(first).join(",")).toBe(true);
    expect(await countEvents(p.pageId)).toBe(120);

    const blocked = await postBeacon(p, undefined, { ip });
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.setCookies).toEqual([]);
    expect(await countEvents(p.pageId)).toBe(120);

    const free = await postBeacon(p, undefined, { ip: other });
    expect(free.status).toBe(204);
    expect(await countEvents(p.pageId)).toBe(121);
  });

  test("M5-01 every request counts: malformed bodies, bots, HEAD and GET use up the same 120", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("lc");
    const ip = randomIp();
    const mixed = await burst(120, (i) => {
      switch (i % 4) {
        case 0:
          return postBeacon(p, "{{ not json", { ip });
        case 1:
          return postBeacon(p, undefined, { ip, ua: "Googlebot/2.1" });
        case 2:
          return postBeacon(p, undefined, { ip, method: "HEAD" });
        default:
          return postBeacon(p, undefined, { ip, method: "GET" });
      }
    });
    expect(new Set(statuses(mixed))).toEqual(new Set([204, 405]));
    expect(await countEvents(p.pageId)).toBe(0);
    // The 121st request, a perfectly good beacon, is over the limit: the earlier ones counted.
    const blocked = await postBeacon(p, undefined, { ip });
    expect(blocked.status).toBe(429);
    expect(await countEvents(p.pageId)).toBe(0);
  });

  test("M5-01 the key is the client IP, not anything in the body; an IPv6 address shares its /64 with its neighbours", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("ld");
    const ip = randomIpv6();
    const neighbour = ip.replace(/::[0-9a-f]+$/, "::beef");
    const stranger = randomIpv6();
    await burst(120, () => postBeacon(p, undefined, { ip }));
    // Another address in the same /64 is the same client...
    expect((await postBeacon(p, undefined, { ip: neighbour })).status).toBe(429);
    // ...a body that claims to be someone else changes nothing...
    expect(
      (await postBeacon(p, { pageId: p.pageId, ip: stranger, key: stranger, "x-forwarded-for": stranger }, { ip })).status,
    ).toBe(429);
    // ...and a different network is unaffected.
    expect((await postBeacon(p, undefined, { ip: stranger })).status).toBe(204);
  });

  test("M5-01 direct API: the counter table and its function are closed to anon and signed-in users", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const p = await ingestPage("la");
    const token = await accessTokenFor(p.email);
    const bucket = "a".repeat(64);
    for (const bearer of [publishableKey(), token]) {
      const headers = {
        apikey: publishableKey(),
        Authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      };
      const call = await fetch(`${supabaseUrl()}/rest/v1/rpc/rate_limit_hit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_bucket: bucket, p_limit: 1, p_window_seconds: 60 }),
      });
      expect(call.status).toBeGreaterThanOrEqual(400);
      const read = await fetch(`${supabaseUrl()}/rest/v1/rate_limit_hits`, { headers });
      expect(read.status).toBeGreaterThanOrEqual(400);
      const write = await fetch(`${supabaseUrl()}/rest/v1/rate_limit_hits`, {
        method: "POST",
        headers,
        body: JSON.stringify({ bucket }),
      });
      expect(write.status).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe("M5-02 the click redirect limit", () => {
  async function twoLinks(label: string): Promise<{ p: IngestPage; ip: string }> {
    return { p: await ingestPage(label), ip: randomIp() };
  }

  test("M5-02 60 clicks a minute per IP across all blocks: 1-60 answer 302 with a click row each, the 61st answers 429 with no Location and no row, another IP gets a 302", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const { p, ip } = await twoLinks("kc");

    // 30 clicks on one block and 30 on another: rotating block ids does not dodge the limit.
    const first = await burst(60, (i) =>
      getClick(p, i < 30 ? IDS.link : IDS.card, { ip, ua: DESKTOP_UA }),
    );
    for (const [i, res] of first.entries()) {
      expect(res.status, `request ${i + 1}`).toBe(302);
      expect(res.location).toBe(TARGETS[i < 30 ? IDS.link : IDS.card]);
    }
    await waitForEvents(p.pageId, 60);

    const blocked = await getClick(p, IDS.cellA, { ip, ua: DESKTOP_UA });
    expect(blocked.status).toBe(429);
    expect(blocked.location).toBeNull();
    const retryAfter = Number(blocked.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.body).toContain("Too many clicks from your network. Try again in a minute.");
    expect(await settledCount(p.pageId)).toBe(60);

    const rows = await eventsOf(p.pageId);
    expect(rows.filter((row) => row.block_id === IDS.link)).toHaveLength(30);
    expect(rows.filter((row) => row.block_id === IDS.card)).toHaveLength(30);

    const free = await getClick(p, IDS.link, { ip: randomIp(), ua: DESKTOP_UA });
    expect(free.status).toBe(302);
    expect(free.location).toBe(TARGETS[IDS.link]);
  });

  test("M5-02 the limit is per IP across pages too, a blocked ?to= still never redirects, and bots and HEAD count", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const a = await ingestPage("kd");
    const b = await ingestPage("ke");
    const ip = randomIp();
    // 20 to page A, 20 to page B, 10 bot GETs and 10 HEADs to A: 60 requests from one address.
    await burst(60, (i) => {
      if (i < 20) return getClick(a, IDS.link, { ip });
      if (i < 40) return getClick(b, IDS.link, { ip });
      if (i < 50) return getClick(a, IDS.link, { ip, ua: "Slackbot-LinkExpanding 1.0" });
      return getClick(a, IDS.link, { ip, method: "HEAD" });
    });
    const blocked = await getClick(a, IDS.link, { ip, query: "?to=https://evil.example" });
    expect(blocked.status).toBe(429);
    expect(blocked.location).toBeNull();
    const blockedHead = await getClick(b, IDS.link, { ip, method: "HEAD" });
    expect(blockedHead.status).toBe(429);
    expect(blockedHead.body).toBe("");
    const safe = await getClick(a, IDS.link, { ip: randomIp(), query: "?to=https://evil.example" });
    expect(safe.status).toBe(302);
    expect(safe.location).toBe(TARGETS[IDS.link]);
  });

  test("M5-02 probing unknown page ids is limited too: they count, and once over the limit even a real page and block get the 429, not a 302 or a 404", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("kf");
    const ip = randomIp();
    const unknown = "00000000-0000-4000-8000-0000000000dd";
    const first = await burst(60, () => getClick(p, IDS.link, { ip, pageId: unknown }));
    expect(new Set(statuses(first))).toEqual(new Set([404]));
    // Over the limit, even a real page and block get the 429, not a 302.
    const blocked = await getClick(p, IDS.link, { ip });
    expect(blocked.status).toBe(429);
    expect(await settledCount(p.pageId)).toBe(0);
  });
});

test.describe("M5-02 the 429 page", () => {
  async function limitedClient(label: string) {
    const p = await ingestPage(label);
    const ip = randomIp();
    // Fill the window with requests that leave no click row (a bot user agent).
    await burst(60, () => getClick(p, IDS.link, { ip, ua: "curl/8.4.0" }));
    return { p, ip };
  }

  test("M5-02 the 429 page says 'Too many clicks from your network. Try again in a minute.', has no horizontal scroll and 44px targets, and is not a tenant page", async ({
    page,
    context,
  }, info) => {
    const { p, ip } = await limitedClient("kp");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    const response = await page.goto(`${p.url}r/${p.pageId}/${IDS.link}`);
    expect(response!.status()).toBe(429);
    expect(response!.headers()["retry-after"]).toMatch(/^\d+$/);
    expect(response!.headers()["location"]).toBeUndefined();
    await expect(
      page.getByText("Too many clicks from your network. Try again in a minute.", { exact: true }),
    ).toBeVisible();

    const phone = info.project.name === "phone";
    if (phone) {
      expect(await page.evaluate(() => window.innerWidth)).toBe(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const link = page.getByRole("link", { name: "Go to hydlnk.com" });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // HYDLNK UI tokens, never tenant tokens.
    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        page: root.getPropertyValue("--hl-page").trim(),
        ink: root.getPropertyValue("--hl-ink").trim(),
        tenantBg: root.getPropertyValue("--t-bg").trim(),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        pageRoot: document.querySelector("[data-page-root]") !== null,
      };
    });
    expect(tokens).toMatchObject({ page: "#f4f3f0", ink: "#1c1b1a", tenantBg: "", pageRoot: false });
    expect(tokens.bodyBackground).toBe("rgb(244, 243, 240)");

    if (!phone) {
      // Centered in the 1440x900 window.
      const box = (await page.locator("main").boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThanOrEqual(40);
      expect(box.width).toBeLessThanOrEqual(480);
    }
  });
});

test.describe("M5-01 / M5-02 the limit never takes a page view or a click away from a visitor under the limit", () => {
  test("M5-02 a visitor under the limit is unaffected by another IP being blocked", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const p = await ingestPage("kg");
    const noisy = randomIp();
    await burst(61, () => getClick(p, IDS.link, { ip: noisy, ua: "curl/8.4.0" }));
    expect((await getClick(p, IDS.link, { ip: noisy })).status).toBe(429);
    const calm = await getClick(p, IDS.link, { ip: randomIp() });
    expect(calm.status).toBe(302);
    // And the admin client can still read that page's events: the limiter keeps no state in `events`.
    const admin = adminClient();
    const { error } = await admin.from("events").select("id").eq("page_id", p.pageId);
    expect(error).toBeNull();
  });
});
