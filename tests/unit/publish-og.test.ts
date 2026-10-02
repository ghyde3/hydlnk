import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pngSizeOf } from "../e2e/m2/publish-helpers";

vi.mock("server-only", () => ({}));

// Database round trips and PNG rendering: a loaded machine can take far longer than 5 seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const og = await import("@/lib/publish/og-image");
const { loadOgFont, readCoveredCodePoints } = await import("@/lib/publish/og-font");
const { noirTokens } = await import("./fixtures/page-document");

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const PHOTO = { path: `${UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png`, width: 8, height: 8 };

const input = (over: Partial<Parameters<typeof og.renderOgPng>[0]> = {}) => ({
  name: "Mara Okafor",
  bio: "Portrait & studio photographer",
  handle: "mara",
  host: "mara.hydlnk.com",
  photo: null,
  tokens: noirTokens,
  ...over,
});

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  vi.restoreAllMocks();
});

/** Fails the test on any request; remembers each URL. */
function blockNetwork(): string[] {
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (request: Parameters<typeof fetch>[0]) => {
    urls.push(String(request instanceof Request ? request.url : request));
    throw new Error("network is off");
  }) as typeof fetch;
  return urls;
}

describe("M2-30 the bundled font", () => {
  it("is a copy of the font Next bundles for next/og", () => {
    const mine = readFileSync(join(process.cwd(), "src/lib/publish/fonts/Geist-Regular.ttf"));
    const theirs = readFileSync(
      join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"),
    );
    expect(mine.equals(theirs)).toBe(true);
  });

  it("knows which code points it can draw", async () => {
    const font = await loadOgFont();
    for (const char of ["A", "z", "0", "&", "é", "ñ", "ü", "—", "·", "€"]) {
      expect(font.has(char.codePointAt(0)!), char).toBe(true);
    }
    for (const char of ["😀", "漢", "👨"]) {
      expect(font.has(char.codePointAt(0)!), char).toBe(false);
    }
    expect(font.data.byteLength).toBeGreaterThan(50_000);
    expect(readCoveredCodePoints(Buffer.from(font.data)).size).toBeGreaterThan(300);
  });

  it("drawable() keeps what the font draws and collapses the rest", async () => {
    const font = await loadOgFont();
    expect(og.drawable("Mara Okafor", font)).toBe("Mara Okafor");
    expect(og.drawable("Mara 📸 Okafor", font)).toBe("Mara Okafor");
    expect(og.drawable("漢字 Mara", font)).toBe("Mara");
    expect(og.drawable("👨‍👩‍👧", font)).toBe("");
    expect(og.drawable("  a \n b\t c  ", font)).toBe("a b c");
  });
});

describe("M2-30 renderOgPng", () => {
  beforeAll(async () => {
    await loadOgFont();
  });

  it("makes a 1200x630 PNG with a non-trivial body", async () => {
    const png = await og.renderOgPng(input());
    expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
    expect(png.length).toBeGreaterThan(5_000);
  });

  it("makes no network request at all for text: not Google Fonts, not an emoji CDN", async () => {
    const urls = blockNetwork();
    const names = ["Mara Okafor", "Mara 📸 Okafor", "漢字 名前", "Ünïcödé Ñame", "عربى", "👨‍👩‍👧‍👦"];
    for (const name of names) {
      const png = await og.renderOgPng(input({ name, bio: `${name} — bio 🎉 漢字` }));
      expect(pngSizeOf(png), name).toEqual({ width: 1200, height: 630 });
    }
    expect(urls.filter((u) => /fonts\.googleapis|fonts\.gstatic|jsdelivr|twemoji/.test(u))).toEqual(
      [],
    );
    expect(urls).toEqual([]);
  });

  it("a 60-character unbroken name and a 160-character bio still make a valid image", async () => {
    const png = await og.renderOgPng(
      input({ name: "W".repeat(60), bio: "word ".repeat(32).trim().slice(0, 160) }),
    );
    expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
    const unbroken = await og.renderOgPng(input({ name: "x".repeat(60), bio: "y".repeat(160) }));
    expect(pngSizeOf(unbroken)).toEqual({ width: 1200, height: 630 });
    expect(unbroken.length).toBeGreaterThan(5_000);
  });

  it("an empty bio and a name that is all unsupported glyphs fall back to the handle", async () => {
    const png = await og.renderOgPng(input({ name: "漢字", bio: "", handle: "mara" }));
    expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
  });

  it("draws the page's own colors: the background pixel is tokens.bg", async () => {
    const a = await og.renderOgPng(input({ tokens: { ...noirTokens, bg: "#112233" } }));
    const b = await og.renderOgPng(input({ tokens: { ...noirTokens, bg: "#FFEEDD" } }));
    expect(a.equals(b)).toBe(false);
  });
});

describe("M2-30 the avatar is loaded only from the configured Storage origin", () => {
  it("a path that does not match the image-reference schema is never fetched", async () => {
    const urls = blockNetwork();
    for (const path of [
      "../../etc/passwd",
      "http://evil.example/a.png",
      "https://evil.example/a.png",
      "//evil.example/a.png",
      `${UID}/../../x.png`,
      `${UID}/a.png`,
      `${UID}/aaaaaaaa.gif`,
      "javascript:alert(1).png",
      `${UID}/aaaaaaaa.png?x=http://evil.example`,
      `${UID}/aaaaaaaa.png#frag`,
      "",
    ]) {
      expect(await og.avatarDataUri({ path, width: 8, height: 8 }), path).toBeNull();
    }
    expect(urls).toEqual([]);
  });

  it("a valid reference is fetched from exactly the public page-media URL, without redirects", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;
    const uri = await og.avatarDataUri(PHOTO);
    expect(uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString("base64")}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/page-media/${PHOTO.path}`,
    );
    expect(calls[0]!.init?.redirect).toBe("error");
  });

  it.each([
    [
      "a non-image content type",
      () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    ],
    [
      "a WebP (the renderer cannot draw it)",
      () => new Response(new Uint8Array(4), { headers: { "content-type": "image/webp" } }),
    ],
    ["an SVG", () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })],
    [
      "a 404",
      () => new Response("nope", { status: 404, headers: { "content-type": "image/png" } }),
    ],
    [
      "an empty body",
      () => new Response(new Uint8Array(0), { headers: { "content-type": "image/png" } }),
    ],
    [
      "a declared size over 4 MiB",
      () =>
        new Response(new Uint8Array(4), {
          headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) },
        }),
    ],
  ])("falls back to initials for %s", async (_label, respond) => {
    globalThis.fetch = vi.fn(async () => respond()) as unknown as typeof fetch;
    expect(await og.avatarDataUri(PHOTO)).toBeNull();
  });

  it("falls back to initials when the fetch throws or times out", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await og.avatarDataUri(PHOTO)).toBeNull();
    expect(await og.avatarDataUri(null)).toBeNull();
  });

  it("an image with a photo still renders when the photo cannot be fetched", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const png = await og.renderOgPng(input({ photo: PHOTO }));
    expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
  });
});

describe("M2-30 the OG avatar fallback uses the page's own initials rule", () => {
  it("imports initialsOf from the renderer (first letter of the first and the last word)", async () => {
    const source = readFileSync("src/lib/publish/og-image.tsx", "utf8");
    expect(source).toMatch(
      /import\s*\{\s*initialsOf\s*\}\s*from\s*"@\/components\/page\/initials"/,
    );
    expect(source).not.toMatch(/function initialsOf/);
  });
});
