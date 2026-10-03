import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanId } from "@/lib/limits";
import { makePng, multipart, padTo, type Part } from "../e2e/m2/publish-helpers";
import { makeJpeg } from "../e2e/m5/images-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the unit test must pass its own storage and quota");
  },
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { processUpload } = await import("@/lib/media/upload");
const { cleanupOwnerMedia } = await import("@/lib/media/cleanup");

const MIB = 1024 * 1024;
const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

/**
 * M5-11 and M5-14 against the M4-31 quota: the cap counts the bytes that are STORED (the WebP the
 * pipeline produced, not the file the browser sent), an image that is already stored adds nothing,
 * and an upload that would not fit first lets go of what the account replaced or removed.
 */

class Bucket {
  objects = new Map<string, number>();
  plan: PlanId = "free";
  /** Paths the cleanup queue holds, and the documents' text the reference check searches. */
  queue = new Set<string>();
  docText = "";
  reclaimCalls = 0;
  reclaimFails = false;
  uploads: string[] = [];

  get used() {
    return [...this.objects.values()].reduce((a, b) => a + b, 0);
  }
  seed(path: string, bytes: number) {
    this.objects.set(path, bytes);
  }

  storage = {
    upload: async (path: string, body: Uint8Array) => {
      this.uploads.push(path);
      this.objects.set(path, body.length);
      return { error: null };
    },
    exists: async (path: string) => this.objects.has(path),
  };
  quota = {
    read: async () => ({ plan: this.plan, usedBytes: this.used, suspended: false }),
    discard: async (path: string) => void this.objects.delete(path),
    reclaim: async () => {
      this.reclaimCalls += 1;
      if (this.reclaimFails) throw new Error("cleanup down");
      await cleanupOwnerMedia(UID, {
        listQueue: async () => [...this.queue],
        inUse: async (_owner, paths) => paths.filter((p) => this.docText.includes(p)),
        remove: async (paths) => paths.forEach((p) => this.objects.delete(p)),
        dequeue: async (_owner, paths) => paths.forEach((p) => this.queue.delete(p)),
      });
    },
  };
}

let bucket: Bucket;
beforeEach(() => {
  bucket = new Bucket();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const send = (data: Buffer, options: Parameters<typeof processUpload>[4] = {}, kind?: string) => {
  const parts: Part[] = [
    { name: "file", file: { filename: "p.png", contentType: "image/png", data } },
    ...(kind ? [{ name: "kind", value: kind }] : []),
  ];
  const { body, contentType } = multipart(parts);
  const request = new Request("http://app.localhost:3000/api/media", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
  return processUpload(request, UID, bucket.storage, bucket.quota, options);
};

/** A pipeline that stores `bytes` distinct bytes whatever it is given. */
const storing = (bytes: number, seedByte = 1) => ({
  transform: async () => ({
    bytes: new Uint8Array(bytes).fill(seedByte),
    width: 100,
    height: 100,
  }),
});

describe("M4-31 + M5-11 the cap counts the bytes actually stored, after conversion", () => {
  it("a 3 MiB upload that converts to a small WebP is charged the WebP, not 3 MiB", async () => {
    bucket.seed(`${UID}/seed`, 10 * MIB - 5000); // 5000 bytes of room
    const original = padTo(makePng(64, 64), 3 * MIB);
    const result = await send(original);
    expect(result.ok).toBe(true);
    const stored = bucket.objects.get(result.ok ? result.image.path : "")!;
    expect(stored).toBeLessThan(5000);
    expect(stored).toBeLessThan(original.length / 100);
    expect(bucket.used).toBe(10 * MIB - 5000 + stored);
  });

  it("exactly at the cap is allowed, one stored byte more is a 413 with nothing stored", async () => {
    bucket.seed(`${UID}/seed`, 10 * MIB - 1000);
    const over = await send(makePng(8, 8), storing(1001));
    expect(over).toMatchObject({ ok: false, status: 413, error: "upload_quota" });
    expect(bucket.uploads).toEqual([]);
    const exact = await send(makePng(8, 8), storing(1000, 2));
    expect(exact.ok).toBe(true);
    expect(bucket.used).toBe(10 * MIB);
  });

  it("the real pipeline's output size is what the cap sees (a photographic upload costs its WebP)", async () => {
    const photo = await makeJpeg({ width: 3000, height: 2000, noise: true, quality: 40 });
    const result = await send(photo, {}, "background");
    expect(result.ok).toBe(true);
    const stored = bucket.objects.get(result.ok ? result.image.path : "")!;
    expect(stored).toBeGreaterThan(1000);
    expect(stored).toBeLessThanOrEqual(600 * 1024);
    expect(bucket.used).toBe(stored);
  }, 30_000);

  it("the same bytes twice do not double-count: the second answer is the first path and adds nothing", async () => {
    const png = makePng(80, 80);
    const a = await send(png);
    const usedAfterFirst = bucket.used;
    const b = await send(png);
    expect(a.ok && b.ok && a.image.path === b.image.path).toBe(true);
    expect(bucket.used).toBe(usedAfterFirst);
    expect(bucket.uploads).toHaveLength(1);
  });

  it("an image that is already stored is answered even when the account is at its cap", async () => {
    const first = await send(makePng(80, 80));
    expect(first.ok).toBe(true);
    bucket.seed(`${UID}/filler`, 10 * MIB);
    const again = await send(makePng(80, 80));
    expect(again.ok).toBe(true);
    expect(bucket.uploads).toHaveLength(1);
  });
});

describe("M5-14 freed bytes lower the total: replacing a 3 MB image makes room", () => {
  const OLD = `${UID}/img-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp`;

  it("a Free account at 9.5 MiB with a replaced 3 MiB image: the 1 MiB upload is accepted after the cleanup", async () => {
    bucket.seed(`${UID}/keep`, 6.5 * MIB);
    bucket.seed(OLD, 3 * MIB);
    expect(bucket.used).toBe(9.5 * MIB);
    bucket.queue.add(OLD); // the draft that replaced it was saved: the trigger queued the old path
    bucket.docText = "{}"; // nothing references it any more

    const result = await send(makePng(8, 8), storing(1 * MIB));
    expect(result.ok).toBe(true);
    expect(bucket.reclaimCalls).toBe(1);
    expect(bucket.objects.has(OLD)).toBe(false);
    expect(bucket.used).toBe(6.5 * MIB + 1 * MIB); // the total dropped by 3 MiB, then took 1 MiB
  });

  it("the same account is refused while the replaced image is still referenced (the live page shows it)", async () => {
    bucket.seed(`${UID}/keep`, 6.5 * MIB);
    bucket.seed(OLD, 3 * MIB);
    bucket.queue.add(OLD);
    bucket.docText = JSON.stringify({ published: { profile: { photo: { path: OLD } } } });

    const result = await send(makePng(8, 8), storing(1 * MIB));
    expect(result).toMatchObject({ ok: false, status: 413, error: "upload_quota" });
    expect(bucket.reclaimCalls).toBe(1); // it tried to make room
    expect(bucket.objects.has(OLD)).toBe(true); // and did not touch what the live page uses
    expect(bucket.uploads).toEqual([]);
  });

  it("the cleanup runs only when the upload would not fit", async () => {
    bucket.seed(`${UID}/keep`, 1 * MIB);
    const result = await send(makePng(8, 8), storing(1 * MIB));
    expect(result.ok).toBe(true);
    expect(bucket.reclaimCalls).toBe(0);
  });

  it("a cleanup that fails is logged and the upload gets the ordinary 413 (never a 500)", async () => {
    bucket.seed(`${UID}/keep`, 9.5 * MIB);
    bucket.reclaimFails = true;
    const result = await send(makePng(8, 8), storing(1 * MIB));
    expect(result).toMatchObject({ ok: false, status: 413, error: "upload_quota" });
  });

  it("freeing room is not enough when the upload is still too big (413 with the plan's message)", async () => {
    bucket.seed(`${UID}/keep`, 9 * MIB);
    bucket.seed(OLD, 0.5 * MIB);
    bucket.queue.add(OLD);
    const result = await send(makePng(8, 8), storing(2 * MIB));
    expect(result).toEqual({
      ok: false,
      status: 413,
      error: "upload_quota",
      message: "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    });
    expect(bucket.objects.has(OLD)).toBe(false); // the cleanup did run and freed what it could
  });
});
