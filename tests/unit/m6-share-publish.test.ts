import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishedDocSchema } from "@/lib/document";
import { makePng } from "../e2e/m2/publish-helpers";
import {
  draftOf,
  makeOwner,
  publishedOf,
  rand,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));

// Database round trips and Storage: a loaded machine can take far longer than 5 seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M6-32, the Publish gate and the database: `publishPageCore` against the local Supabase with the
 * secret key, for drafts written the way a client with the publishable key could write them. Each
 * refused draft leaves `pages.published` and `published_at` exactly as they were; a good one stores
 * the share card trimmed with its empty fields left out; no plan check exists on the path.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M6-32 the share card at Publish (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
  });

  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    await removeOwners(admin, owners);
  });

  const owner = async (label: string, plan?: "free" | "pro" | "studio") => {
    const made = await makeOwner(admin, label, (handle) => draftOf(handle), plan);
    owners.push(made);
    return made;
  };
  const writeDraft = async (o: TestOwner, share: unknown) => {
    const { error } = await admin
      .from("pages")
      .update({
        draft: { ...draftOf(o.handle), ...(share === undefined ? {} : { share }) } as never,
      })
      .eq("id", o.pageId);
    expect(error).toBeNull();
  };
  const publish = (o: TestOwner, userId = o.userId) =>
    core.publishPageCore({ pageId: o.pageId, userId }, { admin });
  const store = async (o: TestOwner, ext = "png"): Promise<string> => {
    const path = `${o.userId}/img-${rand(12)}.${ext}`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, new Uint8Array(makePng(8, 8)), { contentType: `image/${ext}` });
    expect(error).toBeNull();
    objects.push(path);
    return path;
  };
  const refusal = async (o: TestOwner) => {
    const result = await publish(o);
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.errors;
  };

  it("stores the share card trimmed, with empty fields left out and unknown keys stripped", async () => {
    const o = await owner("sp1");
    const path = await store(o);
    await writeDraft(o, {
      title: "  Hear the new album  ",
      description: "",
      image: { path, width: 1200, height: 630, focus: { x: 0.123456, y: 0.5 }, extra: "x" },
      extra: "<script>",
    });
    const result = await publish(o);
    expect(result.ok).toBe(true);
    const { published } = await publishedOf(admin, o.pageId);
    expect(published).toMatchObject({
      share: { title: "Hear the new album", image: { path, width: 1200, height: 630 } },
    });
    const share = (published as { share: Record<string, unknown> }).share;
    expect(Object.keys(share).sort()).toEqual(["image", "title"]);
    expect(share.image).toEqual({ path, width: 1200, height: 630, focus: { x: 0.123, y: 0.5 } });
    expect(publishedDocSchema.safeParse(published).success).toBe(true);
  });

  it("drops share completely when all three fields are empty", async () => {
    const o = await owner("sp2");
    await writeDraft(o, { title: "  ", description: "", image: null });
    expect((await publish(o)).ok).toBe(true);
    const { published } = await publishedOf(admin, o.pageId);
    expect(published).not.toHaveProperty("share");
  });

  it("a card with only text publishes without any image check", async () => {
    const o = await owner("sp3");
    await writeDraft(o, { title: "Only words", description: "More words" });
    expect((await publish(o)).ok).toBe(true);
  });

  const refused: [
    string,
    (o: TestOwner, other: TestOwner) => unknown,
    string | RegExp,
    string | RegExp,
  ][] = [
    [
      "a path in another user's folder",
      (_o, other) => ({
        image: { path: `${other.userId}/img-0123456789ab.webp`, width: 1200, height: 630 },
      }),
      "share.image",
      "That image isn’t in your uploads. Upload it again.",
    ],
    [
      "an own path with no object",
      (o) => ({
        image: { path: `${o.userId}/img-${"ab".repeat(6)}.webp`, width: 1200, height: 630 },
      }),
      "share.image",
      "That image is no longer available. Upload it again.",
    ],
    [
      "a URL",
      () => ({ image: { path: "https://evil.example/x.png", width: 1200, height: 630 } }),
      "share.image.path",
      "Not a valid image reference.",
    ],
    [
      "a path with ..",
      (o, other) => ({
        image: {
          path: `${o.userId}/../${other.userId}/img-0123456789ab.webp`,
          width: 1200,
          height: 630,
        },
      }),
      "share.image.path",
      "Not a valid image reference.",
    ],
    [
      "a declared width under 600",
      (o) => ({
        image: { path: `${o.userId}/img-${"cd".repeat(6)}.webp`, width: 599, height: 300 },
      }),
      "share.image",
      "Use an image at least 600 pixels wide.",
    ],
    [
      "a focus of 5",
      (o) => ({
        image: {
          path: `${o.userId}/img-${"ef".repeat(6)}.webp`,
          width: 1200,
          height: 630,
          focus: { x: 5, y: 0.5 },
        },
      }),
      /^share\.image\.focus/,
      "Choose a focus point inside the image.",
    ],
    [
      "a 10 000-character title",
      () => ({ title: "x".repeat(10_000) }),
      "share.title",
      "Use 70 characters or fewer.",
    ],
    [
      "a 201-character description",
      () => ({ description: "y".repeat(201) }),
      "share.description",
      "Use 200 characters or fewer.",
    ],
    [
      "a line break in the title",
      () => ({ title: "one\ntwo" }),
      "share.title",
      "Remove line breaks and hidden control characters.",
    ],
    [
      "a control character in the description",
      () => ({ description: `a${String.fromCharCode(1)}b` }),
      "share.description",
      "Remove line breaks and hidden control characters.",
    ],
    [
      "a bidi override in the title",
      () => ({ title: `a${String.fromCharCode(0x202e)}b` }),
      "share.title",
      "Remove line breaks and hidden control characters.",
    ],
  ];

  it.each(refused)(
    "refuses %s with the share field and the sentence, and leaves the live page as it was",
    async (_label, share, field, message) => {
      const o = await owner("sp4");
      const other = await owner("sp4b");
      // A live page to protect, then the crafted draft.
      await writeDraft(o, { title: "Live title" });
      expect((await publish(o)).ok).toBe(true);
      const before = await publishedOf(admin, o.pageId);

      await writeDraft(o, share(o, other));
      const errors = await refusal(o);
      const hit = errors.find((error) =>
        typeof field === "string" ? error.field === field : field.test(error.field),
      );
      expect(hit, JSON.stringify(errors)).toBeDefined();
      expect(hit!.blockId).toBeNull();
      expect(hit!.message).toBe(message);
      expect(await publishedOf(admin, o.pageId)).toEqual(before);
    },
  );

  it("refuses a first publish too: nothing is written", async () => {
    const o = await owner("sp5");
    await writeDraft(o, { title: "x".repeat(71) });
    expect((await refusal(o)).map((error) => error.field)).toEqual(["share.title"]);
    expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
  });

  it("another user cannot publish this card, and a missing session cannot either", async () => {
    const a = await owner("sp6");
    const b = await owner("sp6b");
    await writeDraft(a, { title: "A's title" });
    expect(await publish(a, b.userId)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await publish(a, null as unknown as string)).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(await publishedOf(admin, a.pageId)).toEqual({ published: null, published_at: null });
  });

  it("is the same on every plan: free, pro and studio publish the same card", async () => {
    const stored: unknown[] = [];
    for (const plan of ["free", "pro", "studio"] as const) {
      const o = await owner(`sp7${plan[0]}`, plan);
      await writeDraft(o, { title: "Same title", description: "Same words" });
      expect((await publish(o)).ok, plan).toBe(true);
      stored.push((await publishedOf(admin, o.pageId)).published);
    }
    const shares = stored.map((doc) => (doc as { share: unknown }).share);
    expect(shares[1]).toEqual(shares[0]);
    expect(shares[2]).toEqual(shares[0]);
  });

  it("a suspended owner cannot publish a share card", async () => {
    const o = await owner("sp8");
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", o.userId);
    await writeDraft(o, { title: "Not live" });
    expect(await publish(o)).toMatchObject({ ok: false, reason: "account_suspended" });
    expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
  });

  it("the database takes the crafted drafts as drafts (only the size cap applies), and keeps them", async () => {
    const o = await owner("sp9");
    const crafted = {
      title: "z".repeat(10_000),
      image: { path: "https://evil.example/x.png", width: 1, height: 1 },
    };
    await writeDraft(o, crafted);
    const { data, error } = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    expect(error).toBeNull();
    expect((data!.draft as { share: unknown }).share).toEqual(crafted);
  });
});
