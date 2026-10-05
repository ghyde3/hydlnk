import { describe, expect, it } from "vitest";
import { PROFILE_OPTION_DEFAULTS, draftDocSchema, emptyDraft } from "@/lib/document";
import { loadDraft, revKeyOf } from "@/lib/editor/load";
import { blocks, fullDraft } from "./fixtures/page-document";

/**
 * M2-03: the editor opens whatever `pages.draft` holds. A valid draft is used as it is (raw strings
 * kept); anything else is repaired to the nearest valid document with `repaired` set, and nothing
 * is written until the user edits.
 */

describe("loadDraft: valid drafts", () => {
  it("uses a valid draft as it is and does not flag it", () => {
    const loaded = loadDraft(fullDraft, "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft).toEqual(fullDraft);
    expect(loaded.revKey).toBe("7");
  });

  it("keeps the raw strings: the schemas trim, the editor must not", () => {
    const raw = {
      ...fullDraft,
      profile: { name: "  Mara  ", bio: "trailing space ", photo: null },
      blocks: [{ ...blocks.link, label: " spaced label " }],
    };
    const loaded = loadDraft(raw, "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.profile.name).toBe("  Mara  ");
    expect(loaded.draft.profile.bio).toBe("trailing space ");
    expect(loaded.draft.blocks[0]).toMatchObject({ label: " spaced label " });
  });

  it("accepts what signup creates: the handle as name, no bio, no blocks", () => {
    const loaded = loadDraft(emptyDraft("mara"), "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.profile).toEqual({
      name: "mara",
      bio: "",
      photo: null,
      ...PROFILE_OPTION_DEFAULTS,
    });
    expect(loaded.draft.blocks).toEqual([]);
    expect(loaded.revKey).toBe("0");
  });

  it("makes `visible` explicit (the schema defaults it, the state always carries it)", () => {
    const { visible: _visible, ...noVisible } = blocks.header;
    void _visible;
    const loaded = loadDraft({ ...emptyDraft("mara"), blocks: [noVisible] }, "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.blocks[0]).toMatchObject({ id: blocks.header.id, visible: true });
  });
});

describe("loadDraft: corrupted drafts", () => {
  it("repairs {} to defaults: display name = handle, empty bio, no photo, no blocks", () => {
    const loaded = loadDraft({}, "mara");
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft).toEqual({ ...emptyDraft("mara"), rev: 0 });
    expect(loaded.revKey).toBeNull();
    expect(draftDocSchema.safeParse(loaded.draft).success).toBe(true);
  });

  it('repairs {"blocks": 5}', () => {
    const loaded = loadDraft({ blocks: 5 }, "mara");
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.blocks).toEqual([]);
    expect(loaded.draft.profile.name).toBe("mara");
    expect(loaded.revKey).toBeNull();
  });

  it.each([null, [], "x", 5, true])("repairs a non-object draft (%j)", (raw) => {
    const loaded = loadDraft(raw, "jonas");
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.profile.name).toBe("jonas");
    expect(draftDocSchema.safeParse(loaded.draft).success).toBe(true);
  });

  it("keeps what reads and drops what does not: a good profile survives a bad block", () => {
    const loaded = loadDraft(
      {
        ...fullDraft,
        blocks: [
          blocks.link,
          { id: "bad-block-01", type: "teleporter", visible: true },
          blocks.header,
        ],
      },
      "mara",
    );
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.profile.name).toBe("Mara Okafor");
    expect(loaded.draft.blocks.map((b) => b.id)).toEqual([blocks.link.id, blocks.header.id]);
    expect(loaded.revKey).toBe("7");
    expect(loaded.draft.rev).toBe(7);
  });

  it("drops a block that repeats an id (ids are analytics keys)", () => {
    const loaded = loadDraft(
      { ...fullDraft, blocks: [blocks.link, { ...blocks.header, id: blocks.link.id }] },
      "mara",
    );
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.blocks).toHaveLength(1);
  });

  it("cuts an over-long name to 60 code points and puts a bad photo back to none", () => {
    const loaded = loadDraft(
      { ...fullDraft, profile: { name: "😀".repeat(70), bio: "ok", photo: { path: "x" } } },
      "mara",
    );
    expect(loaded.repaired).toBe(true);
    expect(Array.from(loaded.draft.profile.name)).toHaveLength(60);
    expect(loaded.draft.profile.photo).toBeNull();
    expect(loaded.draft.profile.bio).toBe("ok");
  });

  it("keeps at most 50 blocks", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...blocks.divider,
      id: `divider-${String(i).padStart(4, "0")}`,
    }));
    const loaded = loadDraft({ ...fullDraft, blocks: many }, "mara");
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.blocks).toHaveLength(50);
  });
});

describe("loadDraft: the site's menu (M11-07)", () => {
  const nav = { show: false, items: ["00000000-0000-4000-8000-0000000000c1"] };

  it("keeps Home's nav on a valid draft, so the next autosave does not erase it", () => {
    const loaded = loadDraft({ ...fullDraft, nav }, "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.nav).toEqual(nav);
  });

  it("keeps a nav that reads when the rest of the draft is repaired, and drops one that does not", () => {
    const broken = { ...fullDraft, nav, blocks: 5 };
    expect(loadDraft(broken, "mara")).toMatchObject({ repaired: true, draft: { nav } });
    const badNav = { ...fullDraft, nav: { show: true, items: ["not-an-id"] }, blocks: 5 };
    expect(loadDraft(badNav, "mara").draft.nav).toBeUndefined();
  });

  it("invents no nav for a draft that has none", () => {
    expect("nav" in loadDraft(fullDraft, "mara").draft).toBe(false);
  });
});

describe("revKeyOf", () => {
  it("is what Postgres draft->>'rev' returns", () => {
    expect(revKeyOf({ rev: 5 })).toBe("5");
    expect(revKeyOf({ rev: 0 })).toBe("0");
    expect(revKeyOf({})).toBeNull();
    expect(revKeyOf({ rev: null })).toBeNull();
    expect(revKeyOf([])).toBeNull();
    expect(revKeyOf("x")).toBeNull();
    expect(revKeyOf({ rev: "abc" })).toBe("abc");
  });
});
