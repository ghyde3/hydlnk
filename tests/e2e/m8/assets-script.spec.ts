import { expect, test, type Page } from "@playwright/test";
import { url as devUrl } from "../helpers";
import {
  EMBEDS,
  FIXTURE_PAGE_ID,
  embedsPageHtml,
  serveFixture,
  watchErrors,
  type Watched,
} from "./assets-fixture";

/**
 * M8-05 and M8-06 in real Chrome, at 390x844 and 1440x900: the one tenant script on a page the
 * test serves itself (so it runs with or without the live HTML builder): nothing before a tap, one
 * iframe per tap with the heights of EMBED_HEIGHTS, Twitch's parent, the tampered-DOM walls, and the
 * view beacon's contract. The same script is run against the real live page by the specs of the
 * render work (tests/e2e/m6/embeds-tenant.spec.ts).
 */

const HOST = devUrl("mara");
const FIXTURE_URL = `${HOST}__m8-assets-fixture`;

/** Hosts the page may talk to before a tap: its own, and nothing else. */
const OWN_HOST = new URL(HOST).host;

async function open(page: Page, html: string, url = FIXTURE_URL): Promise<Watched> {
  const watched = await serveFixture(page, url, html);
  watchErrors(page, watched);
  await page.goto(url);
  // The deferred script has run once the beacon is out or the click listener is in; wait for load.
  await page.waitForLoadState("load");
  return watched;
}

const thirdParty = (watched: Watched) =>
  watched.requests.filter((request) => request.host !== new URL(FIXTURE_URL).host);

test.describe("M8-05 tap to play, all eight providers", () => {
  test("nothing is requested before a tap: no iframe, no third-party request", async ({ page }) => {
    const watched = await open(page, embedsPageHtml(EMBEDS));
    await page.waitForTimeout(500);
    expect(await page.locator("iframe").count()).toBe(0);
    expect(await page.locator("button.pg-embed-play").count()).toBe(EMBEDS.length);
    expect(thirdParty(watched)).toEqual([]);
    // The page's own host serves only the document, the script and the beacon.
    expect(new Set(watched.requests.map((request) => request.host))).toEqual(new Set([OWN_HOST]));
    expect(watched.consoleErrors).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
  });

  for (const [index, embed] of EMBEDS.entries()) {
    test(`${embed.name}: one tap, one iframe, one request, the right height, focus in the player`, async ({
      page,
    }) => {
      const watched = await open(page, embedsPageHtml(EMBEDS));
      // The view beacon goes out after load; let it, so the count below is the tap's alone.
      await expect.poll(() => watched.beacons.length).toBe(1);
      const before = watched.requests.length;
      const button = page.locator("button.pg-embed-play").nth(index);
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.height, "a play button is at least 44px tall").toBeGreaterThanOrEqual(44);
      await button.click();

      await expect(page.locator("iframe")).toHaveCount(1);
      const frame = page.locator("iframe");
      const src = new URL((await frame.getAttribute("src"))!);
      expect(src.host).toMatch(new RegExp(`${embed.host.replace(/\./g, "\\.")}$`));
      expect(src.protocol).toBe("https:");
      expect(await frame.getAttribute("class")).toBe("pg-embed-iframe");
      expect(await frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
      expect(await frame.getAttribute("title")).toContain(`Caption ${index}`);
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");

      // Exactly one request left the page for it (the iframe navigation, aborted by the fixture).
      await page.waitForTimeout(300);
      const added = watched.requests.slice(before);
      expect(added.filter((request) => request.host !== OWN_HOST)).toHaveLength(1);
      expect(added.filter((request) => request.host === OWN_HOST)).toEqual([]);

      const width = page.viewportSize()!.width;
      const frameBox = (await frame.boundingBox())!;
      if (embed.height === null) {
        expect(frameBox.height).toBeCloseTo((frameBox.width * 9) / 16, 0);
      } else {
        expect(frameBox.height).toBeCloseTo(embed.height, 0);
      }
      // It does not widen the page, and at 1440 it stays inside the 480px column.
      expect(frameBox.width).toBeLessThanOrEqual(Math.min(width, 480) + 0.5);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      // The other embeds are still posters.
      expect(await page.locator("button.pg-embed-play").count()).toBe(EMBEDS.length - 1);
    });
  }

  test("a double click, Enter and Space on the focused button mount one iframe only each", async ({
    page,
  }) => {
    await open(page, embedsPageHtml(EMBEDS.slice(0, 3)));
    const buttons = page.locator("button.pg-embed-play");
    await buttons.nth(0).dblclick();
    await expect(page.locator("iframe")).toHaveCount(1);
    await buttons.nth(0).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("iframe")).toHaveCount(2);
    await buttons.nth(0).focus();
    await page.keyboard.press("Space");
    await expect(page.locator("iframe")).toHaveCount(3);
    expect(await page.locator("button.pg-embed-play").count()).toBe(0);
  });

  test("Twitch gets parent={hostname} on a handle host and on a custom host, nowhere else", async ({
    browser,
  }) => {
    const twitch = EMBEDS.filter((embed) => embed.name.startsWith("Twitch"));
    for (const [url, hostname] of [
      [FIXTURE_URL, "mara.localhost"],
      ["http://links.example.test/__m8", "links.example.test"],
    ] as const) {
      const context = await browser.newContext(
        (await import("../../../scripts/lib/viewports")).DESKTOP,
      );
      const page = await context.newPage();
      const watched = await serveFixture(page, url, embedsPageHtml([...twitch, EMBEDS[0]]));
      watchErrors(page, watched);
      await page.goto(url);
      for (let i = 0; i < 3; i++) await page.locator("button.pg-embed-play").first().click();
      const srcs = await page
        .locator("iframe")
        .evaluateAll((frames) => frames.map((frame) => frame.getAttribute("src")));
      expect(srcs).toHaveLength(3);
      for (const src of srcs.slice(0, 2))
        expect(src).toMatch(new RegExp(`&parent=${hostname.replace(/\./g, "\\.")}$`));
      expect(srcs[2]).not.toContain("parent=");
      await context.close();
    }
  });

  test("a tampered button mounts nothing and requests nothing", async ({ page }) => {
    const watched = await open(page, embedsPageHtml(EMBEDS.slice(0, 1)));
    await page.evaluate(() => {
      for (const value of [
        "https://evil.example/x",
        "javascript:window.__x=1",
        "data:text/html,x",
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pg-embed-play";
        button.setAttribute("data-embed-src", value);
        button.textContent = "tampered";
        document.querySelector("main")!.appendChild(button);
      }
    });
    const before = watched.requests.length;
    for (let i = 0; i < 3; i++)
      await page.locator("button.pg-embed-play", { hasText: "tampered" }).first().click();
    await page.waitForTimeout(300);
    expect(await page.locator("iframe").count()).toBe(0);
    expect(await page.locator("p.pg-embed-unavailable").count()).toBe(3);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect(watched.requests.slice(before)).toEqual([]);
  });

  test("with the script request aborted the page still renders and the buttons do nothing", async ({
    page,
  }) => {
    const watched = await serveFixture(page, FIXTURE_URL, embedsPageHtml(EMBEDS.slice(0, 2)));
    watchErrors(page, watched);
    await page.route(/\/_t\/p\.[0-9a-f]{12}\.js$/, (route) => route.abort());
    await page.goto(FIXTURE_URL);
    await page.locator("button.pg-embed-play").first().click();
    expect(await page.locator("iframe").count()).toBe(0);
    expect(await page.locator("button.pg-embed-play").count()).toBe(2);
    // The only console message is the aborted request itself.
    expect(
      watched.consoleErrors.every((text) => /Failed to load resource|ERR_FAILED/.test(text)),
    ).toBe(true);
    expect(watched.pageErrors).toEqual([]);
  });

  test("with navigator.sendBeacon missing, tap to play still works", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "sendBeacon", {
        value: undefined,
        configurable: true,
      });
    });
    const watched = await open(page, embedsPageHtml(EMBEDS.slice(0, 1)));
    await page.locator("button.pg-embed-play").first().click();
    await expect(page.locator("iframe")).toHaveCount(1);
    expect(watched.pageErrors).toEqual([]);
  });
});

test.describe("M8-06 the view beacon from the shared script", () => {
  test("one POST /api/e per load after the load event, with the two keys and the string-beacon content type", async ({
    page,
  }) => {
    const watched = await open(page, embedsPageHtml(EMBEDS.slice(0, 1)));
    await expect.poll(() => watched.beacons.length).toBe(1);
    const beacon = watched.beacons[0]!;
    expect(beacon.host).toBe(OWN_HOST);
    expect(beacon.contentType).toBe("text/plain;charset=UTF-8");
    const body = JSON.parse(beacon.body) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["pageId", "referrer"]);
    expect(body.pageId).toBe(FIXTURE_PAGE_ID);
    expect(typeof body.referrer).toBe("string");
    // A tap sends no second beacon, and a reload sends one more, not two.
    await page.locator("button.pg-embed-play").first().click();
    await page.waitForTimeout(300);
    expect(watched.beacons).toHaveLength(1);
    await page.reload();
    await expect.poll(() => watched.beacons.length).toBe(2);
    await page.waitForTimeout(300);
    expect(watched.beacons).toHaveLength(2);
  });

  test("the beacon goes to the host that served the page, a custom host included", async ({
    page,
  }) => {
    const url = "http://links.example.test/__m8";
    const watched = await open(page, embedsPageHtml(EMBEDS.slice(0, 1)), url);
    await expect.poll(() => watched.beacons.length).toBe(1);
    expect(watched.beacons[0]!.host).toBe("links.example.test");
  });

  for (const [name, attribute] of [
    ["missing", null],
    ["empty", ""],
    ["tampered", '"><x'],
    ["not a UUID", "not-a-uuid"],
  ] as const) {
    test(`a data-page-id that is ${name} sends no request and throws no error`, async ({
      page,
    }) => {
      let html = embedsPageHtml(EMBEDS.slice(0, 1), { script: false });
      const tag =
        attribute === null
          ? `<script src="/_t/x" defer></script>`
          : `<script src="/_t/x" defer data-page-id="${attribute.replace(/"/g, "&quot;")}"></script>`;
      const { TENANT_SCRIPT_SRC } = await import("@/lib/tenant-assets/generated");
      html = html.replace("</body>", `${tag.replace("/_t/x", TENANT_SCRIPT_SRC)}</body>`);
      const watched = await open(page, html);
      await page.waitForTimeout(500);
      expect(watched.beacons).toEqual([]);
      expect(watched.pageErrors).toEqual([]);
      // The click listener still works: the script ran.
      await page.locator("button.pg-embed-play").first().click();
      await expect(page.locator("iframe")).toHaveCount(1);
    });
  }
});
