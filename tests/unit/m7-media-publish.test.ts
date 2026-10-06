import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, PublishDoc } from "@/lib/document";
import {
  draftOf,
  makeOwner,
  publishedOf,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M7-15: the stored form of a background image does not change, and Publish still enforces it.
 * A background is stored as the full Storage URL (`storageUrl`); the relative `/media/...` address
 * the browser loads is made at render time and is never accepted as a value. Against the local
 * Supabase with the secret key, through `publishPageCore` (the gate behind the Publish button),
 * with a draft written straight into `pages.draft` the way a client holding the publishable key can.
 */
const { run } = await stackIsUp();

const link = (): Block =>
  ({
    id: "lnk-aaaaaaaa",
    type: "link",
    visible: true,
    label: "Book",
    url: "https://example.com/book",
  }) as Block;

describe.skipIf(!run)("M7-15 Publish and the stored form of a background image", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let url: typeof import("@/lib/media/url");
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
    url = await import("@/lib/media/url");
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  async function stage(label: string, bgImage: (userId: string) => string) {
    const owner = await makeOwner(admin, label);
    owners.push(owner);
    const draft = draftOf("A", [link()], {
      theme: {
        ref: null,
        overrides: { bgType: "image", bgImage: bgImage(owner.userId) },
      },
    });
    const { error } = await admin
      .from("pages")
      .update({ draft: draft as never })
      .eq("id", owner.pageId);
    expect(error).toBeNull();
    return owner;
  }
  const publish = (o: TestOwner) =>
    core.publishPageCore(
      { pageId: o.pageId, userId: o.userId },
      { admin, mediaExists: async () => true },
    );

  it("a background stored as the Storage URL publishes, and is frozen as that same URL", async () => {
    const file = "abcdef12-0001.png";
    const o = await stage("mp1", (uid) => url.storageUrl(`${uid}/${file}`));
    const result = await publish(o);
    expect(result.ok).toBe(true);
    const published = (await publishedOf(admin, o.pageId)).published as PublishDoc;
    expect(published.tokens.bgImage).toBe(url.storageUrl(`${o.userId}/${file}`));
    expect(JSON.stringify(published)).not.toContain("/media/");
  });

  it("a relative /media address as the background is refused by Publish, and nothing is written", async () => {
    const o = await stage("mp2", (uid) => url.mediaUrl(`${uid}/abcdef12-0002.png`));
    const before = await publishedOf(admin, o.pageId);
    const result = await publish(o);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    const hit = result.errors.find((error) => error.field === "theme.overrides.bgImage");
    expect(hit, JSON.stringify(result.errors)).toBeDefined();
    expect(hit!.message).toMatch(/isn’t one of your uploaded images/);
    expect(await publishedOf(admin, o.pageId)).toEqual(before);
  });
});
