// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { backgroundImagePath, backgroundImageUrl } from "@/components/page/background";
import { PageRenderer } from "@/components/page/page-renderer";
import { mediaPathOf } from "@/lib/themes/bg-image";
import { mediaOrigin, mediaUrl, storageUrl } from "@/lib/media/url";
import { PUBLIC_READ_CACHE_VERSION } from "@/lib/publish/tags";
import { isProjectMediaUrl, tokenSetSchema } from "@/lib/theme/tokens";
import { fullPublished, noirTokens, photoRef } from "./fixtures/page-document";

// The token schema reads the project URL from the public env when it parses.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    // A trailing slash on purpose: neither builder may double it.
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M7-15: `mediaUrl(path)` is the address a browser loads an image from (`/media/{path}` on the
 * page's own host); `storageUrl(path)` is the stored form, the absolute Storage address. The
 * stored form does not change, nothing is migrated, and nothing outside url.ts spells it.
 */

const STORAGE = "http://127.0.0.1:54321/storage/v1/object/public/page-media";
const UID = "0b6f1a5e-7c1d-4a52-9d0e-3a7c5e8f2b14";
const LONG = `${"abcdef0123456789".repeat(4)}`; // 64 characters

describe("M7-15 mediaUrl and storageUrl on six paths", () => {
  it.each([
    ["a webp", `${UID}/img-0123456789abcdef0123456789abcdef.webp`, null],
    ["a png", `${UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png`, null],
    ["a jpg", `${UID}/avatar-0123456789ab.jpg`, null],
    ["an odd character", "a b/c#d?.png", "a%20b/c%23d%3F.png"],
    ["an empty path", "", ""],
    ["a 64-character name", `${UID}/${LONG}.webp`, null],
  ])("%s", (_name, path, encoded) => {
    const tail = encoded ?? path;
    expect(mediaUrl(path)).toBe(`/media/${tail}`);
    expect(storageUrl(path)).toBe(`${STORAGE}/${tail}`);
  });

  it("mediaUrl is relative, has one leading slash and never a query, fragment or origin", () => {
    for (const path of [`${UID}/img-0123456789ab.webp`, "x/y?z=1#f", "../x", ""]) {
      const url = mediaUrl(path);
      expect(url.startsWith("/media/")).toBe(true);
      expect(url.startsWith("//")).toBe(false);
      expect(url).not.toMatch(/[?#]|:\/\//);
    }
  });

  it("encodes each segment, so a stray character never changes the shape", () => {
    expect(mediaUrl("a/b/../c")).toBe("/media/a/b/../c"); // dots are not encoded; the route refuses them
    expect(mediaUrl("a%2Fb/c")).toBe("/media/a%252Fb/c");
    expect(storageUrl("a%2Fb/c")).toBe(`${STORAGE}/a%252Fb/c`);
  });

  it("mediaOrigin is unchanged: the Storage origin", () => {
    expect(mediaOrigin()).toBe("http://127.0.0.1:54321");
  });
});

describe("M7-15 the stored form does not change", () => {
  const stored = storageUrl(`${UID}/bg-0123456789ab.webp`);

  it("the validators still accept the Storage URL", () => {
    expect(isProjectMediaUrl(stored)).toBe(true);
    expect(tokenSetSchema.shape.bgImage.safeParse(stored).success).toBe(true);
    expect(mediaPathOf(stored, mediaOrigin())).toBe(`${UID}/bg-0123456789ab.webp`);
    expect(backgroundImagePath(stored)).toBe(`${UID}/bg-0123456789ab.webp`);
  });

  it("a relative /media address written as bgImage is refused everywhere", () => {
    const relativeForm = mediaUrl(`${UID}/bg-0123456789ab.webp`);
    expect(isProjectMediaUrl(relativeForm)).toBe(false);
    expect(tokenSetSchema.shape.bgImage.safeParse(relativeForm).success).toBe(false);
    // Publish reads the path with mediaPathOf: no path, so no "your image" and no publish.
    expect(mediaPathOf(relativeForm, mediaOrigin())).toBeNull();
    expect(backgroundImagePath(relativeForm)).toBeNull();
  });

  it("backgroundImageUrl rebuilds /media from the validated path", () => {
    expect(backgroundImageUrl({ bgType: "image", bgImage: stored })).toBe(
      `/media/${UID}/bg-0123456789ab.webp`,
    );
  });

  it.each([
    [
      "another origin",
      `https://evil.example/storage/v1/object/public/page-media/${UID}/abcdefgh.webp`,
    ],
    [
      "another bucket",
      `http://127.0.0.1:54321/storage/v1/object/public/other/${UID}/abcdefgh.webp`,
    ],
    ["a query", `${STORAGE}/${UID}/abcdefgh.webp?x=1`],
    ["a quote", `${STORAGE}/${UID}/abcdefgh.webp"`],
    ["traversal", `${STORAGE}/../../x.webp`],
    ["a bare /media path", `/media/${UID}/abcdefgh.webp`],
  ])("a hostile background (%s) draws no image", (_name, value) => {
    expect(backgroundImageUrl({ bgType: "image", bgImage: value })).toBeNull();
  });

  it("a published document and the cached read hold no /media string, so the cache version stays 3", () => {
    expect(PUBLIC_READ_CACHE_VERSION).toBe("3");
    const published = {
      ...fullPublished,
      tokens: { ...fullPublished.tokens, bgType: "image" as const, bgImage: stored },
    };
    const json = JSON.stringify(published);
    expect(json).not.toContain("/media/");
    expect(json).toContain(stored); // the stored form, untouched
    expect(json).toContain(photoRef.path); // image references hold the path only
  });

  it("the page draws /media addresses and no Storage address at all", () => {
    const doc = {
      ...fullPublished,
      tokens: { ...noirTokens, bgType: "image" as const, bgImage: stored },
    };
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc,
        pageId: "00000000-0000-4000-8000-0000000000b1",
        mode: "live",
      }),
    );
    expect(html).toContain(`src="/media/${photoRef.path}"`);
    expect(html).toContain(`url(&quot;/media/${UID}/bg-0123456789ab.webp&quot;)`);
    expect(html).not.toContain("127.0.0.1:54321");
    expect(html).not.toContain("/storage/v1/");
  });
});

/** Every file under `dir` whose name ends with one of `exts`. */
function files(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, exts);
    return exts.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

describe("M7-15 the Storage address is spelled in one place", () => {
  // url.ts builds it; the two validators read the stored form back (`isProjectMediaUrl`,
  // `mediaPathOf`), and `backgroundImagePath` gets its prefix from storageUrl("").
  const ALLOWED = new Set([
    "src/lib/media/url.ts",
    "src/lib/theme/tokens.ts",
    "src/lib/themes/bg-image.ts",
  ]);

  it("'/storage/v1/object/public' appears nowhere else under src/", () => {
    const hits = files("src", [".ts", ".tsx", ".css", ".js", ".mjs"])
      .filter((path) => readFileSync(path, "utf8").includes("/storage/v1/object/public"))
      .map((path) => relative(".", path));
    expect(hits.filter((path) => !ALLOWED.has(path))).toEqual([]);
    // And the allowed ones really are the ones that spell it (the list does not rot).
    expect([...ALLOWED].filter((path) => !hits.includes(path))).toEqual([]);
  });

  const read = (path: string) => readFileSync(path, "utf8");

  it("the server's own fetches, the stored upload url and the Undo check use storageUrl", () => {
    for (const path of ["src/lib/publish/og-image.tsx", "src/lib/publish/share-og.ts"]) {
      const text = read(path);
      expect(text, path).toContain("storageUrl(ref.data.path)");
      expect(text, path).not.toMatch(/\bmediaUrl\b/);
      // The guard stays: a relative address would make `new URL` throw and drop the image.
      expect(text, path).toContain("new URL(url).origin !== mediaOrigin()");
    }
    expect(read("src/lib/media/upload.ts")).toContain("url: storageUrl(path)");
    expect(read("src/lib/media/upload.ts")).not.toMatch(/\bmediaUrl\b/);
    const undo = read("src/components/editor/use-undo-redo.ts");
    expect(undo).toContain("urlOf: storageUrl");
    expect(undo).not.toMatch(/\bmediaUrl\b/);
    // The Design background control writes the stored form and shows the /media address.
    const bg = read("src/components/design/sections/background-section.tsx");
    expect(bg).toContain('setTokenRef.current("bgImage", storageUrl(image.path))');
    expect(bg).toContain("src={mediaUrl(imagePath)}");
  });
});
