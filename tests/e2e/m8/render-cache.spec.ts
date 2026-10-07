import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import {
  armFailure,
  bodyOf,
  cacheState,
  customHostOf,
  getCustom,
  getTenant,
  indexQueryCount,
  link,
  liveUser,
  queryCount,
  rawBuffer,
  SERVER_PORT,
} from "./render-helpers";

/**
 * M8-04: the finished page keeps its cache. Production build only (x-nextjs-cache, the query
 * counter and the data cache exist there; `next dev` renders every request):
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm build
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm exec next start -p 3100 &
 *   HL_PROD_PORT=3100 pnpm exec playwright test tests/e2e/m8/render-cache.spec.ts --workers=2
 *
 * Unpublish (M14-02, step 4's "unpublish: page to placeholder" row) is the last test of the first block
 * below: it drives the real editor on the production server, so the Server Action's own
 * invalidation is what is under test. Publish, the plan webhook, suspend, claim and delete keep their own specs (tests/e2e/m2/publish-cache,
 * m4/billing-badge, m5/suspend-cache), which run unchanged against the new routes.
 */

test.skip(!process.env.HL_PROD_PORT, "needs a production build: set HL_PROD_PORT (see the header)");
test.describe.configure({ mode: "serial", timeout: 180_000 });
test.afterAll(cleanupUsers);

test.describe("M8-04 the routes are static and cached", () => {
  test("M8-04 the build lists /t/[handle] and /sites/[pageId] as prerendered routes, never as dynamic", async () => {
    const manifest = JSON.parse(readFileSync(".next/prerender-manifest.json", "utf8")) as {
      dynamicRoutes: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dynamicRoutes)).toEqual(
      expect.arrayContaining(["/t/[handle]", "/sites/[pageId]"]),
    );
    // The test hooks and the OG image are dynamic on purpose.
    expect(Object.keys(manifest.dynamicRoutes)).not.toContain("/t/[handle]/og");
    // No catch-all: a route per invented sub-path would be one stored entry per path (Wave J security review).
    expect(Object.keys(manifest.dynamicRoutes).filter((route) => route.includes("[..."))).toEqual(
      [],
    );
  });

  test("M8-04 two GETs: the first is a MISS, the second a HIT, byte-identical, with s-maxage, and the public query ran once", async ({
    context,
  }) => {
    const user = await liveUser(context, "cc1");
    const first = await getTenant(user.handle);
    const second = await getTenant(user.handle);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(cacheState(first)).toBe("MISS");
    expect(cacheState(second)).toBe("HIT");
    expect(second.text).toBe(first.text);
    expect(String(second.headers["cache-control"])).toMatch(/s-maxage=\d+/);
    expect(await queryCount(user.handle)).toBe(1);
  });

  test("M8-04 a verified custom host, HEAD and ten requests that differ only in their query string all keep one read", async ({
    context,
  }) => {
    const user = await liveUser(context, "cc2", { plan: "studio" });
    const host = await customHostOf(user.pageId);
    const first = await getTenant(user.handle);
    expect(cacheState(first)).toBe("MISS");
    const custom = await getCustom(host);
    expect(custom.status).toBe(200);
    expect(cacheState(custom)).toMatch(/MISS|HIT/);
    expect(bodyOf(custom.text)).toBe(bodyOf(first.text));
    expect(cacheState(await getCustom(host))).toBe("HIT");

    const head = await rawBuffer(`${user.handle}.localhost:${SERVER_PORT}`, "/", {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(cacheState(head)).toBe("HIT");

    for (let i = 0; i < 10; i++) {
      const query = i % 2 === 0 ? `/?utm_source=${rand(4)}` : `/?x=${rand(12)}&y=${i}`;
      const res = await getTenant(user.handle, query);
      expect(cacheState(res), query).toBe("HIT");
      expect(res.text, query).toBe(first.text);
    }
    // One read for the page, however it was asked for.
    expect(await queryCount(user.handle)).toBe(1);
  });

  test("M8-04 unpublish: the page becomes the placeholder (handle host) and the 404 (custom host) on the very next request, with nothing of the page left, and Publish brings it back", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "drives the More actions menu, which a phone does not draw");
    const marker = `Bio of ${rand(6)}`;
    const user = await liveUser(context, "cc7", { plan: "studio", bio: marker });
    const host = await customHostOf(user.pageId);
    const APP = `http://app.localhost:${SERVER_PORT}`;
    const placeholder = "Nothing published here yet.";
    const hasPage = (text: string) => text.includes(marker) || text.includes("Book now");

    // Warm both hosts: a HIT on each, the page in the body, one read of the database.
    await getTenant(user.handle);
    await getCustom(host);
    const warmHandle = await getTenant(user.handle);
    const warmCustom = await getCustom(host);
    expect([cacheState(warmHandle), cacheState(warmCustom)]).toEqual(["HIT", "HIT"]);
    expect(hasPage(warmHandle.text)).toBe(true);
    expect(hasPage(warmCustom.text)).toBe(true);
    const warmCount = await queryCount(user.handle);
    expect(warmCount).toBe(1);

    // Unpublish through the editor. The share preview's OG image would be a second reader of the
    // cache entry (see publish-cache.spec.ts), so the browser is kept off it.
    await page.route(/\/og\?v=/, (route) => route.abort());
    await page.goto(`${APP}/editor`);
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Unpublish" }).click();
    await page.getByTestId("unpublish-confirm").click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "not-published",
      { timeout: 30_000 },
    );

    // The very next request, no waiting: the placeholder on the handle host, the 404 on the custom
    // host (what the routing gives an unpublished site), nothing of the page in either body.
    const handleNow = await getTenant(user.handle);
    expect(handleNow.status).toBe(200);
    expect(handleNow.text).toContain(placeholder);
    expect(hasPage(handleNow.text)).toBe(false);
    expect(handleNow.text).not.toContain("Zq cc7");
    const customNow = await getCustom(host);
    expect(customNow.status).toBe(404);
    expect(hasPage(customNow.text)).toBe(false);
    expect(customNow.text).not.toContain("Zq cc7");
    // The entry was regenerated from the database, and only once for the two hosts together.
    const afterCount = await queryCount(user.handle);
    expect(afterCount).toBeGreaterThan(warmCount);
    expect(afterCount).toBeLessThanOrEqual(warmCount + 2);

    // And it is cached again: a second round reads nothing.
    expect(await getTenant(user.handle).then((res) => res.text)).toContain(placeholder);
    expect((await getCustom(host)).status).toBe(404);
    expect(await queryCount(user.handle)).toBe(afterCount);

    // Publish again: the page is back at once on both hosts.
    await page
      .getByRole("button", { name: /^Publish/ })
      .first()
      .click();
    await expect(page.locator("[data-publish-status]")).toHaveAttribute(
      "data-publish-status",
      "published",
      { timeout: 30_000 },
    );
    const backHandle = await getTenant(user.handle);
    expect(backHandle.status).toBe(200);
    expect(backHandle.text).not.toContain(placeholder);
    expect(hasPage(backHandle.text)).toBe(true);
    const backCustom = await getCustom(host);
    expect(backCustom.status).toBe(200);
    expect(hasPage(backCustom.text)).toBe(true);
  });

  test("M8-04 one document for every visitor: user agent, language, Authorization, cookie and address change nothing, and the counter stays at one", async ({
    context,
  }) => {
    const user = await liveUser(context, "cc3");
    const plain = await getTenant(user.handle);
    const variants: Array<Record<string, string>> = [
      { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
      { "accept-language": "ja-JP,ja;q=0.9" },
      { authorization: "Bearer not-a-real-token" },
      { cookie: "sb-localhost-auth-token=%7B%22access_token%22%3A%22x%22%7D" },
      { "x-forwarded-for": "198.51.100.23" },
    ];
    for (const headers of variants) {
      const res = await getTenant(user.handle, "/", headers);
      expect(res.text, JSON.stringify(headers)).toBe(plain.text);
      expect(cacheState(res), JSON.stringify(headers)).toBe("HIT");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(String(res.headers.vary ?? "").toLowerCase()).not.toMatch(
        /cookie|user-agent|accept-language|authorization/,
      );
      expect(res.headers["content-security-policy"]).toBe(plain.headers["content-security-policy"]);
    }
    expect(await queryCount(user.handle)).toBe(1);
  });

  test("M8-04 a POST never gets the cached page: the proxy answers 405 before the cache", async ({
    context,
  }) => {
    const user = await liveUser(context, "cc4");
    expect(cacheState(await getTenant(user.handle))).toBe("MISS");
    const post = await rawBuffer(`${user.handle}.localhost:${SERVER_PORT}`, "/", {
      method: "POST",
    });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    expect(post.text).not.toContain("data-page-root");
    expect(await queryCount(user.handle)).toBe(1);
  });
});

test.describe("M8-04 failures are not cached and not mistaken for a 404", () => {
  test("M8-04 a failed read is the 500 panel with no-store; the request after it regenerates the page, and only the retry counts", async ({
    context,
  }) => {
    const user = await liveUser(context, "cf1");
    expect(await armFailure(user.handle), "start the server with HYDLNK_QUERY_COUNTER=1").toBe(
      true,
    );
    const failed = await getTenant(user.handle);
    expect(failed.status).toBe(500);
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(failed.text).toContain("Something went wrong. Try again.");
    expect(failed.text).toMatch(/Reference: [a-z0-9]{8}/);
    expect(failed.text).not.toContain(user.draft.profile.name);

    // The failure left no entry: the next request reads the database again and serves the page. The entry is
    // expired from after(), a few milliseconds after the response is sent, so wait out that window (a visitor
    // tapping Retry is never that fast; a test on loopback is).
    await new Promise((resolve) => setTimeout(resolve, 200));
    const retry = await getTenant(user.handle);
    expect(retry.status).toBe(200);
    expect(cacheState(retry)).toBe("MISS");
    expect(retry.text).toContain(user.draft.profile.name);
    expect(await queryCount(user.handle)).toBe(1);
    // And now it is cached like any other.
    const after = await getTenant(user.handle);
    expect(cacheState(after)).toBe("HIT");
    expect(await queryCount(user.handle)).toBe(1);
  });

  test("M8-04 a cached page does not read the database, so an armed failure never reaches it", async ({
    context,
  }) => {
    const user = await liveUser(context, "cf2");
    await getTenant(user.handle);
    expect(cacheState(await getTenant(user.handle))).toBe("HIT");
    expect(await armFailure(user.handle)).toBe(true);
    for (let i = 0; i < 3; i++) {
      const res = await getTenant(user.handle);
      expect(res.status).toBe(200);
      expect(cacheState(res)).toBe("HIT");
    }
    // Disarm first: the counter route looks the handle up too, and an armed failure would hit it.
    await armFailure(user.handle, false);
    expect(await queryCount(user.handle)).toBe(1);
  });
});

test.describe("M8-04 abuse and cost", () => {
  test("M8-04 the 404 of an invented handle is cached for seconds, not stored for good: one entry, no document read", async ({
    context,
  }) => {
    const real = await liveUser(context, "ca1");
    await getTenant(real.handle);
    const before = await queryCount(real.handle);
    const invented = `zq-nobody-${rand(8)}`;
    const first = await getTenant(invented);
    expect(first.status).toBe(404);
    expect(cacheState(first)).toBe("MISS");
    expect(String(first.headers["cache-control"])).toMatch(/s-maxage=5\b/);
    for (let i = 0; i < 5; i++) {
      const res = await getTenant(invented);
      expect(res.status).toBe(404);
      expect(cacheState(res)).toBe("HIT");
    }
    expect(await queryCount(real.handle)).toBe(before);
  });

  test("M8-04 200 requests to 200 invented handles each answer the 404 and the process stays healthy", async ({
    context,
  }) => {
    const real = await liveUser(context, "ca2");
    await getTenant(real.handle);
    const before = await queryCount(real.handle);
    const handles = Array.from({ length: 200 }, () => `zq-inv-${rand(10)}`);
    const results: number[] = [];
    for (let i = 0; i < handles.length; i += 20) {
      const batch = await Promise.all(handles.slice(i, i + 20).map((handle) => getTenant(handle)));
      for (const res of batch) {
        results.push(res.status);
        expect(res.text).toContain("This address isn’t claimed.");
      }
    }
    expect(results.every((status) => status === 404)).toBe(true);
    // Healthy: the real page still answers from its cache and its counter did not move.
    const res = await getTenant(real.handle);
    expect(res.status).toBe(200);
    expect(cacheState(res)).toBe("HIT");
    expect(await queryCount(real.handle)).toBe(before);
  });

  test("M8-04 sub-paths are plain 404s that read nothing: /anything and /a/b/c on a real page's host", async ({
    context,
  }) => {
    const user = await liveUser(context, "ca3", { blocks: [link("lnk-ca3-0001", "Book now")] });
    await getTenant(user.handle);
    const before = await queryCount(user.handle);
    for (const path of ["/anything", "/a/b/c", "/login", "/editor"]) {
      const res = await getTenant(user.handle, path);
      expect(res.status, path).toBe(404);
      expect(res.text, path).toContain("Page not found");
      expect(res.text, path).not.toContain(user.draft.profile.name);
    }
    expect(await queryCount(user.handle)).toBe(before);
  });

  // M11-06 step 2: a single valid lowercase segment on a live site goes to the force-dynamic sub-page route
  // (a 404 after one cached index read, nothing stored, so no cache HIT); the rest still share /sites/unknown.
  test("M8-04 invented sub-paths store nothing: single segments read the site index once in total, the rest share one cached 404", async ({
    context,
  }) => {
    const user = await liveUser(context, "ca4", { plan: "studio" });
    const host = await customHostOf(user.pageId, "subp");
    expect(cacheState(await getTenant(user.handle))).toBe("MISS");
    const pageReads = await queryCount(user.handle);
    expect(pageReads).toBe(1);
    const tokens: string[] = [];
    const expect404 = (res: Awaited<ReturnType<typeof getTenant>>, path: string) => {
      expect(res.status, path).toBe(404);
      expect(res.text, path).toContain("Page not found");
      expect(res.text, path).not.toContain(user.draft.profile.name);
    };
    // Single lowercase segments on the handle host and the custom host: dynamic route, no cache state.
    for (let i = 0; i < 30; i++) {
      const token = rand(10).toLowerCase();
      tokens.push(token);
      expect404(await getTenant(user.handle, `/${token}`), `handle /${token}`);
      expect404(await getCustom(host, `/${token}`), `custom /${token}`);
    }
    // The index is cached under the page tag: dozens of invented paths add no read per path. Home's
    // render may have read it once; nothing after that.
    expect(await queryCount(user.handle), "the page read").toBe(pageReads);
    expect(await indexQueryCount(user.handle), "the site index read").toBeLessThanOrEqual(1);

    // Two segments, another handle's host and a host nobody owns still land on the one shared cached 404.
    const states: string[] = [];
    for (let i = 0; i < 30; i++) {
      const token = rand(10).toLowerCase();
      tokens.push(token);
      const path = `/${token}/${rand(6).toLowerCase()}${i % 5 === 0 ? `?q=${rand(6)}` : ""}`;
      for (const [label, res] of [
        ["handle", await getTenant(user.handle, path)],
        ["custom", await getCustom(host, path)],
      ] as const) {
        expect404(res, `${label} ${path}`);
        states.push(cacheState(res));
      }
    }
    const lastToken = rand(8).toLowerCase();
    tokens.push(lastToken);
    expect404(await getTenant(`zq-sub-${rand(8)}`, `/${lastToken}`), "invented handle");
    states.push(cacheState(await getTenant(`zq-sub-${rand(8)}`, `/${lastToken}`)));
    const unknownHost = await getCustom(`nobody-${rand(8)}.example.test`, `/${rand(8)}`);
    expect404(unknownHost, "unknown host");
    states.push(cacheState(unknownHost));
    expect(states.filter((state) => state === "MISS").length, states.join(",")).toBeLessThanOrEqual(
      1,
    );
    expect(states.filter((state) => state === "HIT").length).toBeGreaterThanOrEqual(
      states.length - 1,
    );

    // The page itself was read once and is still a HIT; the index count did not move either.
    expect(cacheState(await getTenant(user.handle))).toBe("HIT");
    expect(await queryCount(user.handle)).toBe(pageReads);
    expect(await indexQueryCount(user.handle)).toBeLessThanOrEqual(1);

    // On disk, where `next start` keeps what it stores: the shared 404 is there, and no entry is named
    // after any of the invented paths (the entries are written a moment after the response).
    const store = ".next/server/route-cache/APP_ROUTE";
    expect(existsSync(store), "run against the production build in this checkout").toBe(true);
    await expect
      .poll(() =>
        (readdirSync(store, { recursive: true }) as string[]).some((file) =>
          file.endsWith("sites/unknown.body"),
        ),
      )
      .toBe(true);
    const stored = (readdirSync(store, { recursive: true }) as string[]).join("\n");
    for (const token of tokens)
      expect(stored, `an entry was stored for /${token}`).not.toContain(token);
  });
});
