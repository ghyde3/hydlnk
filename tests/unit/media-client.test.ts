import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_MAX_EDGE, MAX_UPLOAD_BYTES } from "@/lib/media/limits";
import {
  FILE_TOO_BIG_MESSAGE,
  IMAGE_TOO_LARGE_MESSAGE,
  RATE_LIMITED_MESSAGE,
  UNREADABLE_IMAGE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  uploadErrorMessage,
} from "@/lib/media/messages";
import { fitWithin, prepareImageForUpload, type DecodedImage } from "@/lib/media/upload-client";

const MIB = 1024 * 1024;

/**
 * M5-11: the browser downsizes a big photo before it is sent (Vercel caps a function request body at
 * 4.5 MB). The geometry and the retry ladder are pure and tested here with a fake decoder; the real
 * canvas path is exercised in the editor spec.
 */

const file = (size: number, type = "image/jpeg", name = "IMG_0001.JPG") =>
  new File([new Uint8Array(size)], name, { type });

/** A decoder whose encoder returns blobs of the sizes it is told to, recording each request. */
function decoder(
  width: number,
  height: number,
  sizes: number[],
  calls: { w: number; h: number; type: string; quality: number }[] = [],
) {
  let index = 0;
  const closed = vi.fn();
  const image: DecodedImage = {
    width,
    height,
    close: closed,
    async encode(w, h, type, quality) {
      calls.push({ w, h, type, quality });
      const size = sizes[Math.min(index++, sizes.length - 1)]!;
      return size < 0 ? null : new Blob([new Uint8Array(size)], { type });
    },
  };
  return { deps: { decode: async () => image }, calls, closed };
}

describe("M5-11 fitWithin", () => {
  it.each([
    [6000, 4000, 2400, { width: 2400, height: 1600 }],
    [4000, 6000, 2400, { width: 1600, height: 2400 }],
    [2400, 1200, 2400, { width: 2400, height: 1200 }],
    [800, 600, 2400, { width: 800, height: 600 }],
    [10000, 1, 2400, { width: 2400, height: 1 }],
  ])("%ix%i within %i", (w, h, max, expected) => {
    expect(fitWithin(w, h, max)).toEqual(expected);
  });
});

describe("M5-11 prepareImageForUpload", () => {
  it("a 9 MB 6000x4000 JPEG is redrawn with its longest edge at 2400 and fits the body cap", async () => {
    const { deps, calls } = decoder(6000, 4000, [1.4 * MIB]);
    const original = file(9 * MIB);
    const out = await prepareImageForUpload(original, deps);
    expect(out).not.toBe(original);
    expect(out.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_0001.jpg");
    expect(calls[0]).toMatchObject({ w: CLIENT_MAX_EDGE, h: 1600, type: "image/jpeg" });
    expect(Math.max(calls[0]!.w, calls[0]!.h)).toBeLessThanOrEqual(2400);
  });

  it("a small photo goes through untouched (the server still sees the original bytes)", async () => {
    const { deps, calls } = decoder(1600, 1200, [1000]);
    const original = file(900 * 1024);
    expect(await prepareImageForUpload(original, deps)).toBe(original);
    expect(calls).toEqual([]);
  });

  it("an image within 2400px but over 4 MiB is re-encoded, not resized", async () => {
    const { deps, calls } = decoder(2000, 1500, [2 * MIB]);
    const out = await prepareImageForUpload(file(5 * MIB), deps);
    expect(out.size).toBe(2 * MIB);
    expect(calls[0]).toMatchObject({ w: 2000, h: 1500 });
  });

  it("a wide image over 2400px but under 4 MiB is still downsized (the pixels, not only the bytes, are capped)", async () => {
    const { deps, calls } = decoder(5000, 1000, [500 * 1024]);
    const out = await prepareImageForUpload(file(3 * MIB), deps);
    expect(calls[0]).toMatchObject({ w: 2400, h: 480 });
    expect(out.size).toBe(500 * 1024);
  });

  it("walks down a ladder (quality, then size) until the result fits", async () => {
    const { deps, calls } = decoder(6000, 4000, [6 * MIB, 5 * MIB, 3 * MIB]);
    const out = await prepareImageForUpload(file(12 * MIB), deps);
    expect(out.size).toBe(3 * MIB);
    expect(calls).toHaveLength(3);
    expect(calls[1]!.quality).toBeLessThan(calls[0]!.quality);
    expect(calls[2]!.w).toBeLessThan(calls[1]!.w);
  });

  it("a PNG stays a PNG while it fits (transparency), else goes out as JPEG", async () => {
    const png = decoder(3000, 2000, [2 * MIB]);
    const kept = await prepareImageForUpload(file(6 * MIB, "image/png", "shot.png"), png.deps);
    expect(png.calls[0]!.type).toBe("image/png");
    expect(kept.name).toBe("shot.png");

    const big = decoder(3000, 2000, [9 * MIB, 1 * MIB]);
    const jpeg = await prepareImageForUpload(file(12 * MIB, "image/png", "shot.png"), big.deps);
    expect(big.calls.map((c) => c.type)).toEqual(["image/png", "image/jpeg"]);
    expect(jpeg.type).toBe("image/jpeg");
    expect(jpeg.name).toBe("shot.jpg");
  });

  it("when nothing fits it sends the smallest attempt (the server answers 413 itself)", async () => {
    const { deps } = decoder(6000, 4000, [9 * MIB, 8 * MIB, 7 * MIB]);
    const original = file(20 * MIB);
    const out = await prepareImageForUpload(original, deps);
    expect(out.size).toBe(7 * MIB);
  });

  it("when the browser cannot encode, the original is sent", async () => {
    const { deps } = decoder(6000, 4000, [-1]);
    const original = file(9 * MIB);
    expect(await prepareImageForUpload(original, deps)).toBe(original);
  });

  it("a file the browser cannot decode is returned as it is", async () => {
    const original = file(9 * MIB);
    expect(
      await prepareImageForUpload(original, {
        decode: async () => {
          throw new Error("InvalidStateError");
        },
      }),
    ).toBe(original);
    expect(await prepareImageForUpload(original, { decode: async () => null })).toBe(original);
  });

  it("anything that is not JPEG, PNG or WebP is left for the server to refuse", async () => {
    const gif = file(9 * MIB, "image/gif", "a.gif");
    const { deps, calls } = decoder(6000, 4000, [1]);
    expect(await prepareImageForUpload(gif, deps)).toBe(gif);
    expect(calls).toEqual([]);
  });

  it("releases the decoded bitmap", async () => {
    const { deps, closed } = decoder(6000, 4000, [1 * MIB]);
    await prepareImageForUpload(file(9 * MIB), deps);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe("M5-13 the sentences the editor shows", () => {
  it("prefers the route's own message", () => {
    expect(uploadErrorMessage(422, { message: IMAGE_TOO_LARGE_MESSAGE })).toBe(
      "That image is too large. Use one under 40 megapixels.",
    );
    expect(
      uploadErrorMessage(413, {
        message: "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
      }),
    ).toBe("Uploads are limited to 10 MB on Free. Delete an image or upgrade.");
  });

  it("falls back by status when there is no JSON body (a gateway page, a platform refusal)", () => {
    expect(uploadErrorMessage(415, null)).toBe(UNSUPPORTED_TYPE_MESSAGE);
    expect(uploadErrorMessage(413)).toBe(FILE_TOO_BIG_MESSAGE);
    expect(uploadErrorMessage(422, {})).toBe(UNREADABLE_IMAGE_MESSAGE);
    expect(uploadErrorMessage(429)).toBe(RATE_LIMITED_MESSAGE);
    expect(uploadErrorMessage(401)).toBe("You’re signed out. Sign in again to upload.");
    expect(uploadErrorMessage(500)).toBe("Couldn’t upload that image. Try again.");
    expect(uploadErrorMessage(502, { message: "" })).toBe("Couldn’t upload that image. Try again.");
  });

  it("the four editor sentences are exactly the acceptance copy", () => {
    expect(UNSUPPORTED_TYPE_MESSAGE).toBe("That file type isn’t supported. Use JPEG, PNG or WebP.");
    expect(FILE_TOO_BIG_MESSAGE).toBe("That file is too big. Use an image under 4 MB.");
    expect(UNREADABLE_IMAGE_MESSAGE).toBe("We couldn’t read that image. Try a different file.");
    expect(IMAGE_TOO_LARGE_MESSAGE).toBe("That image is too large. Use one under 40 megapixels.");
  });
});

describe("M5-14 scheduleMediaCleanup", () => {
  const fetchMock = vi.fn(async () => new Response("{}"));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    const listeners: Record<string, (() => void)[]> = {};
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: () => void) => (
        (listeners[type] ??= []).push(fn),
        undefined
      ),
      __fire: (type: string) => listeners[type]?.forEach((fn) => fn()),
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (type: string, fn: () => void) => (
        (listeners[`doc:${type}`] ??= []).push(fn),
        undefined
      ),
      __fire: (type: string) => listeners[`doc:${type}`]?.forEach((fn) => fn()),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits past the 8 second Undo toast after the last save, then makes one POST with no body", async () => {
    const { scheduleMediaCleanup, UNDO_WINDOW_MS, MEDIA_CLEANUP_URL } =
      await import("@/lib/media/cleanup-client");
    expect(UNDO_WINDOW_MS).toBeGreaterThan(8000);
    scheduleMediaCleanup();
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    scheduleMediaCleanup(); // another save restarts the wait
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MEDIA_CLEANUP_URL);
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "same-origin" });
    expect(init.body).toBeUndefined();
  });

  it("goes out at once when the tab is hidden or closed, and only once", async () => {
    const { scheduleMediaCleanup } = await import("@/lib/media/cleanup-client");
    scheduleMediaCleanup();
    (window as unknown as { __fire: (t: string) => void }).__fire("pagehide");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    (window as unknown as { __fire: (t: string) => void }).__fire("pagehide");
    vi.advanceTimersByTime(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a network failure is swallowed", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { scheduleMediaCleanup, UNDO_WINDOW_MS } = await import("@/lib/media/cleanup-client");
    scheduleMediaCleanup();
    vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
