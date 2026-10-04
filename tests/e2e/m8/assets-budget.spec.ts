import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DESKTOP, PHONE } from "../../../scripts/lib/viewports";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { SERVER_PORT } from "../m2/publish-helpers";
import { classify, record, type Entry } from "./assets-network";
import { seedFullPage, type Seeded } from "./assets-seed";

/**
 * M8-09: a first visit to a full page makes at most 6 requests to its own host, under 90 KB, and
 * none to a third party. Production build only (the numbers of `next dev` are not the product's):
 *
 *   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3100 HYDLNK_QUERY_COUNTER=1 pnpm build
 *   pnpm exec next start -p 3100 &
 *   HL_PROD_PORT=3100 pnpm exec playwright test tests/e2e/m8/assets-budget.spec.ts --workers=2
 *
 * One Chromium CDP session with Network.enable per run, a fresh browser context per visit, and the
 * fixture page of the spec: a profile photo, a name and a bio; a header; three links (one with a
 * built-in icon); a text block with bold, italic and a link; four social icons; a card with an image;
 * a YouTube and a Spotify embed; a divider; the Free badge and the report link; a Fraunces 700
 * heading over an Inter body.
 */

test.skip(!process.env.HL_PROD_PORT, "needs a production build: set HL_PROD_PORT (see the header)");

const PORT = SERVER_PORT;
const KB = 1024;

/**
 * Until `pnpm tenant-fonts` has vendored the font files (src/lib/tenant-assets/font-manifest.json is a
 * "pending" stub), a page has no font to request. The two-font lines of this spec wait for the files;
 * everything else is asserted today, and tests/unit/m8-assets-fonts.test.ts stays red until then.
 */
const FONTS_VENDORED = !String(
  (JSON.parse(readFileSync("src/lib/tenant-assets/font-manifest.json", "utf8")) as { source: string })
    .source,
).startsWith("pending");

/**
 * The bytes the document costs on the wire. `next start` does not compress a route handler's document
 * behind the proxy (its stylesheet and script files are compressed; the Vercel edge compresses every
 * text response), so where the server sent no content-encoding this is what the edge sends: the
 * gzip of the body plus the headers the server did send. Where the server compressed, it is what the
 * browser measured.
 */
async function documentWireBytes(page: Page, entry: Entry): Promise<number> {
  if (entry.headers["content-encoding"]) return entry.bytes;
  const body = await (await page.request.get(entry.url)).body();
  return gzipSync(body).length + Math.max(0, entry.bytes - body.length);
}

const seeded: Record<"free" | "pro", Promise<Seeded>> = {} as never;

test.beforeAll(() => {
  seeded.free = seedFullPage("free");
  seeded.pro = seedFullPage("pro");
});

test.afterAll(cleanupUsers);

async function firstVisit(browser: Browser, device: typeof PHONE | typeof DESKTOP, target: Seeded) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __csp: string[] };
    w.__cls = 0;
    w.__csp = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    document.addEventListener("securitypolicyviolation", (event) =>
      w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  const recorder = await record(context, page);
  await page.goto(target.url);
  await recorder.settle();
  return { context, page, recorder };
}

for (const plan of ["free", "pro"] as const) {
  test(`M8-09 a first visit to a full ${plan} page: at most 6 requests, 90 KB and no third party`, async ({
    browser,
  }, info) => {
    const target = await seeded[plan];
    const device = info.project.name === "phone" ? PHONE : DESKTOP;
    const own = `${target.handle}.localhost:${PORT}`;
    const { context, page, recorder } = await firstVisit(browser, device, target);
    const entries = recorder.entries();
    const seen = classify(entries, own);
    const listing = seen.counted
      .map(
        (entry) => `${entry.method} ${new URL(entry.url).pathname} ${entry.type} ${entry.bytes}B`,
      )
      .join("\n");

    // The shape: 1 document, at most 2 woff2 files, 1 script, 1 POST /api/e.
    expect(seen.documents, listing).toHaveLength(1);
    expect(seen.fonts.length, listing).toBeLessThanOrEqual(2);
    expect(seen.fonts.length, `Fraunces latin and Inter latin\n${listing}`).toBe(
      FONTS_VENDORED ? 2 : 0,
    );
    expect(seen.scripts, listing).toHaveLength(1);
    expect(seen.beacons, listing).toHaveLength(1);
    expect(seen.counted.length, listing).toBeLessThanOrEqual(6);
    expect(seen.counted.length, `exactly the four kinds\n${listing}`).toBe(
      seen.documents.length + seen.fonts.length + seen.scripts.length + seen.beacons.length,
    );

    // Bytes over the wire, headers included.
    const documentBytes = await documentWireBytes(page, seen.documents[0]!);
    const total =
      seen.counted.reduce((sum, entry) => sum + entry.bytes, 0) -
      seen.documents[0]!.bytes +
      documentBytes;
    info.annotations.push({
      type: "bytes",
      description: `${plan} ${info.project.name}: ${total} B to the page's own host (document ${documentBytes}, script ${seen.scripts[0]!.bytes}, beacon ${seen.beacons[0]!.bytes}, fonts ${seen.fonts.reduce((sum, entry) => sum + entry.bytes, 0)})`,
    });
    expect(total, listing).toBeLessThanOrEqual(92_160);
    expect(documentBytes, "the document").toBeLessThanOrEqual(16 * KB);
    expect(seen.scripts[0]!.bytes, "the script").toBeLessThanOrEqual(3 * KB);
    expect(
      seen.fonts.reduce((sum, entry) => sum + entry.bytes, 0),
      "the fonts",
    ).toBeLessThanOrEqual(64 * KB);

    // Nothing from a third party, no framework.
    expect(seen.thirdParty.map((entry) => entry.url)).toEqual([]);
    expect(
      entries.filter((entry) => /^\/_next\/.*\.(?:js|css)$/.test(new URL(entry.url).pathname)),
    ).toEqual([]);
    const dom = await page.evaluate(() => ({
      scripts: document.scripts.length,
      inline: [...document.scripts].filter((script) => !script.src).length,
      stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
      next: [
        typeof (window as never as { __next_f?: unknown }).__next_f,
        typeof (window as never as { next?: unknown }).next,
      ],
      cls: (window as unknown as { __cls: number }).__cls,
      csp: (window as unknown as { __csp: string[] }).__csp,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(dom.scripts).toBe(1);
    expect(dom.inline).toBe(0);
    expect(dom.stylesheets).toBe(0);
    expect(dom.next).toEqual(["undefined", "undefined"]);

    // The quality of that load.
    expect(recorder.visit.console).toEqual([]);
    expect(recorder.visit.pageErrors).toEqual([]);
    expect(dom.csp).toEqual([]);
    expect(dom.cls).toBeLessThanOrEqual(0.05);
    expect(dom.scrollWidth).toBeLessThanOrEqual(dom.innerWidth);
    if (info.project.name === "phone") await expectTapTargets(page, "[data-page-root]");
    else {
      const column = await page.locator(".pg-column").boundingBox();
      expect(column!.width).toBeLessThanOrEqual(480.5);
    }
    await expectNoHorizontalScroll(page);
    // The images come from the root /media origin, once each, and nothing else leaves the host.
    const images = seen.media.map((entry) => new URL(entry.url).pathname);
    expect(new Set(images).size).toBe(images.length);
    expect(images.length).toBeGreaterThanOrEqual(2);

    // The document has the badge on a Free page and not on a Pro page.
    expect(await page.getByText("Made with HYDLNK").count()).toBe(plan === "free" ? 1 : 0);
    await context.close();
  });
}

test("M8-09 a reload makes at most the document and the beacon: no font and no script request", async ({
  browser,
}, info) => {
  const target = await seeded.free;
  const device = info.project.name === "phone" ? PHONE : DESKTOP;
  const own = `${target.handle}.localhost:${PORT}`;
  const { context, page, recorder } = await firstVisit(browser, device, target);
  const before = recorder.entries().length;
  await page.reload();
  await recorder.settle();
  // A font or script the HTTP cache answers is not a request to the network.
  const second = recorder
    .entries()
    .slice(before)
    .filter((entry) => !entry.fromCache);
  const seen = classify(second, own);
  expect(seen.counted.length, JSON.stringify(seen.counted.map((e) => e.url))).toBeLessThanOrEqual(
    2,
  );
  expect(seen.fonts).toEqual([]);
  expect(seen.scripts).toEqual([]);
  expect(seen.beacons).toHaveLength(1);
  await context.close();
});

test("M8-09 tapping the YouTube and Spotify posters adds two iframe requests and nothing on the page's host", async ({
  browser,
}, info) => {
  const target = await seeded.free;
  const device = info.project.name === "phone" ? PHONE : DESKTOP;
  const own = `${target.handle}.localhost:${PORT}`;
  const { context, page, recorder } = await firstVisit(browser, device, target);
  // The two players are the first third-party requests: made because the visitor asked.
  await page.route(/youtube-nocookie\.com|open\.spotify\.com/, (route) => route.abort());
  const before = recorder.entries().length;
  await page.locator("button.pg-embed-play").nth(0).click();
  await page.locator("button.pg-embed-play").nth(0).click();
  await expect(page.locator("iframe")).toHaveCount(2);
  await recorder.settle();
  const added = recorder.entries().slice(before);
  const hosts = added.map((entry) => new URL(entry.url).host);
  expect(hosts.filter((host) => host === own)).toEqual([]);
  expect(hosts.sort()).toEqual(["open.spotify.com", "www.youtube-nocookie.com"]);
  expect(
    await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []),
  ).toEqual([]);
  await context.close();
});

test("M8-09 a tap on a link follows /r/{pageId}/{blockId} with a 302 to its destination", async ({
  browser,
}, info) => {
  const target = await seeded.free;
  const device = info.project.name === "phone" ? PHONE : DESKTOP;
  const { context, page } = await firstVisit(browser, device, target);
  const href = await page.locator(`[data-block-id="${target.linkBlockId}"]`).getAttribute("href");
  expect(href).toBe(`/r/${target.pageId}/${target.linkBlockId}`);
  const response = await page.request.get(new URL(href!, target.url).toString(), {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toMatch(/^https:\/\/example\.com\//);
  await context.close();
});
