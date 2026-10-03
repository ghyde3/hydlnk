import { expect, test, type Browser, type BrowserContext, type TestInfo } from "@playwright/test";
import { emptyDraft, newBlockId, type Block } from "@/lib/document";
import { NOT_FOUND_TITLE } from "@/lib/error-copy";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { userWithBlocks } from "./preview-helpers";
import { getShare, makeLink, randomIp, visibleText } from "./pages-helpers";

/**
 * Wave F security review fixes on the shared preview (M6-10): the script policy and its nonce, the
 * hidden characters a draft may hold, inert embeds, and a share page that carries nothing of the
 * signed-in app. Every spec makes its own user and its own client IP.
 */

test.afterAll(cleanupUsers);

const YOUTUBE = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const SPOTIFY = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
const THIRD_PARTY = /youtube|ytimg|googlevideo|spotify|scdn\.co/i;

async function visitorContext(browser: Browser, info: TestInfo): Promise<BrowserContext> {
  return browser.newContext({
    ...(info.project.use as object),
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
}

const embedBlocks = (): Block[] =>
  [
    { id: newBlockId(), type: "embed", visible: true, url: YOUTUBE, caption: "A video" },
    { id: newBlockId(), type: "embed", visible: true, url: SPOTIFY, caption: "A song" },
    {
      id: newBlockId(),
      type: "link",
      visible: true,
      label: "A link",
      url: "https://example.com/a",
    },
  ] as Block[];

test.describe("M6-10 the script policy of a shared draft, over HTTP", () => {
  test("M6-10 every script on the page carries the nonce of its own response, and no two responses share one", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await userWithBlocks(context, "shn", embedBlocks);
    const link = await makeLink(owner.userId, owner.pageId);

    const nonces = new Set<string>();
    for (const token of [link.token, link.token, "Z".repeat(43)]) {
      const res = await getShare(token, randomIp());
      const csp = String(res.headers["content-security-policy"]);
      const nonce = /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(csp)?.[1];
      expect(nonce, csp).toBeDefined();
      nonces.add(nonce!);
      expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);

      // The 200 and the 404 both ship scripts, and none of them is without the nonce.
      const tags = res.body.match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length, `${res.status}: scripts`).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, `${res.status}: ${tag}`).toContain(`nonce="${nonce}"`);
      // And nothing in the markup runs inline: no on* attribute, no javascript: address.
      expect(res.body).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
      expect(res.body).not.toMatch(/(?:href|src|action)=["']\s*javascript:/i);
    }
    expect(nonces.size).toBe(3);
  });

  test("M6-10 hidden control and bidi characters in a draft never reach the share page; a text block keeps its line breaks", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await userWithBlocks(
      context,
      "shc",
      () =>
        [
          {
            id: newBlockId(),
            type: "link",
            visible: true,
            label: "Pay\u202Epal\u0007now",
            url: "https://example.com/pay",
          },
          {
            id: newBlockId(),
            type: "text",
            visible: true,
            text: "Line one\nLine\u2067 two\u0001\u0085",
          },
          {
            id: newBlockId(),
            type: "card",
            visible: true,
            title: "Card\u202Atitle",
            caption: "cap\u009Ftion",
            url: "https://example.com/card",
            image: null,
          },
          { id: newBlockId(), type: "header", visible: true, text: "Head\u2069er\u0001" },
        ] as Block[],
      {
        // The profile name and bio are drafts too.
        extra: {
          profile: {
            ...emptyDraft("x").profile,
            name: "Ada\u202Elovelace",
            bio: "Bi\u0008o\u2066",
          },
        },
      },
    );
    const link = await makeLink(owner.userId, owner.pageId);
    const res = await getShare(link.token, randomIp());
    expect(res.status).toBe(200);

    const html = res.body;
    // None of the characters a published page refuses is anywhere in the markup.

    expect(html).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202A-\u202E\u2066-\u2069]/);
    const text = visibleText(html);
    expect(text).toContain("Paypalnow");
    expect(text).toContain("Adalovelace");
    expect(text).toContain("Bio");
    expect(text).toContain("Cardtitle");
    expect(text).toContain("caption");
    expect(text).toContain("Header");
    // Only the text block keeps a newline.
    expect(html).toContain("Line one\nLine two");
  });

  test("M6-10 the page ships nothing of the signed-in app: no app 404, no shell, no browser client", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const owner = await userWithBlocks(context, "shs", embedBlocks);
    const link = await makeLink(owner.userId, owner.pageId);
    const ok = await getShare(link.token, randomIp());
    const missing = await getShare("Z".repeat(43), randomIp());
    expect(ok.status).toBe(200);
    expect(missing.status).toBe(404);
    for (const res of [ok, missing]) {
      const label = String(res.status);
      // The app's own 404 ("That page doesn’t exist.") is not drawn for this route at all.
      expect(res.body, label).not.toContain(NOT_FOUND_TITLE);
      expect(res.body, label).not.toContain("Go to the Editor");
      // No script of the Supabase browser client or of the editor header reaches a visitor (the
      // development build names its chunks after their modules; a production build hashes them).
      const scripts = (res.body.match(/\bsrc="[^"]*"/g) ?? []).join(" ");
      expect(scripts, label).not.toMatch(/supabase|auth-js|editor-header|share-preview|page-name/i);
      expect(res.body, label).not.toMatch(/createPreviewLink|listPreviewLinks|revokePreviewLink/);
    }
  });
});

test.describe("M6-10 the script policy of a shared draft, in a browser", () => {
  test("M6-10 under the policy the page hydrates and nothing is blocked", async ({
    browser,
    context,
  }, info) => {
    const owner = await userWithBlocks(context, "shb", embedBlocks);
    const link = await makeLink(owner.userId, owner.pageId);
    const visitor = await visitorContext(browser, info);
    await visitor.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    const page = await visitor.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (/content security policy|refused to/i.test(message.text()))
        consoleErrors.push(message.text());
    });

    const response = await page.goto(link.url);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("status").first()).toContainText("Draft preview");

    // Hydrated: a tap on a link is stopped by the preview frame's client handler, so the URL stays.
    // Before hydration the link would have navigated away.
    const start = page.url();
    await page.locator("[data-page-root] main a").first().click({ force: true });
    await page.waitForTimeout(300);
    expect(page.url()).toBe(start);

    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await visitor.close();
  });

  test("M6-10 markup a renderer bug let through would not run: an injected script and an inline handler are blocked", async ({
    browser,
    context,
  }, info) => {
    const owner = await userWithBlocks(context, "shi", embedBlocks);
    const link = await makeLink(owner.userId, owner.pageId);
    const visitor = await visitorContext(browser, info);
    await visitor.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        w.__csp.push(`${event.violatedDirective}`);
      });
    });
    const page = await visitor.newPage();
    // What a bug in a renderer would add to the page: a script element, and an element with an
    // inline event handler (an image that cannot load, which fires `onerror` at once).
    await page.route(link.url, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /<\/body>(?![\s\S]*<\/body>)/,
        `<script>window.__ran = (window.__ran || 0) + 1</script>` +
          `<img src="x:" alt="" onerror="window.__ran = (window.__ran || 0) + 10">` +
          `<svg onload="window.__ran = (window.__ran || 0) + 100"></svg></body>`,
      );
      expect(body).toContain("window.__ran");
      await route.fulfill({ response, body });
    });

    const response = await page.goto(link.url);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toContain("script-src-attr 'none'");
    await expect(page.getByRole("status").first()).toContainText("Draft preview");
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as unknown as { __ran?: number }).__ran)).toBe(
      undefined,
    );
    const violated = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(violated.join(" ")).toMatch(/script-src-elem|script-src\b/);
    expect(violated.join(" ")).toContain("script-src-attr");
    await visitor.close();
  });
});

test.describe("M6-10 embeds on the shared page are inert posters", () => {
  test("M6-10 no iframe, no Play button, no request to YouTube or Spotify, and a tap on a poster mounts nothing", async ({
    browser,
    context,
  }, info) => {
    const owner = await userWithBlocks(context, "shp", embedBlocks);
    const link = await makeLink(owner.userId, owner.pageId);
    const visitor = await visitorContext(browser, info);
    const page = await visitor.newPage();
    const thirdParty: string[] = [];
    page.on("request", (request) => {
      if (THIRD_PARTY.test(new URL(request.url()).hostname)) thirdParty.push(request.url());
    });

    const response = await page.goto(link.url);
    expect(response?.status()).toBe(200);
    expect(await response!.text()).not.toContain("<iframe");
    await expect(page.locator(".pg-embed")).toHaveCount(2);
    // The posters and the captions are there; the way to play is not.
    await expect(page.getByText("A video · YouTube")).toBeVisible();
    await expect(page.getByText("A song · Spotify")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /play video/i })).toHaveCount(0);

    for (const poster of await page.locator(".pg-embed").all()) {
      await poster.scrollIntoViewIfNeeded();
      await poster.click({ force: true });
    }
    await page.waitForTimeout(600);
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(page.frames()).toHaveLength(1);
    expect(thirdParty).toEqual([]);
    await visitor.close();
  });
});
