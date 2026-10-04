import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOCK_TYPES, publishedDocSchema, type Block } from "@/lib/document";
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
import { blocks as fixtureBlocks } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M6-45 at the Publish gate, against the local Supabase with the secret key: the abuse cases are
 * written into `pages.draft` the way a client with the publishable key could write them (the
 * database takes any draft), then Publish is attempted. A refusal names the block, the field and the
 * fix, and leaves `pages.published` and `published_at` exactly as they were; a stray font or
 * background beside a good color is dropped, not stored.
 */
const { run } = await stackIsUp();

const COLOR = "#C46A4F";
const HOSTILE = "#FFF;}</style><script>window.__x=1</script>";

describe.skipIf(!run)("M6-45 publish gate (local Supabase)", () => {
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

  const owner = async (label: string, docBlocks: Block[] = []) => {
    const made = await makeOwner(admin, label, (handle) => draftOf(handle, docBlocks));
    owners.push(made);
    return made;
  };
  const writeDraft = async (o: TestOwner, docBlocks: Block[]) => {
    const { error } = await admin
      .from("pages")
      .update({ draft: draftOf(o.handle, docBlocks) as never })
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
    return { path, width: 400, height: 400 };
  };
  const header = (id: string, overrides?: Record<string, unknown>): Block =>
    ({ ...fixtureBlocks.header, id, ...(overrides ? { overrides } : {}) }) as Block;

  it("a block of every type publishes its own style, only the ten keys, canonically", async () => {
    const o = await owner("bs1");
    const image = await upload(o);
    const stray = { fontHeading: "Geist", bg: "#000000", density: "airy", customCss: "x" };
    const style = { text: COLOR, textMuted: COLOR, radius: 20, borderWidth: 2, border: COLOR };
    const draftBlocks = BLOCK_TYPES.map(
      (type) =>
        ({
          ...fixtureBlocks[type],
          ...(type === "card" || type === "image" ? { image } : {}),
          ...(type === "book" ? { cover: image } : {}),
          overrides: { ...style, ...stray },
        }) as Block,
    );
    await writeDraft(o, draftBlocks);
    const result = await publish(o);
    expect(result.ok).toBe(true);
    const { published } = await publishedOf(admin, o.pageId);
    const doc = publishedDocSchema.parse(published);
    expect(doc.blocks.map((b) => b.type)).toEqual([...BLOCK_TYPES]);
    for (const block of doc.blocks) {
      expect(block, block.type).toHaveProperty("overrides", style);
    }
    const stored = JSON.stringify((published as { blocks: unknown }).blocks);
    expect(stored).not.toContain("Geist");
    expect(stored).not.toContain("#000000");
    expect(stored).not.toContain("customCss");
  });

  it("a header with a font, a background and a color stores only the color", async () => {
    const o = await owner("bs2");
    await writeDraft(o, [
      header("hdr-style-0001", { fontHeading: "Geist", bg: "#000000", text: COLOR }),
    ]);
    expect((await publish(o)).ok).toBe(true);
    const doc = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
    expect(doc.blocks[0]).toHaveProperty("overrides", { text: COLOR });
  });

  it("a block without a style stores no overrides, and an empty one is dropped", async () => {
    const o = await owner("bs3");
    await writeDraft(o, [header("hdr-plain-0001"), header("hdr-empty-0001", {})]);
    expect((await publish(o)).ok).toBe(true);
    const doc = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
    for (const block of doc.blocks) expect(block).not.toHaveProperty("overrides");
  });

  const messages = {
    radius: "Corner radius isn’t valid. Use 0 to 32, or reset it to the theme default.",
    borderWidth: "Border thickness isn’t valid. Use 0 to 4, or reset it to the theme default.",
    color: "Color isn’t a valid hex color. Use #RRGGBB, or reset it to the theme default.",
  };

  it.each([
    ["an image with a radius of -5", "image", { radius: -5 }, "overrides.radius", messages.radius],
    [
      "an image with a border thickness of 99",
      "image",
      { borderWidth: 99 },
      "overrides.borderWidth",
      messages.borderWidth,
    ],
    [
      "a divider with a border of 'red'",
      "divider",
      { border: "red" },
      "overrides.border",
      messages.color,
    ],
    [
      "a grid with markup in its text color",
      "grid",
      { text: HOSTILE },
      "overrides.text",
      messages.color,
    ],
    [
      "a header with markup in its text color",
      "header",
      { text: HOSTILE },
      "overrides.text",
      messages.color,
    ],
    ["an embed with a radius of 33", "embed", { radius: 33 }, "overrides.radius", messages.radius],
    [
      "a text block with a muted color of 'red'",
      "text",
      { textMuted: "red" },
      "overrides.textMuted",
      messages.color,
    ],
  ] as const)(
    "%s is refused naming the block, and pages.published stays as it was",
    async (_name, type, overrides, field, message) => {
      const o = await owner("bs4");
      const image = await upload(o);
      const good = header("hdr-good-00001", { text: COLOR });
      await writeDraft(o, [good]);
      expect((await publish(o)).ok).toBe(true);
      const before = await publishedOf(admin, o.pageId);

      const bad = {
        ...fixtureBlocks[type],
        ...(type === "image" ? { image } : {}),
        overrides,
      } as Block;
      await writeDraft(o, [good, bad]);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      if (result.ok) throw new Error("unreachable");
      expect(result.errors).toEqual([{ blockId: bad.id, field, message }]);
      const after = await publishedOf(admin, o.pageId);
      expect(after).toEqual(before);
      expect(JSON.stringify(after)).not.toContain("window.__x");
    },
  );

  it("a bad style on one block does not hide a good one: every bad block is named", async () => {
    const o = await owner("bs5");
    const image = await upload(o);
    await writeDraft(o, [
      { ...fixtureBlocks.image, image, overrides: { radius: -5, borderWidth: 99 } } as Block,
      { ...fixtureBlocks.divider, overrides: { border: "red" } } as Block,
    ]);
    const result = await publish(o);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.errors.map((e) => `${e.blockId}:${e.field}`).sort()).toEqual(
      [
        `${fixtureBlocks.image.id}:overrides.borderWidth`,
        `${fixtureBlocks.image.id}:overrides.radius`,
        `${fixtureBlocks.divider.id}:overrides.border`,
      ].sort(),
    );
  });
});
