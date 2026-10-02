import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanId } from "@/lib/limits";
import { makePng, multipart, padTo, type Part } from "../e2e/m2/publish-helpers";

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

const MIB = 1024 * 1024;
const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const INSTANCE_A = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e0a";
const INSTANCE_B = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e0b";

/**
 * M4-31: the per-account upload cap in `processUpload`, with an in-memory bucket and account. The
 * stack-backed twin (limits-upload-stack.test.ts) runs the same rules against the real database
 * and Storage.
 */

class FakeBucket {
  /** path -> bytes */
  objects = new Map<string, number>();
  plan: PlanId = "free";
  suspended = false;
  accountExists = true;
  readFails = false;
  removeFails = false;
  uploadCalls = 0;
  /** Held back so two uploads can both pass the first read before either one stores. */
  gate: Promise<void> | null = null;

  seed(bytes: number) {
    this.objects.set(`seed/${this.objects.size}`, bytes);
  }
  get used() {
    return [...this.objects.values()].reduce((a, b) => a + b, 0);
  }

  storage = {
    upload: async (path: string, body: Uint8Array) => {
      this.uploadCalls += 1;
      if (this.gate) await this.gate;
      this.objects.set(path, body.length);
      return { error: null };
    },
  };
  quota = {
    read: async () => {
      if (this.readFails) throw new Error("db down");
      if (!this.accountExists) return null;
      return { plan: this.plan, usedBytes: this.used, suspended: this.suspended };
    },
    discard: async (path: string) => {
      if (this.removeFails) throw new Error("storage down");
      this.objects.delete(path);
    },
  };
}

let bucket: FakeBucket;
beforeEach(() => {
  bucket = new FakeBucket();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

function request(size: number): Request {
  const file: Part = {
    name: "file",
    file: { filename: "p.png", contentType: "image/png", data: padTo(makePng(8, 8), size) },
  };
  const { body, contentType } = multipart([file]);
  return new Request("http://app.localhost:3000/api/media", {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
}

const upload = (size: number, uid = UID, b = bucket) =>
  processUpload(request(size), uid, b.storage, b.quota);

describe("M4-31 the plan's cap, exact at the limit", () => {
  it("M4-31 Free with 9 MiB used: 2 MiB gets 413 upload_quota and stores nothing", async () => {
    bucket.seed(9 * MIB);
    const result = await upload(2 * MIB);
    expect(result).toEqual({
      ok: false,
      status: 413,
      error: "upload_quota",
      message: "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    });
    expect(bucket.uploadCalls).toBe(0);
    expect(bucket.used).toBe(9 * MIB);
  });

  it("M4-31 Free with 9 MiB used: 1 MiB is accepted (exactly at the limit is allowed), the next byte is not", async () => {
    bucket.seed(9 * MIB);
    const ok = await upload(MIB);
    expect(ok.ok).toBe(true);
    expect(bucket.used).toBe(10 * MIB);
    const over = await upload(80);
    expect(over).toMatchObject({ ok: false, status: 413, error: "upload_quota" });
    expect(bucket.used).toBe(10 * MIB);
  });

  it("M4-31 Pro with 99 MiB used: 2 MiB gets 413 with the Pro message, 1 MiB is accepted", async () => {
    bucket.plan = "pro";
    bucket.seed(99 * MIB);
    expect(await upload(2 * MIB)).toEqual({
      ok: false,
      status: 413,
      error: "upload_quota",
      message: "Uploads are limited to 100 MB on Pro. Delete an image or upgrade.",
    });
    expect((await upload(MIB)).ok).toBe(true);
  });

  it("M4-31 Studio: the cap is 1 GiB", async () => {
    bucket.plan = "studio";
    bucket.seed(1024 * MIB - 100);
    expect((await upload(100)).ok).toBe(true);
    expect(await upload(80)).toEqual({
      ok: false,
      status: 413,
      error: "upload_quota",
      message: "Uploads are limited to 1 GB on Studio. Delete an image or upgrade.",
    });
  });

  it("M4-31 freeing bytes (a removed object) lets the next upload in", async () => {
    bucket.seed(10 * MIB);
    expect(await upload(MIB)).toMatchObject({ ok: false, status: 413 });
    bucket.objects.clear();
    bucket.seed(8 * MIB);
    expect((await upload(MIB)).ok).toBe(true);
  });
});

describe("M4-31 the account must exist and not be suspended", () => {
  it("M4-31 a missing account row stores nothing (403)", async () => {
    bucket.accountExists = false;
    expect(await upload(100)).toMatchObject({ ok: false, status: 403, error: "forbidden" });
    expect(bucket.uploadCalls).toBe(0);
  });

  it("M4-31 a suspended account stores nothing (403)", async () => {
    bucket.suspended = true;
    expect(await upload(100)).toMatchObject({ ok: false, status: 403, error: "forbidden" });
    expect(bucket.uploadCalls).toBe(0);
  });
});

describe("M4-31 the cap fails closed", () => {
  it("M4-31 a quota read that fails stores nothing and the error propagates (the route answers 500)", async () => {
    bucket.readFails = true;
    await expect(upload(100)).rejects.toThrow("db down");
    expect(bucket.uploadCalls).toBe(0);
  });

  it("M4-31 without a quota nothing is enforced (the route always passes one)", async () => {
    bucket.seed(50 * MIB);
    const result = await processUpload(request(100), UID, bucket.storage);
    expect(result.ok).toBe(true);
  });
});

describe("M4-31 concurrency", () => {
  it("M4-31 two simultaneous uploads of one account that together exceed the cap: at most one is accepted, and nothing extra is stored", async () => {
    bucket.seed(8 * MIB);
    const [a, b] = await Promise.all([upload(1.5 * MIB), upload(1.5 * MIB)]);
    const accepted = [a, b].filter((r) => r.ok);
    expect(accepted.length).toBeLessThanOrEqual(1);
    expect(accepted).toHaveLength(1); // serialized on this instance: the first fits, the second is refused
    expect([a, b].filter((r) => !r.ok)[0]).toMatchObject({ status: 413, error: "upload_quota" });
    expect(bucket.used).toBeLessThanOrEqual(10 * MIB);
    // The refused one never reached storage.
    expect(bucket.uploadCalls).toBe(1);
  });

  it("M4-31 two instances (no shared lock) that both pass the first read: the re-read removes what does not fit", async () => {
    bucket.seed(8 * MIB);
    // Both reads happen before either store finishes.
    let release!: () => void;
    bucket.gate = new Promise<void>((resolve) => (release = resolve));
    // Different lock keys stand in for two server instances sharing one bucket.
    const first = upload(1.5 * MIB, INSTANCE_A);
    const second = upload(1.5 * MIB, INSTANCE_B);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bucket.uploadCalls).toBe(2);
    release();
    const results = await Promise.all([first, second]);
    const accepted = results.filter((r) => r.ok);
    expect(accepted.length).toBeLessThanOrEqual(1);
    for (const refused of results.filter((r) => !r.ok)) {
      expect(refused).toMatchObject({ status: 413, error: "upload_quota" });
    }
    // Whatever was refused is gone again: the bucket never ends past the cap.
    expect(bucket.used).toBeLessThanOrEqual(10 * MIB);
  });

  it("M4-31 an over-cap object that cannot be removed is still refused (and logged)", async () => {
    bucket.seed(8 * MIB);
    let release!: () => void;
    bucket.gate = new Promise<void>((resolve) => (release = resolve));
    bucket.removeFails = true;
    const first = upload(1.5 * MIB, INSTANCE_A);
    const second = upload(1.5 * MIB, INSTANCE_B);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const results = await Promise.all([first, second]);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0]).toMatchObject({ status: 413, error: "upload_quota" });
  });

  it("M4-31 different accounts do not wait on each other", async () => {
    const other = new FakeBucket();
    const [a, b] = await Promise.all([
      upload(MIB, INSTANCE_A, bucket),
      upload(MIB, INSTANCE_B, other),
    ]);
    expect(a.ok && b.ok).toBe(true);
  });
});
