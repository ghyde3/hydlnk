import { describe, expect, it } from "vitest";
import { draftDocSchema } from "@/lib/document";
import { loadDraft } from "@/lib/editor/load";
import { blocks, draftWith } from "./fixtures/page-document";

/**
 * M6-45: a draft written straight to the database can hold a bad style on a block (a radius of -5, a
 * color that is not a hex literal, markup in a hex field). The editor's loader keeps the block and
 * drops only the bad setting, so the editor and its preview show the block with the theme default
 * and never draw the value; it is not dropped for the sake of one optional setting.
 */

const COLOR = "#C46A4F";
const HOSTILE = "#FFF;}</style><script>window.__x=1</script>";

const BAD = [
  ["image", { radius: -5 }],
  ["image", { borderWidth: 99 }],
  ["divider", { border: "red" }],
  ["grid", { text: HOSTILE }],
  ["header", { text: HOSTILE }],
  ["text", { textMuted: "url(javascript:alert(1))" }],
  ["embed", { radius: "20px; background:url(//evil.example)" }],
  ["social", { border: 5 }],
] as const;

describe("M6-45 loading a draft with a bad block style", () => {
  it.each(BAD)("%s with %j keeps the block and loses the style", (type, overrides) => {
    const raw = draftWith(
      { ...blocks[type], overrides },
      { ...blocks.divider, id: "divider-0002" },
    );
    const loaded = loadDraft(raw, "mara");
    expect(loaded.repaired).toBe(true);
    const kept = loaded.draft.blocks.find((b) => b.id === blocks[type].id);
    expect(kept).toBeDefined();
    expect(kept).not.toHaveProperty("overrides");
    // The rest of the block is what was stored.
    expect({ ...kept, overrides: undefined }).toEqual({ ...blocks[type], overrides: undefined });
    expect(loaded.draft.blocks).toHaveLength(2);
    expect(draftDocSchema.safeParse(loaded.draft).success).toBe(true);
    expect(JSON.stringify(loaded.draft)).not.toContain("__x");
  });

  it("a valid key beside a bad one stays; a font beside them does not", () => {
    const raw = draftWith({
      ...blocks.image,
      overrides: { radius: 20, borderWidth: 99, fontHeading: "Geist", border: COLOR },
    });
    const loaded = loadDraft(raw, "mara");
    expect(loaded.draft.blocks[0]).toHaveProperty("overrides", { radius: 20, border: COLOR });
  });

  it("other blocks keep their own valid styles", () => {
    const raw = draftWith(
      { ...blocks.image, overrides: { radius: -5 } },
      { ...blocks.header, overrides: { text: COLOR } },
    );
    const loaded = loadDraft(raw, "mara");
    expect(loaded.draft.blocks[0]).not.toHaveProperty("overrides");
    expect(loaded.draft.blocks[1]).toHaveProperty("overrides", { text: COLOR });
  });

  it("a block that is invalid for another reason is still dropped", () => {
    const raw = draftWith(
      { ...blocks.image, alt: 5, overrides: { radius: -5 } },
      { ...blocks.header, overrides: { text: COLOR } },
    );
    const loaded = loadDraft(raw, "mara");
    expect(loaded.draft.blocks.map((b) => b.id)).toEqual([blocks.header.id]);
  });

  it("a valid draft with overrides on every type loads as stored, not repaired", () => {
    const raw = draftWith(
      ...(Object.values(blocks) as object[]).map((block) => ({
        ...block,
        overrides: { text: COLOR, radius: 20, borderWidth: 2 },
      })),
    );
    const loaded = loadDraft(raw, "mara");
    expect(loaded.repaired).toBe(false);
    for (const block of loaded.draft.blocks) {
      expect(block).toHaveProperty("overrides", { text: COLOR, radius: 20, borderWidth: 2 });
    }
  });
});
