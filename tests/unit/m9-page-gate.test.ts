import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishedDocSchema, type Block, type DraftDoc } from "@/lib/document";
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
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M9-23 and M9-24 at the Publish gate, against the local Supabase with the secret key: the abuse
 * cases are written into `pages.draft` the way a client with the publishable key could write them
 * (the database takes any draft that passes its own size and blocklist triggers), then Publish is
 * attempted. A refusal names the field and leaves `pages.published` exactly as it was.
 */
const { run } = await stackIsUp();

const link = (id: string, extra: Record<string, unknown> = {}): Block =>
  ({
    id,
    type: "link",
    visible: true,
    label: "Book",
    url: "https://example.com/book",
    ...extra,
  }) as Block;
const BANNER = {
  id: "banner-gate-01",
  visible: true,
  text: "  Free shipping  ",
  label: " Shop ",
  url: " https://shop.example/sale ",
};

describe.skipIf(!run)("M9-23 and M9-24 publish gate (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];
  const objects: string[] = [];
  const blockedDomains: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
  });

  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    if (blockedDomains.length > 0) {
      await admin.from("blocked_domains").delete().in("domain", blockedDomains);
    }
    await removeOwners(admin, owners);
  });

  const owner = async (label: string) => {
    const made = await makeOwner(admin, label, (handle) => draftOf(handle, [link("lnk-aaaaaaaa")]));
    owners.push(made);
    return made;
  };
  const writeDraft = async (
    o: TestOwner,
    extra: Partial<DraftDoc> | Record<string, unknown> = {},
    profile: Record<string, unknown> = {},
  ) => {
    const base = draftOf(o.handle, [link("lnk-aaaaaaaa")]);
    const { error } = await admin
      .from("pages")
      .update({ draft: { ...base, profile: { ...base.profile, ...profile }, ...extra } as never })
      .eq("id", o.pageId);
    expect(error).toBeNull();
  };
  const publish = (o: TestOwner) =>
    core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
  const upload = async (o: TestOwner) => {
    const path = `${o.userId}/avatar-${rand(12).padEnd(12, "a")}.webp`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, makePng(8, 8), { contentType: "image/webp" });
    expect(error).toBeNull();
    objects.push(path);
    return { path, width: 600, height: 200 };
  };
  const refused = async (o: TestOwner) => {
    const result = await publish(o);
    if (result.ok) throw new Error("published a draft the gate must refuse");
    return result;
  };
  const NOTHING = { published: null, published_at: null };

  describe("the support banner", () => {
    it("publishes trimmed, with visible true, and a removed banner leaves no key after a republish", async () => {
      const o = await owner("bn1");
      await writeDraft(o, { banner: BANNER });
      expect((await publish(o)).ok).toBe(true);
      const first = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
      expect(first.banner).toEqual({
        id: "banner-gate-01",
        visible: true,
        text: "Free shipping",
        label: "Shop",
        url: "https://shop.example/sale",
      });
      await writeDraft(o);
      expect((await publish(o)).ok).toBe(true);
      const second = (await publishedOf(admin, o.pageId)).published as Record<string, unknown>;
      expect("banner" in second).toBe(false);
    });

    it("a hidden banner (even a bad one) does not stop Publish and is not published", async () => {
      const o = await owner("bn2");
      await writeDraft(o, { banner: { ...BANNER, visible: false, url: "javascript:alert(1)" } });
      expect((await publish(o)).ok).toBe(true);
      const stored = JSON.stringify((await publishedOf(admin, o.pageId)).published);
      expect(stored).not.toContain("javascript");
      expect(stored).not.toContain("Free shipping");
    });

    it.each([
      ["a message of 5,000 characters", { ...BANNER, text: "x".repeat(5000) }, "banner.text"],
      ["a data: address", { ...BANNER, url: "data:text/html,x" }, "banner.url"],
      ["a javascript: address", { ...BANNER, url: "javascript:alert(1)" }, "banner.url"],
      ["a protocol-relative address", { ...BANNER, url: "//evil.example" }, "banner.url"],
      [
        "a 4,000-character address",
        { ...BANNER, url: `https://x.example/${"a".repeat(4000)}` },
        "banner.url",
      ],
      ["a link without a label", { ...BANNER, label: "" }, "banner.label"],
      ["a label without a link", { ...BANNER, url: "" }, "banner.url"],
      ["a link with no message", { ...BANNER, text: "" }, "banner.text"],
    ])(
      "%s is refused with the field named, and published stays as it was",
      async (_name, banner, field) => {
        const o = await owner("bn3");
        await writeDraft(o, { banner });
        const result = await refused(o);
        expect(result.reason).toBe("invalid");
        expect(result.errors.map((e) => e.field)).toContain(field);
        expect(await publishedOf(admin, o.pageId)).toEqual(NOTHING);
      },
    );

    it("an id that equals a block's id is refused: ids must be unique within a page", async () => {
      const o = await owner("bn4");
      await writeDraft(o, { banner: { ...BANNER, id: "lnk-aaaaaaaa" } });
      const result = await refused(o);
      expect(result.errors).toEqual([
        { blockId: "lnk-aaaaaaaa", field: "id", message: "Ids must be unique within a page." },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual(NOTHING);
    });

    it("a link to a site blocked after the draft was saved is refused at Publish, naming the banner", async () => {
      const o = await owner("bn5");
      const domain = `bn${rand(8)}.example`;
      await writeDraft(o, { banner: { ...BANNER, url: `https://${domain}/sale` } });
      const inserted = await admin.from("blocked_domains").insert({ domain, reason: "test" });
      expect(inserted.error).toBeNull();
      blockedDomains.push(domain);
      const result = await refused(o);
      expect(result.reason).toBe("blocked_link");
      expect(result.errors).toEqual([
        {
          blockId: "banner",
          itemId: "banner-gate-01",
          field: "url",
          message: "That site is blocked. Use a different link.",
          host: domain,
        },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual(NOTHING);
    });
  });

  describe("the logo, and the name's font and size", () => {
    it("a logo in the owner's folder publishes as {path, width, height}, with the defaults left out", async () => {
      const o = await owner("lg1");
      const logo = await upload(o);
      await writeDraft(
        o,
        {},
        {
          logo: { ...logo, focus: { x: 0.1, y: 0.9 } },
          logoPlacement: "beside",
          nameSize: "medium",
          nameFont: "Fraunces",
        },
      );
      expect((await publish(o)).ok).toBe(true);
      const doc = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
      expect(doc.profile.logo).toEqual(logo);
      expect(doc.profile.nameFont).toBe("Fraunces");
      expect("logoPlacement" in doc.profile).toBe(false);
      expect("nameSize" in doc.profile).toBe(false);
    });

    it("a logo in another account's folder is refused: that image isn't yours", async () => {
      const o = await owner("lg2");
      const stranger = await owner("lg3");
      const theirs = await upload(stranger);
      await writeDraft(o, {}, { logo: theirs });
      const result = await refused(o);
      expect(result.errors).toEqual([
        {
          blockId: null,
          field: "profile.logo",
          message: "That image isn’t in your uploads. Upload it again.",
        },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual(NOTHING);
    });

    it("a logo whose object is gone is refused: no longer available", async () => {
      const o = await owner("lg4");
      await writeDraft(
        o,
        {},
        {
          logo: { path: `${o.userId}/avatar-0123456789ab.webp`, width: 600, height: 200 },
        },
      );
      const result = await refused(o);
      expect(result.errors).toEqual([
        {
          blockId: null,
          field: "profile.logo",
          message: "That image is no longer available. Upload it again.",
        },
      ]);
    });

    it.each([
      ["a path that climbs out", (uid: string) => `${uid}/../x/avatar-0123456789ab.webp`],
      ["a URL", () => "https://evil.example/a.png"],
      [
        "user B's folder named by hand",
        () => "00000000-0000-4000-8000-00000000000b/avatar-0123456789ab.webp",
      ],
    ])("a logo that is %s never publishes", async (_name, make) => {
      const o = await owner("lg5");
      await writeDraft(o, {}, { logo: { path: make(o.userId), width: 600, height: 200 } });
      const result = await refused(o);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every((e) => e.field.startsWith("profile.logo"))).toBe(true);
      expect(await publishedOf(admin, o.pageId)).toEqual(NOTHING);
    });

    it.each([
      ["nameFont", "Comic Sans", "profile.nameFont", "Pick a font from the list."],
      [
        "nameFont",
        "x;}</style><script>alert(1)</script>",
        "profile.nameFont",
        "Pick a font from the list.",
      ],
      ["nameSize", "huge", "profile.nameSize", "Pick a size from the list."],
      ["logoPlacement", "left", "profile.logoPlacement", "Pick where the logo goes."],
    ])(
      "%s %j is refused with the field named and nothing published",
      async (key, value, field, message) => {
        const o = await owner("lg6");
        await writeDraft(o, {}, { [key]: value });
        const result = await refused(o);
        expect(result.errors).toEqual([{ blockId: null, field, message }]);
        expect(await publishedOf(admin, o.pageId)).toEqual(NOTHING);
      },
    );
  });
});
