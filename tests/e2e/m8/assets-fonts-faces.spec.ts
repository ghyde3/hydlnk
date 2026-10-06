import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildFontFaces, buildFontPreloads, type FontManifest } from "@/lib/tenant-assets/fonts";

/**
 * M8-01 steps 3 and 4 in real Chrome, with the font bytes served from three real woff2 files that
 * are already in the repo (design/showreel/assets/fonts): the `@font-face` rules and the preloads
 * `tenantFontFaces` and `tenantFontPreloads` write make Chrome fetch exactly the subset files a
 * page's text needs, once each, from the page's own host, with no 'preloaded but not used' warning.
 * The same checks on the live page, with the real vendored fonts, are in assets-fonts-live.spec.ts.
 */

const FONTS = join(process.cwd(), "design/showreel/assets/fonts");
const BYTES = {
  fraunces: readFileSync(join(FONTS, "Fraunces-600-normal.woff2")),
  geist: readFileSync(join(FONTS, "Geist-var.woff2")),
};

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+1E00-1EFF,U+2020,U+20A0-20AB";

const family = (prefix: string, weight: number) => ({
  license: "OFL-1.1",
  faces: [
    {
      weight,
      subset: "latin-ext",
      unicodeRange: LATIN_EXT,
      file: `${prefix}-latin-ext.aaaaaaaaaaaa.woff2`,
      bytes: 1,
    },
    {
      weight,
      subset: "latin",
      unicodeRange: LATIN,
      file: `${prefix}-latin.bbbbbbbbbbbb.woff2`,
      bytes: 1,
    },
  ],
});

const MANIFEST: FontManifest = {
  source: "test",
  families: { Fraunces: family("fraunces", 600), Geist: family("geist", 400) },
};

const TOKENS = { fontHeading: "Fraunces", fontBody: "Geist", weightHeading: 600 };
const URL_OF = "http://mara.localhost:3000/__m8-fonts";

function page(text: string): string {
  const preloads = buildFontPreloads(TOKENS, MANIFEST)
    .map((href) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${href}">`)
    .join("");
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${preloads}` +
    `<style>${buildFontFaces(TOKENS, MANIFEST)}` +
    `h1{font-family:"Fraunces",serif;font-weight:600;margin:0}p{font-family:"Geist",sans-serif;margin:0}</style>` +
    `</head><body><h1>${text}</h1><p>${text}</p></body></html>`
  );
}

async function visit(browserPage: import("@playwright/test").Page, text: string) {
  const fontRequests: string[] = [];
  const otherRequests: string[] = [];
  const warnings: string[] = [];
  browserPage.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
  });
  await browserPage.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host !== "mara.localhost:3000") {
      otherRequests.push(u.host);
      return route.abort();
    }
    if (u.pathname === "/__m8-fonts") {
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: page(text) });
    }
    if (u.pathname.startsWith("/_t/f/")) {
      fontRequests.push(u.pathname.split("/").pop()!);
      const body = u.pathname.includes("fraunces") ? BYTES.fraunces : BYTES.geist;
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "font/woff2",
          "cache-control": "public, max-age=31536000, immutable",
          "access-control-allow-origin": "*",
        },
        body,
      });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await browserPage.goto(URL_OF);
  await browserPage.evaluate(() => document.fonts.ready);
  // The 'preloaded but not used' warning appears 3 seconds after load.
  await browserPage.waitForTimeout(3500);
  return { fontRequests, otherRequests, warnings };
}

test.describe("M8-01 the page's @font-face rules and preloads in Chrome", () => {
  test("ASCII text: one request for each latin file, none for latin-ext, no warning, the faces are loaded", async ({
    page: browserPage,
  }) => {
    const { fontRequests, otherRequests, warnings } = await visit(browserPage, "Hello from Mara");
    expect([...fontRequests].sort()).toEqual([
      "fraunces-latin.bbbbbbbbbbbb.woff2",
      "geist-latin.bbbbbbbbbbbb.woff2",
    ]);
    expect(otherRequests).toEqual([]);
    expect(warnings.filter((text) => /preload/i.test(text))).toEqual([]);
    const status = await browserPage.evaluate(() =>
      [...document.fonts].map((face) => `${face.family}|${face.weight}|${face.status}`).sort(),
    );
    expect(status.filter((entry) => entry.endsWith("|loaded")).length).toBe(2);
    expect(status.filter((entry) => entry.endsWith("|unloaded")).length).toBe(2);
    expect(await browserPage.evaluate(() => document.fonts.check('600 16px "Fraunces"'))).toBe(
      true,
    );
    expect(await browserPage.evaluate(() => document.fonts.check('400 16px "Geist"'))).toBe(true);
  });

  test("text that needs latin-ext also fetches the latin-ext file of each family, and nothing else", async ({
    page: browserPage,
  }) => {
    const { fontRequests, warnings } = await visit(browserPage, "Łukasz Żółć");
    expect([...fontRequests].sort()).toEqual([
      "fraunces-latin-ext.aaaaaaaaaaaa.woff2",
      "fraunces-latin.bbbbbbbbbbbb.woff2",
      "geist-latin-ext.aaaaaaaaaaaa.woff2",
      "geist-latin.bbbbbbbbbbbb.woff2",
    ]);
    expect(warnings.filter((text) => /preload/i.test(text))).toEqual([]);
  });
});
