import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { rawBuffer, tenantGet } from "../m2/publish-helpers";
import {
  CASES,
  NEW_CASES,
  box,
  embedOf,
  isPhone,
  liveEmbeds,
  stubThirdParties,
  tapAndGetSrc,
  watchCsp,
} from "./embeds-helpers";

test.afterAll(cleanupUsers);

/**
 * M6-26 (the tenant Content Security Policy) and M6-27 (tap-to-play facades) on a live page with
 * one embed of each of the eight providers. The page is a fixture of its own: mara's rows are not
 * touched. Third-party hosts are answered by a stand-in, so nothing reaches the internet.
 */

test.describe("M6-26 and M6-27 live embeds", () => {
  test("M6-26 the tenant policy names the nine frame origins exactly, and the app host gains none", async () => {
    const fx = await liveEmbeds("emcsp");
    const res = await tenantGet(fx.handle);
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(res.headers["content-security-policy"]).not.toMatch(/script-src|nonce/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    const app = await rawBuffer("app.localhost:3000", "/login");
    expect(String(app.headers["content-security-policy"] ?? "")).not.toMatch(
      /vimeo|tiktok|instagram|soundcloud|apple|twitch/,
    );
  });

  test("M6-27 loading the page makes no request to any provider, and fetches no thumbnail", async ({
    page,
    context,
  }) => {
    const fx = await liveEmbeds("empriv");
    const seen = await stubThirdParties(context);
    const hosts: string[] = [];
    page.on("request", (request) => hosts.push(new URL(request.url()).hostname));
    await page.goto(fx.url);
    await expect(page.locator(".pg-embed")).toHaveCount(CASES.length);
    await page.waitForLoadState("networkidle");
    // Spotify is the one provider that loads an iframe at once (as before M6-27): it is the only
    // host, apart from the page's own Google Fonts (M3-04), which no embed has to do with.
    const fonts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
    const outside = hosts.filter(
      (host) => !/(^|\.)localhost$/.test(host) && host !== "127.0.0.1" && !fonts.has(host),
    );
    expect(outside.filter((host) => !/spotify\.com$|scdn\.co$/.test(host))).toEqual([]);
    expect(seen.filter((host) => !/spotify\.com$|scdn\.co$/.test(host))).toEqual([]);
    // The embed blocks other than Spotify hold no URL, image or iframe before a tap.
    for (const c of CASES.filter((c) => c.provider !== "spotify")) {
      const html = await embedOf(page, c.id).evaluate((el) => el.outerHTML);
      expect(html, c.name).not.toContain("://");
      expect(html, c.name).not.toMatch(/<(iframe|img|script|link|video|source)\b/);
    }
  });

  test("M6-27 each facade is a button on a poster with its own name, caption and height", async ({
    page,
    context,
  }) => {
    const fx = await liveEmbeds("emfac");
    await stubThirdParties(context);
    await page.goto(fx.url);
    for (const c of CASES.filter((c) => c.provider !== "spotify")) {
      const embed = embedOf(page, c.id);
      const button = embed.getByRole("button", { name: c.label, exact: true });
      await expect(button, c.name).toBeVisible();
      await expect(embed.locator(".pg-embed-caption"), c.name).toHaveText(c.below);
      const b = await box(button);
      expect(b.height, `${c.name} facade height`).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
      if (c.facade !== null) expect(Math.round(b.height), c.name).toBe(c.facade);
      else expect(Math.abs(b.width / b.height - 16 / 9), c.name).toBeLessThan(0.05);
      // The poster is the dark box with the play disc.
      expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor), c.name).toBe(
        "rgb(5, 5, 5)",
      );
      await expect(button.locator(".pg-embed-play-disc")).toBeVisible();
    }
  });

  test("M6-26 and M6-27 tapping every player mounts its iframe, with no CSP violation, and injected frames are blocked", async ({
    page,
    context,
  }) => {
    const fx = await liveEmbeds("emtap");
    await stubThirdParties(context);
    const csp = await watchCsp(page);
    await page.goto(fx.url);
    await expect(page.locator(".pg-embed")).toHaveCount(CASES.length);

    for (const c of CASES.filter((c) => c.provider !== "spotify")) {
      const src = await tapAndGetSrc(page, c.id);
      const parsed = new URL(src);
      expect(parsed.origin, c.name).toBe(c.origin);
      const frame = embedOf(page, c.id).locator("iframe");
      await expect(frame, c.name).toHaveAttribute(
        "referrerpolicy",
        "strict-origin-when-cross-origin",
      );
      await expect(frame, c.name).toHaveAttribute(
        "title",
        new RegExp(`\\(${c.provider === "youtube" ? "YouTube video" : ".+ player"}\\)$`),
      );
      // Focus moves into the iframe.
      expect(await page.evaluate(() => document.activeElement?.tagName), c.name).toBe("IFRAME");
      // The player has the height of the table (or the 16:9 box).
      const b = await box(frame);
      if (c.player !== null) expect(Math.round(b.height), c.name).toBe(c.player);
      else expect(Math.abs(b.width / b.height - 16 / 9), c.name).toBeLessThan(0.05);
    }
    // Provider specifics of the tapped src.
    const srcOf = (id: string) => embedOf(page, id).locator("iframe").getAttribute("src");
    expect(await srcOf("emb-vimeo-0001")).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1&autoplay=1",
    );
    expect(new URL((await srcOf("emb-soundcloud1"))!).searchParams.get("auto_play")).toBe("true");
    expect(await srcOf("emb-tiktok-001")).toBe(
      "https://www.tiktok.com/embed/v2/7234567890123456789",
    );
    expect(await srcOf("emb-instagram1")).toBe("https://www.instagram.com/reel/CxYz12AbCde/embed");
    expect(await srcOf("emb-applemusic")).toBe(
      "https://embed.music.apple.com/us/album/the-album/1440857781",
    );

    await page.waitForTimeout(400);
    expect(await csp.violations()).toEqual([]);
    expect(csp.messages).toEqual([]);

    // An iframe from another origin is blocked by frame-src; so are look-alikes and the bare provider origins.
    for (const frameUrl of [
      "https://evil.example/",
      "https://player.vimeo.com.evil.example/video/76979871",
      "https://vimeo.com/76979871",
      "https://www.tiktok.com.evil.example/embed/v2/1",
      "https://twitch.tv/mara_plays",
    ]) {
      const verdict = await page.evaluate(
        (target) =>
          new Promise<string>((resolve) => {
            document.addEventListener(
              "securitypolicyviolation",
              (event) => resolve(event.violatedDirective),
              {
                once: true,
              },
            );
            const frame = document.createElement("iframe");
            frame.src = target;
            document.body.appendChild(frame);
            setTimeout(() => resolve("not blocked"), 3000);
          }),
        frameUrl,
      );
      expect(verdict, frameUrl).toMatch(/^frame-src/);
    }
  });

  test("M6-27 Twitch plays with the page's own hostname as its parent, and nothing else", async ({
    page,
    context,
  }) => {
    const fx = await liveEmbeds("emtwc", [CASES.find((c) => c.provider === "twitch")!]);
    await stubThirdParties(context);
    await page.goto(fx.url);
    const src = await tapAndGetSrc(page, "emb-twitch-0001");
    expect(src.endsWith(`parent=${fx.handle}.localhost`)).toBe(true);
    expect(src).toBe(
      `https://player.twitch.tv/?channel=mara_plays&autoplay=true&parent=${fx.handle}.localhost`,
    );
  });

  test("M6-27 layout: full-width facades, 44px play buttons, players never widen the page", async ({
    page,
    context,
  }) => {
    const fx = await liveEmbeds("emlay");
    await stubThirdParties(context);
    await page.goto(fx.url);
    await expect(page.locator(".pg-embed")).toHaveCount(CASES.length);
    await expectNoHorizontalScroll(page);
    const phone = isPhone(page);
    const column = await box(page.locator(".pg-column"));
    for (const c of NEW_CASES.concat(CASES.filter((c) => c.provider === "youtube"))) {
      const embed = embedOf(page, c.id);
      const button = embed.locator("button.pg-embed-play");
      const bb = await box(button);
      const eb = await box(embed);
      expect(
        Math.abs(bb.width - eb.width),
        `${c.name} is the full width of its block`,
      ).toBeLessThanOrEqual(1);
      expect(bb.height, c.name).toBeGreaterThanOrEqual(44);
      if (!phone) expect(bb.width, `${c.name} within the 480px column`).toBeLessThanOrEqual(480.5);
      expect(bb.x).toBeGreaterThanOrEqual(column.x - 0.5);
      expect(bb.x + bb.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
    }
    // Tap each: the iframe does not widen the page.
    for (const c of NEW_CASES.concat(CASES.filter((c) => c.provider === "youtube"))) {
      await tapAndGetSrc(page, c.id);
      const frame = await box(embedOf(page, c.id).locator("iframe"));
      const viewport = page.viewportSize()!.width;
      expect(frame.x + frame.width, `${c.name} stays inside the viewport`).toBeLessThanOrEqual(
        viewport + 0.5,
      );
      if (!phone)
        expect(frame.width, `${c.name} within the 480px column`).toBeLessThanOrEqual(480.5);
      await expectNoHorizontalScroll(page);
    }
    const innerWidth = await page.evaluate(() => window.innerWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });

  test("M6-26 a stored embed that parses to nothing renders no iframe on the live page", async ({
    page,
  }) => {
    const { adminClient } = await import("../fixtures/auth");
    const fx = await liveEmbeds("emevil", [CASES.find((c) => c.provider === "vimeo")!]);
    // Written straight to `published` with the secret key (Publish would refuse every one of these).
    const evil = [
      "https://vimeo.com.evil.example/123456",
      "https://evil.example/x",
      'https://www.tiktok.com/@mara/video/1"onload="alert(1)',
      "javascript:alert(1)",
    ];
    const published = JSON.parse(JSON.stringify(fx.doc)) as {
      blocks: { id: string; url: string }[];
    };
    published.blocks = evil.map((u, i) => ({
      id: `emb-evil-000${i}`,
      type: "embed",
      visible: true,
      url: u,
      caption: "Evil",
    })) as never;
    const { error } = await adminClient().from("pages").update({ published }).eq("id", fx.pageId);
    expect(error).toBeNull();
    const response = await page.goto(url(fx.handle));
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("iframe")).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("onload=");
  });
});
