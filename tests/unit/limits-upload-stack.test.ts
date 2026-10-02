import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMeters } from "@/lib/limits";
import { makePng, multipart, padTo } from "../e2e/m2/publish-helpers";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));

// Real Storage round trips (tens of MiB for the Pro cases): allow a loaded machine its time.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M4-31 and M4-32 against the local Supabase: the real `account_upload_bytes`, the real Storage
 * bucket and the real `adminUploadQuota`. The accounting counts what is actually stored, the cap
 * comes from `accounts.plan`, and the usage numbers come from the server-only `account_usage`.
 */
const { run } = await stackIsUp();

const MIB = 1024 * 1024;
const BUCKET = "page-media";

describe.skipIf(!run)("M4-31 / M4-32 upload quota and usage (local Supabase)", () => {
  let admin: SupabaseClient;
  let processUpload: typeof import("@/lib/media/upload").processUpload;
  let adminUploadQuota: typeof import("@/lib/media/quota").adminUploadQuota;
  let loadAccountUsage: typeof import("@/lib/limits/usage").loadAccountUsage;
  const owners: TestOwner[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    ({ processUpload } = await import("@/lib/media/upload"));
    ({ adminUploadQuota } = await import("@/lib/media/quota"));
    ({ loadAccountUsage } = await import("@/lib/limits/usage"));
  });

  afterAll(async () => {
    for (let i = 0; i < objects.length; i += 100) {
      await admin.storage.from(BUCKET).remove(objects.slice(i, i + 100));
    }
    await removeOwners(admin, owners);
  });

  async function owner(label: string, plan: "free" | "pro" | "studio" = "free") {
    const made = await makeOwner(admin, label, undefined, plan);
    owners.push(made);
    return made;
  }

  /** Stores `mib` MiB under the user's folder in files of at most 4 MiB (the bucket's cap). */
  async function seed(userId: string, mib: number): Promise<string[]> {
    const paths: string[] = [];
    let left = mib * MIB;
    let index = 0;
    while (left > 0) {
      const size = Math.min(left, 4 * MIB);
      paths.push(`${userId}/seed-${index++}.png`);
      left -= size;
    }
    const sizes = paths.map((_, i) => Math.min(mib * MIB - i * 4 * MIB, 4 * MIB));
    for (let i = 0; i < paths.length; i += 5) {
      await Promise.all(
        paths.slice(i, i + 5).map(async (path, j) => {
          const { error } = await admin.storage
            .from(BUCKET)
            .upload(path, Buffer.alloc(sizes[i + j]!), { contentType: "image/png", upsert: false });
          if (error) throw new Error(`seed ${path}: ${error.message}`);
        }),
      );
    }
    objects.push(...paths);
    return paths;
  }

  const stored = async (userId: string): Promise<number> => {
    const { data, error } = await admin.rpc("account_upload_bytes", { p_uid: userId });
    expect(error).toBeNull();
    return Number(data);
  };

  function request(size: number): Request {
    const { body, contentType } = multipart([
      {
        name: "file",
        file: { filename: "p.png", contentType: "image/png", data: padTo(makePng(8, 8), size) },
      },
    ]);
    return new Request("http://app.localhost:3000/api/media", {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Uint8Array(body),
    });
  }

  async function upload(userId: string, size: number) {
    const result = await processUpload(
      request(size),
      userId,
      undefined,
      adminUploadQuota(userId, admin),
    );
    if (result.ok) objects.push(result.image.path);
    return result;
  }

  it("M4-31 account_upload_bytes counts the bytes actually in the bucket, and freed bytes lower it", async () => {
    const a = await owner("qb");
    expect(await stored(a.userId)).toBe(0);
    const paths = await seed(a.userId, 6);
    expect(await stored(a.userId)).toBe(6 * MIB);
    const { error } = await admin.storage.from(BUCKET).remove([paths[0]!]);
    expect(error).toBeNull();
    expect(await stored(a.userId)).toBe(2 * MIB);
    // Another account's folder is its own.
    const b = await owner("qb2");
    expect(await stored(b.userId)).toBe(0);
  });

  it("M4-31 Free with 9 MiB used: 2 MiB gets 413 upload_quota and stores nothing; 1 MiB is accepted; the next byte is refused", async () => {
    const a = await owner("qf");
    await seed(a.userId, 9);
    expect(await stored(a.userId)).toBe(9 * MIB);

    const over = await upload(a.userId, 2 * MIB);
    expect(over).toEqual({
      ok: false,
      status: 413,
      error: "upload_quota",
      message: "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    });
    expect(await stored(a.userId)).toBe(9 * MIB);

    const exact = await upload(a.userId, MIB);
    expect(exact.ok).toBe(true);
    expect(await stored(a.userId)).toBe(10 * MIB);

    const next = await upload(a.userId, 80);
    expect(next).toMatchObject({ ok: false, status: 413, error: "upload_quota" });
    expect(await stored(a.userId)).toBe(10 * MIB);
  });

  it("M4-31 the plan is read from accounts.plan: the same 2 MiB upload is accepted once the account is Pro", async () => {
    const a = await owner("qp");
    await seed(a.userId, 9);
    expect(await upload(a.userId, 2 * MIB)).toMatchObject({ ok: false, status: 413 });
    const flip = await admin.from("accounts").update({ plan: "pro" }).eq("id", a.userId);
    expect(flip.error).toBeNull();
    expect((await upload(a.userId, 2 * MIB)).ok).toBe(true);
    expect(await stored(a.userId)).toBe(11 * MIB);
  });

  it("M4-31 Pro with 99 MiB used: 2 MiB gets 413 with the Pro message; exactly 1 MiB fits", async () => {
    const a = await owner("qpro", "pro");
    await seed(a.userId, 99);
    expect(await stored(a.userId)).toBe(99 * MIB);
    expect(await upload(a.userId, 2 * MIB)).toEqual({
      ok: false,
      status: 413,
      error: "upload_quota",
      message: "Uploads are limited to 100 MB on Pro. Delete an image or upgrade.",
    });
    expect((await upload(a.userId, MIB)).ok).toBe(true);
    expect(await stored(a.userId)).toBe(100 * MIB);
  });

  it("M4-31 two simultaneous uploads that together exceed the cap: at most one is accepted", async () => {
    const a = await owner("qc");
    await seed(a.userId, 8);
    const [first, second] = await Promise.all([
      upload(a.userId, 1.5 * MIB),
      upload(a.userId, 1.5 * MIB),
    ]);
    const accepted = [first, second].filter((r) => r.ok);
    expect(accepted.length).toBeLessThanOrEqual(1);
    expect(accepted).toHaveLength(1);
    expect(await stored(a.userId)).toBeLessThanOrEqual(10 * MIB);
    expect(await stored(a.userId)).toBe(8 * MIB + Math.round(1.5 * MIB));
  });

  it("M4-31 a suspended account cannot upload", async () => {
    const a = await owner("qs");
    const { error } = await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    expect(error).toBeNull();
    expect(await upload(a.userId, 100)).toMatchObject({
      ok: false,
      status: 403,
      error: "forbidden",
    });
    expect(await stored(a.userId)).toBe(0);
  });

  it("M4-32 a Pro account with 2 pages, 1 domain, 18 MiB and 5 themes reads 2 / 3, 1 / 1, 18 / 100 MB and 5 · no limit", async () => {
    const a = await owner("qu", "pro");
    const second = await admin
      .from("pages")
      .insert({ owner_id: a.userId, handle: `${a.handle}-2`, draft: { version: 1 } })
      .select("id")
      .single();
    expect(second.error).toBeNull();
    const domain = await admin.from("domains").insert({
      page_id: a.pageId,
      hostname: `${a.handle}.usage.example`,
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    expect(domain.error).toBeNull();
    const themes = await admin
      .from("themes")
      .insert(
        Array.from({ length: 5 }, (_, i) => ({ owner_id: a.userId, name: `T${i}`, tokens: {} })),
      );
    expect(themes.error).toBeNull();
    await seed(a.userId, 18);

    const usage = await loadAccountUsage(a.userId, admin);
    expect(usage).toEqual({ pages: 2, domains: 1, savedThemes: 5, uploadBytes: 18 * MIB });
    const text = Object.fromEntries(buildMeters("pro", usage).map((m) => [m.key, m.text]));
    expect(text).toEqual({
      pages: "2 / 3",
      domains: "1 / 1",
      uploads: "18 / 100 MB",
      themes: "5 · no limit",
    });
  });

  it("M4-33 after a downgrade to Free the same account reads over its limits and nothing was deleted", async () => {
    const a = await owner("qd", "pro");
    for (const n of [2, 3]) {
      const res = await admin
        .from("pages")
        .insert({ owner_id: a.userId, handle: `${a.handle}-${n}`, draft: { version: 1 } });
      expect(res.error).toBeNull();
    }
    await seed(a.userId, 12);
    const before = await loadAccountUsage(a.userId, admin);
    expect(before).toMatchObject({ pages: 3, uploadBytes: 12 * MIB });

    const flip = await admin.from("accounts").update({ plan: "free" }).eq("id", a.userId);
    expect(flip.error).toBeNull();

    // Nothing is deleted.
    expect(await loadAccountUsage(a.userId, admin)).toEqual(before);
    const meters = Object.fromEntries(buildMeters("free", before).map((m) => [m.key, m]));
    expect(meters.pages).toMatchObject({ text: "3 / 1", percent: 100, over: true });
    expect(meters.uploads).toMatchObject({ text: "12 / 10 MB", percent: 100, over: true });

    // New writes are refused: a page, an upload.
    const page = await admin
      .from("pages")
      .insert({ owner_id: a.userId, handle: `${a.handle}-4`, draft: { version: 1 } });
    expect(page.error?.code).toBe("HL001");
    expect(await upload(a.userId, 100)).toMatchObject({
      ok: false,
      status: 413,
      error: "upload_quota",
    });

    // Deleting is allowed, and the meter drops.
    const gone = await admin.from("pages").delete().eq("handle", `${a.handle}-3`);
    expect(gone.error).toBeNull();
    expect((await loadAccountUsage(a.userId, admin)).pages).toBe(2);
  });
});
