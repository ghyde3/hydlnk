import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishedDocSchema, toPublishForm, emptyDraft, type DraftDoc } from "@/lib/document";
import { pngSizeOf } from "../e2e/m2/publish-helpers";
import { blocks } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
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

// PNG rendering and sharp on a loaded machine can take far longer than 5 seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const shareOg = await import("@/lib/publish/share-og");
const og = await import("@/lib/publish/og-image");

/**
 * M6-32: the social image of a page with a share picture. Only the owner's own upload is fetched,
 * from the configured Storage origin, with every limit of the spec; anything wrong falls back to
 * the generated card (never a failure); the cache key carries the template version and the share
 * fields. fetch is mocked, sharp is real.
 */

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const PATH = `${UID}/img-0123456789ab.webp`;
const URL_OF = (path: string) =>
  `http://127.0.0.1:54321/storage/v1/object/public/page-media/${path}`;
const ref = (over: Record<string, unknown> = {}) => ({
  path: PATH,
  width: 2400,
  height: 630,
  ...over,
});

const RED = { r: 220, g: 20, b: 20 };
const BLUE = { r: 20, g: 20, b: 220 };

async function split(width: number, height: number, format: "webp" | "png" | "jpeg" = "webp") {
  const half = Math.floor(width / 2);
  const solid = (w: number, color: typeof RED) =>
    sharp({ create: { width: w, height, channels: 3, background: color } })
      .png()
      .toBuffer();
  const composed = sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite([
    { input: await solid(half, RED), left: 0, top: 0 },
    { input: await solid(width - half, BLUE), left: half, top: 0 },
  ]);
  if (format === "png") return composed.png().toBuffer();
  if (format === "jpeg") return composed.jpeg({ quality: 95 }).toBuffer();
  return composed.webp({ lossless: true }).toBuffer();
}

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 4;
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!];
}
const isRed = (p: number[]) => p[0]! > 190 && p[2]! < 60;
const isBlue = (p: number[]) => p[2]! > 190 && p[0]! < 60;

interface Call {
  url: string;
  init: RequestInit | undefined;
}
const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  vi.restoreAllMocks();
});

/** Replaces fetch: every call is recorded; `answer` builds the response (default: the bytes as WebP). */
function mockFetch(answer: (url: string) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return answer(url);
  }) as typeof fetch;
  return calls;
}

const bytesResponse = (bytes: Buffer, type = "image/webp", extra: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type, ...extra } });

describe("M6-32 coverCrop", () => {
  it("covers the frame and puts the crop where the focus says", () => {
    // A wide picture: scaled to the frame's height, cropped sideways.
    expect(shareOg.coverCrop(2400, 630, { x: 0, y: 0.5 })).toEqual({
      resizeTo: { width: 2400, height: 630 },
      left: 0,
      top: 0,
    });
    expect(shareOg.coverCrop(2400, 630, { x: 1, y: 0.5 }).left).toBe(1200);
    expect(shareOg.coverCrop(2400, 630, { x: 0.5, y: 0.5 }).left).toBe(600);
    // A tall picture: scaled to the frame's width, cropped vertically.
    const tall = shareOg.coverCrop(1200, 2400, { x: 0.5, y: 1 });
    expect(tall.resizeTo).toEqual({ width: 1200, height: 2400 });
    expect(tall.top).toBe(2400 - 630);
    // Never smaller than the frame, whatever the rounding.
    for (const [w, h] of [
      [1201, 631],
      [3333, 777],
      [1200, 630],
      [10, 10],
      [1, 4000],
    ] as const) {
      const crop = shareOg.coverCrop(w, h, { x: 1, y: 1 });
      expect(crop.resizeTo.width).toBeGreaterThanOrEqual(1200);
      expect(crop.resizeTo.height).toBeGreaterThanOrEqual(630);
      expect(crop.left + 1200).toBeLessThanOrEqual(crop.resizeTo.width);
      expect(crop.top + 630).toBeLessThanOrEqual(crop.resizeTo.height);
    }
  });
});

describe("M6-32 shareImagePng draws the picture", () => {
  it("makes a 1200x630 PNG and fetches only the one Storage URL, with the guards on the request", async () => {
    const calls = mockFetch(async () => bytesResponse(await split(2400, 630)));
    const png = await shareOg.shareImagePng(ref());
    expect(png).not.toBeNull();
    expect(pngSizeOf(png!)).toEqual({ width: 1200, height: 630 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL_OF(PATH));
    expect(calls[0]!.init?.redirect).toBe("error");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("focus x=0 gives a red center pixel and x=1 a blue one; no focus is the middle", async () => {
    mockFetch(async () => bytesResponse(await split(2400, 630)));
    const left = (await shareOg.shareImagePng(ref({ focus: { x: 0, y: 0.5 } })))!;
    const right = (await shareOg.shareImagePng(ref({ focus: { x: 1, y: 0.5 } })))!;
    const middle = (await shareOg.shareImagePng(ref()))!;
    expect(isRed(await pixel(left, 600, 315))).toBe(true);
    expect(isBlue(await pixel(right, 600, 315))).toBe(true);
    expect(isRed(await pixel(middle, 300, 315))).toBe(true);
    expect(isBlue(await pixel(middle, 900, 315))).toBe(true);
  });

  it("works for PNG and JPEG uploads, a tall picture, and a picture with an alpha channel", async () => {
    for (const format of ["png", "jpeg"] as const) {
      mockFetch(async () => bytesResponse(await split(1600, 800, format), `image/${format}`));
      const png = await shareOg.shareImagePng(
        ref({ path: `${UID}/img-0123456789ab.${format === "jpeg" ? "jpg" : "png"}` }),
      );
      expect(pngSizeOf(png!), format).toEqual({ width: 1200, height: 630 });
    }
    mockFetch(async () => bytesResponse(await split(900, 2400)));
    expect(pngSizeOf((await shareOg.shareImagePng(ref({ width: 900, height: 2400 })))!)).toEqual({
      width: 1200,
      height: 630,
    });
    const transparent = await sharp({
      create: { width: 1300, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    mockFetch(async () => bytesResponse(transparent, "image/png"));
    const flat = (await shareOg.shareImagePng(ref({ path: `${UID}/img-0123456789ab.png` })))!;
    // Flattened on white: no transparent pixel in a picture that is sent to other apps.
    expect(await pixel(flat, 5, 5)).toEqual([255, 255, 255, 255]);
  });

  it("takes an image of exactly 16 megapixels and refuses one over", async () => {
    const solid = (w: number, h: number) =>
      sharp({ create: { width: w, height: h, channels: 3, background: BLUE } })
        .png({ compressionLevel: 9 })
        .toBuffer();
    mockFetch(async () => bytesResponse(await solid(4000, 4000), "image/png"));
    const atLimit = await shareOg.shareImagePng(ref({ path: `${UID}/img-0123456789ab.png` }));
    expect(atLimit).not.toBeNull();
    mockFetch(async () => bytesResponse(await solid(4001, 4000), "image/png"));
    expect(await shareOg.shareImagePng(ref({ path: `${UID}/img-0123456789ab.png` }))).toBeNull();
    mockFetch(async () => bytesResponse(await solid(8000, 8000), "image/png"));
    expect(await shareOg.shareImagePng(ref({ path: `${UID}/img-0123456789ab.png` }))).toBeNull();
  });

  it("turns a picture that says it lies on its side upright before it crops", async () => {
    // 1600x400 pixels with orientation 6: shown as 400x1600, cropped to the frame, still 1200x630.
    const turned = await sharp({
      create: { width: 1600, height: 400, channels: 3, background: BLUE },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    mockFetch(async () => bytesResponse(turned, "image/jpeg"));
    const png = await shareOg.shareImagePng(ref({ path: `${UID}/img-0123456789ab.jpg` }));
    expect(pngSizeOf(png!)).toEqual({ width: 1200, height: 630 });
  });
});

describe("M6-32 shareImagePng follows only the owner's own upload", () => {
  it("never fetches a reference that does not match the schema and the path pattern", async () => {
    const calls = mockFetch(async () => bytesResponse(await split(1600, 800)));
    for (const bad of [
      { path: "../../etc/passwd", width: 1600, height: 800 },
      { path: "http://evil.example/a.png", width: 1600, height: 800 },
      { path: "https://evil.example/a.png", width: 1600, height: 800 },
      { path: "//evil.example/a.png", width: 1600, height: 800 },
      { path: `${UID}/../${UID}/img-0123456789ab.webp`, width: 1600, height: 800 },
      { path: `${UID}/IMG-0123456789AB.webp`, width: 1600, height: 800 },
      { path: `${UID}/img-0123456789ab.svg`, width: 1600, height: 800 },
      { path: `${UID}/img-0123456789ab.webp?x=1`, width: 1600, height: 800 },
      { path: "javascript:alert(1)", width: 1600, height: 800 },
      { path: PATH, width: "1600", height: 800 },
      { path: PATH, width: 0, height: 800 },
      { path: PATH, width: 1600, height: 800, focus: { x: 5, y: 0.5 } },
      null,
      undefined,
      "x",
      42,
      [],
    ]) {
      expect(await shareOg.shareImagePng(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("builds the URL from the validated path, on the configured Storage origin only", async () => {
    const calls = mockFetch(async () => bytesResponse(await split(1600, 800)));
    await shareOg.shareImagePng({
      path: PATH,
      width: 1600,
      height: 800,
      evil: "http://evil.example",
    });
    expect(calls.map((call) => new URL(call.url).origin)).toEqual(["http://127.0.0.1:54321"]);
  });
});

describe("M6-32 shareImagePng falls back (null) instead of failing", () => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ["a 404", () => new Response("nope", { status: 404 })],
    ["a 500", () => new Response("boom", { status: 500 })],
    [
      "a redirect-like answer",
      () => new Response(null, { status: 302, headers: { location: "http://evil.example" } }),
    ],
    ["an HTML page", () => bytesResponse(Buffer.from("<html></html>"), "text/html")],
    [
      "an SVG",
      () =>
        bytesResponse(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml"),
    ],
    ["a GIF", () => bytesResponse(Buffer.from("GIF89a"), "image/gif")],
    ["no content type", () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })],
    ["bytes that are not a picture", () => bytesResponse(Buffer.from("not a picture"))],
    ["an empty body", () => bytesResponse(Buffer.alloc(0))],
    [
      "a declared size over 4 MB",
      () =>
        bytesResponse(Buffer.from("x"), "image/webp", {
          "content-length": String(4 * 1024 * 1024 + 1),
        }),
    ],
    [
      "a body over 4 MB with no declared size",
      () => bytesResponse(Buffer.alloc(4 * 1024 * 1024 + 1)),
    ],
  ];
  it.each(cases)("%s", async (_name, answer) => {
    mockFetch(answer);
    expect(await shareOg.shareImagePng(ref())).toBeNull();
  });

  it("a fetch that throws (a redirect error, a timeout, the network) is null", async () => {
    for (const error of [
      new TypeError("redirect mode is set to error"),
      new DOMException("timeout", "TimeoutError"),
      new Error("ECONNREFUSED"),
    ]) {
      globalThis.fetch = vi.fn(async () => {
        throw error;
      }) as typeof fetch;
      expect(await shareOg.shareImagePng(ref())).toBeNull();
    }
  });

  it("stops reading a body that grows past 4 MB instead of buffering it", async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulled > 50) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    mockFetch(() => new Response(body, { status: 200, headers: { "content-type": "image/webp" } }));
    expect(await shareOg.shareImagePng(ref())).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(12);
  });
});

describe("M6-32 the cache key and getOgPng", () => {
  const doc = (share?: unknown) =>
    publishedDocSchema.parse(
      JSON.parse(
        JSON.stringify(
          toPublishForm(
            {
              ...emptyDraft("mara"),
              blocks: [blocks.link],
              ...(share ? { share } : {}),
            } as DraftDoc,
            null,
          ),
        ),
      ),
    );
  const page = (document: ReturnType<typeof doc>) => ({
    pageId: "00000000-0000-4000-8000-0000000000b1",
    publishedAt: "2026-10-03T12:00:00.000Z",
    document,
    handle: "mara",
    host: "mara.hydlnk.com",
  });

  it("OG_TEMPLATE_VERSION is bumped past 1, and the key holds the page, the time and the share fields", () => {
    expect(Number(og.OG_TEMPLATE_VERSION)).toBeGreaterThanOrEqual(2);
    const key = og.ogCacheKey({
      pageId: "p",
      publishedAt: "2026-10-03T12:00:00.000Z",
      share: { title: "T", image: ref() },
    });
    expect(key.slice(0, 4)).toEqual([
      "og-image",
      og.OG_TEMPLATE_VERSION,
      "p",
      "2026-10-03T12:00:00.000Z",
    ]);
    expect(key[4]).toBe(JSON.stringify({ title: "T", image: ref() }));
  });

  it("a different share title, image or focus is a different key; the same share is the same key", () => {
    const k = (share: unknown) =>
      og.ogCacheKey({ pageId: "p", publishedAt: null, share }).join("|");
    const base = { title: "T", image: ref() };
    expect(k(base)).toBe(k({ title: "T", image: ref() }));
    expect(k(base)).not.toBe(k({ title: "U", image: ref() }));
    expect(k(base)).not.toBe(
      k({ title: "T", image: ref({ path: `${UID}/img-ffffffffffff.webp` }) }),
    );
    expect(k(base)).not.toBe(k({ title: "T", image: ref({ focus: { x: 0.1, y: 0.2 } }) }));
    expect(k(undefined)).not.toBe(k({}));
    expect(og.ogCacheKey({ pageId: "p", publishedAt: null }).at(-1)).toBe("");
  });

  it("serves the share picture, with one request and no font or emoji download", async () => {
    const calls = mockFetch(async () => bytesResponse(await split(2400, 630)));
    const png = await og.getOgPng(
      page(doc({ title: "T", image: ref({ focus: { x: 1, y: 0.5 } }) })),
    );
    expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
    expect(isBlue(await pixel(png, 600, 315))).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([URL_OF(PATH)]);
  });

  it("falls back to today's generated card (HTTP 200 territory, never a throw) when the picture fails", async () => {
    const plainDoc = doc();
    const plain = await og.getOgPng(page(plainDoc));
    for (const answer of [
      () => new Response("gone", { status: 404 }),
      () => bytesResponse(Buffer.from("nonsense")),
      () => {
        throw new Error("network down");
      },
    ]) {
      const calls = mockFetch(answer);
      const png = await og.getOgPng(page(doc({ title: "T", image: ref() })));
      expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
      expect(png.equals(plain)).toBe(true);
      // Only the picture was asked for: no font, no emoji CDN, no other host.
      expect(calls.map((call) => call.url)).toEqual([URL_OF(PATH)]);
    }
  });

  it("a page without share fields gets the same bytes as the generated card, with no request", async () => {
    const calls = mockFetch(() => {
      throw new Error("no request expected");
    });
    const a = await og.getOgPng(page(doc()));
    const b = await og.renderOgPng({
      name: doc().profile.name,
      bio: doc().profile.bio,
      handle: "mara",
      host: "mara.hydlnk.com",
      photo: null,
      tokens: doc().tokens,
    });
    expect(a.equals(b)).toBe(true);
    // Share text alone never changes the image either.
    const text = await og.getOgPng(page(doc({ title: "Words", description: "More words" })));
    expect(text.equals(a)).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("M6-32 the limits are in the source, where a reader looks for them", () => {
  const source = readFileSync("src/lib/publish/share-og.ts", "utf8");
  it("pins redirect error, a 4 second timeout, 4 MB, 16 megapixels", () => {
    expect(source).toMatch(/redirect:\s*"error"/);
    expect(source).toMatch(/AbortSignal\.timeout\(SHARE_IMAGE_TIMEOUT_MS\)/);
    expect(shareOg.SHARE_IMAGE_TIMEOUT_MS).toBe(4000);
    expect(shareOg.SHARE_IMAGE_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(shareOg.SHARE_IMAGE_MAX_PIXELS).toBe(16_000_000);
    expect(source).toMatch(/limitInputPixels:\s*SHARE_IMAGE_MAX_PIXELS/);
    expect(source).toMatch(/IMAGE_PATH_PATTERN\.test\(/);
    expect(source).toMatch(/new URL\(url\)\.origin !== mediaOrigin\(\)/);
  });

  it("the image never asks for a font and never draws text", () => {
    expect(source).not.toMatch(/ImageResponse|loadOgFont|og-font|drawable|fonts\.g/);
  });
});
