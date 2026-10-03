import { describe, expect, it, vi } from "vitest";
import {
  BLOCK_ID_PATTERN,
  BLOCK_TYPES,
  LIMITS,
  blockDefaults,
  changeSocialPlatform,
  codePointLength,
  collectImageRefs,
  draftDocSchema,
  emptyDraft,
  newBlockId,
  newGridCell,
  newSocialIcon,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  singleLine,
  toPublishForm,
  truncateToCodePoints,
  type DraftDoc,
} from "@/lib/document";
import {
  SYSTEM_DEFAULT_TOKENS,
  TOKEN_KEYS,
  resolveTokens,
  tokenSetSchema,
  type TokenSet,
} from "@/lib/theme";
import {
  bannerRef,
  blocks,
  fullDraft,
  fullPublished,
  noirTokens,
  photoRef,
} from "./fixtures/page-document";

const clone = <T>(value: T): T => structuredClone(value);
const form = (draft: DraftDoc) => toPublishForm(draft, noirTokens);

describe("toPublishForm", () => {
  it("keeps visible blocks only, in order, and drops rev", () => {
    expect(fullPublished.blocks.map((b) => b.id)).toEqual(
      fullDraft.blocks.filter((b) => b.visible).map((b) => b.id),
    );
    expect(fullPublished.blocks.some((b) => b.id === "header-hidden-1")).toBe(false);
    expect(Object.keys(fullPublished).sort()).toEqual([
      "blocks",
      "profile",
      "theme",
      "tokens",
      "version",
    ]);
    expect(fullPublished).not.toHaveProperty("rev");
    expect(fullPublished.blocks.every((b) => b.visible === true)).toBe(true);
  });

  it("a hidden block's text and URL are absent from the form", () => {
    const doc = clone(fullDraft);
    doc.blocks.push({
      ...blocks.link,
      id: "link-hidden-01",
      visible: false,
      label: "HIDDEN-LABEL",
      url: "https://hidden.example/x",
    });
    const json = JSON.stringify(form(doc));
    expect(json).not.toContain("HIDDEN-LABEL");
    expect(json).not.toContain("hidden.example");
    expect(
      form({ ...doc, blocks: doc.blocks.map((b) => ({ ...b, visible: false })) }).blocks,
    ).toEqual([]);
  });

  it("freezes every token, resolved: system default, then theme, then page overrides", () => {
    const theme = { ...noirTokens, accent: "#111111", radius: 6, bg: "#222222" };
    const doc = clone(fullDraft);
    doc.theme.overrides = { accent: "#C46A4F" };
    const tokens = toPublishForm(doc, theme).tokens;
    expect(Object.keys(tokens).sort()).toEqual([...TOKEN_KEYS].sort());
    expect(tokens.accent).toBe("#C46A4F"); // page override beats the theme
    expect(tokens.radius).toBe(6); // theme beats the default
    expect(tokens.bg).toBe("#222222");
    expect(tokens.maxWidth).toBe(SYSTEM_DEFAULT_TOKENS.maxWidth);
    expect(Object.values(tokens).filter((v) => v === undefined)).toEqual([]);
    expect(tokenSetSchema.safeParse(tokens).success).toBe(true);
    expect(tokens).toEqual(resolveTokens(theme, doc.theme.overrides));
  });

  it("falls back to the system default when there is no theme (null, or a deleted theme row)", () => {
    const doc = clone(fullDraft);
    doc.theme.overrides = { radius: 20 };
    expect(toPublishForm(doc, null).tokens).toEqual({ ...SYSTEM_DEFAULT_TOKENS, radius: 20 });
    // a theme row that lacks keys still resolves to a complete token set
    expect(toPublishForm(doc, { accent: "#123456" }).tokens).toEqual({
      ...SYSTEM_DEFAULT_TOKENS,
      accent: "#123456",
      radius: 20,
    });
  });

  it("an overridden block carries its override values, and only the allowed keys", () => {
    const doc = clone(fullDraft);
    doc.theme.overrides = { buttonStyle: "fill" };
    const link = toPublishForm(doc, noirTokens).blocks.find((b) => b.id === "link-portraits");
    expect(link).toMatchObject({
      overrides: { buttonStyle: "pill", accent: "#9DB3C4", radius: 4 },
    });
    const sneaky = clone(doc);
    (sneaky.blocks[2] as unknown as { overrides: Record<string, unknown> }).overrides = {
      buttonStyle: "pill",
      fontHeading: "Geist",
      bg: "#000000",
      radius: undefined,
    };
    const out = toPublishForm(sneaky, noirTokens).blocks.find((b) => b.id === "link-portraits");
    expect((out as { overrides: object }).overrides).toEqual({ buttonStyle: "pill" });
    (sneaky.blocks[2] as unknown as { overrides: object }).overrides = { fontHeading: "Geist" };
    expect(
      toPublishForm(sneaky, noirTokens).blocks.find((b) => b.id === "link-portraits"),
    ).not.toHaveProperty("overrides");
  });

  it("is canonical: trimmed, no unknown keys, empty optional link omitted", () => {
    const doc = clone(fullDraft) as unknown as {
      profile: Record<string, unknown>;
      blocks: Record<string, unknown>[];
    };
    doc.profile.name = "  Mara  ";
    doc.profile.badge = false;
    doc.blocks = [
      { ...blocks.link, label: " hi ", url: " https://a.example/x ", settings: { x: 1 } },
      { ...blocks.image, url: "" },
      { ...blocks.image, id: "image-nolink-1", url: undefined },
      { ...blocks.header, text: " t " },
    ];
    const out = toPublishForm(doc as unknown as DraftDoc, null);
    expect(out.profile.name).toBe("Mara");
    expect(out.profile).not.toHaveProperty("badge");
    expect(out.blocks[0]).toEqual({
      id: "link-portraits",
      visible: true,
      type: "link",
      label: "hi",
      url: "https://a.example/x",
    });
    expect(out.blocks[1]).not.toHaveProperty("url");
    expect(out.blocks[2]).not.toHaveProperty("url");
    expect(out.blocks[3]).toMatchObject({ text: "t" });
    expect(publishedDocSchema.safeParse(out).success).toBe(true);
  });

  it("is pure: never mutates the draft or the theme, and equal drafts give equal forms", () => {
    const draft = clone(fullDraft);
    const theme = clone(noirTokens);
    const first = toPublishForm(draft, theme);
    expect(draft).toEqual(fullDraft);
    expect(theme).toEqual(noirTokens);
    expect(toPublishForm(clone(fullDraft), clone(noirTokens))).toEqual(first);
    first.profile.name = "changed";
    first.tokens.accent = "#000000";
    (first.blocks[0] as unknown as { icons: { url: string }[] }).icons[0]!.url = "x";
    expect(toPublishForm(fullDraft, noirTokens)).toEqual(fullPublished);
    expect(fullDraft.profile.name).toBe("Mara Okafor");
  });

  it("passes the stored-form schema after a JSON round trip (jsonb), key order aside", () => {
    const stored = JSON.parse(JSON.stringify(fullPublished));
    const parsed = publishedDocSchema.parse(stored);
    expect(publishFormsEqual(parsed, fullPublished)).toBe(true);
    expect(
      publishFormsEqual(
        parsed,
        toPublishForm(draftDocSchema.parse(JSON.parse(JSON.stringify(fullDraft))), noirTokens),
      ),
    ).toBe(true);
    // publishDocSchema.parse(draft) -> toPublishForm -> publishedDocSchema: the gate's pipeline
    const gate = publishDocSchema.parse(fullDraft);
    expect(publishedDocSchema.safeParse(toPublishForm(gate, noirTokens)).success).toBe(true);
  });
});

describe("the status chip comparison (M2-27)", () => {
  const published = JSON.parse(JSON.stringify(fullPublished));
  const same = (draft: DraftDoc, theme: Partial<TokenSet> | null = noirTokens) =>
    publishFormsEqual(toPublishForm(draft, theme), published);

  it("a draft equal to what was published is 'Published'", () => {
    expect(same(fullDraft)).toBe(true);
  });

  it("rev, and edits to a block that is hidden in the draft, change nothing", () => {
    expect(same({ ...clone(fullDraft), rev: 99 })).toBe(true);
    const doc = clone(fullDraft);
    (doc.blocks[doc.blocks.length - 1] as { text: string }).text = "Edited while hidden";
    expect(same(doc)).toBe(true);
    // key order of the stored JSON does not matter either
    const reordered = Object.fromEntries(Object.entries(published).reverse());
    expect(publishFormsEqual(toPublishForm(fullDraft, noirTokens), reordered)).toBe(true);
  });

  it("editing the bio, reordering and toggling visibility change it, and undoing returns it", () => {
    const edited = clone(fullDraft);
    edited.profile.bio += "!";
    expect(same(edited)).toBe(false);
    edited.profile.bio = fullDraft.profile.bio;
    expect(same(edited)).toBe(true);

    const reordered = clone(fullDraft);
    [reordered.blocks[0], reordered.blocks[1]] = [reordered.blocks[1]!, reordered.blocks[0]!];
    expect(same(reordered)).toBe(false);

    const toggled = clone(fullDraft);
    toggled.blocks[0]!.visible = false;
    expect(same(toggled)).toBe(false);
    const shown = clone(fullDraft);
    shown.blocks[shown.blocks.length - 1]!.visible = true;
    expect(same(shown)).toBe(false);
  });

  it("a change to the theme row flips it though no draft field changed", () => {
    expect(same(fullDraft, { ...noirTokens, bg: "#000000" })).toBe(false);
    expect(same(fullDraft, null)).toBe(false);
  });

  it("a page that was never published differs from everything", () => {
    expect(publishFormsEqual(toPublishForm(fullDraft, noirTokens), null)).toBe(false);
  });
});

describe("publishFormsEqual", () => {
  it("compares JSON deeply, ignoring key order and undefined keys", () => {
    expect(
      publishFormsEqual(
        { a: 1, b: { c: [1, 2, { d: null }] } },
        { b: { c: [1, 2, { d: null }] }, a: 1 },
      ),
    ).toBe(true);
    expect(publishFormsEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(publishFormsEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(publishFormsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(publishFormsEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(publishFormsEqual({ a: null }, { a: undefined })).toBe(false);
    expect(publishFormsEqual({ a: 1 }, null)).toBe(false);
    expect(publishFormsEqual([], {})).toBe(false);
    expect(publishFormsEqual(1, 1)).toBe(true);
  });
});

describe("block defaults (M2-10)", () => {
  it("has one default per block type, each with a fresh id", () => {
    expect(Object.keys(blockDefaults).sort()).toEqual([...BLOCK_TYPES].sort());
    for (const type of BLOCK_TYPES) {
      const a = blockDefaults[type]();
      const b = blockDefaults[type]();
      expect(a.type).toBe(type);
      expect(a.visible).toBe(true);
      expect(a.id).toMatch(BLOCK_ID_PATTERN);
      expect(a.id).not.toBe(b.id);
    }
  });

  it("has the content of the spec", () => {
    const strip = <T extends { id: string }>(value: T) => {
      const { id: _id, ...rest } = value;
      void _id;
      return rest;
    };
    expect(strip(blockDefaults.link())).toEqual({
      type: "link",
      visible: true,
      label: "New link",
      url: "",
    });
    expect(strip(blockDefaults.card())).toEqual({
      type: "card",
      visible: true,
      title: "New card",
      caption: "",
      url: "",
      image: null,
    });
    expect(strip(blockDefaults.header())).toEqual({
      type: "header",
      visible: true,
      text: "New section",
    });
    expect(strip(blockDefaults.text())).toEqual({
      type: "text",
      visible: true,
      text: "New text block",
    });
    expect(strip(blockDefaults.image())).toEqual({
      type: "image",
      visible: true,
      image: null,
      alt: "",
      url: "",
    });
    expect(strip(blockDefaults.embed())).toEqual({
      type: "embed",
      visible: true,
      url: "",
      caption: "Video or music",
    });
    expect(strip(blockDefaults.divider())).toEqual({ type: "divider", visible: true });
    const social = blockDefaults.social();
    expect(social).toMatchObject({ type: "social", icons: [{ platform: "instagram", url: "" }] });
    const grid = blockDefaults.grid();
    expect(grid.type === "grid" && grid.cells.map(strip)).toEqual([
      { title: "", subtitle: "", url: "" },
      { title: "", subtitle: "", url: "" },
    ]);
  });

  it("every default passes the draft schema, alone and all together, with unique ids", () => {
    const all = BLOCK_TYPES.map((type) => blockDefaults[type]());
    const doc = { ...emptyDraft("mara"), blocks: all };
    expect(draftDocSchema.safeParse(doc).success).toBe(true);
    for (const block of all) {
      expect(
        draftDocSchema.safeParse({ ...emptyDraft("mara"), blocks: [block] }).success,
        block.type,
      ).toBe(true);
    }
    // 50 of them is the limit; ids stay unique even with icons and cells
    const fifty = Array.from({ length: LIMITS.blocks }, (_, i) =>
      blockDefaults[BLOCK_TYPES[i % 9]!](),
    );
    expect(draftDocSchema.safeParse({ ...emptyDraft("mara"), blocks: fifty }).success).toBe(true);
  });

  it("header, text and divider defaults are publishable; the rest wait for content", () => {
    for (const type of BLOCK_TYPES) {
      const ok = publishDocSchema.safeParse({
        ...emptyDraft("mara"),
        blocks: [blockDefaults[type]()],
      }).success;
      expect(ok, type).toBe(type === "header" || type === "text" || type === "divider");
    }
  });
});

describe("emptyDraft", () => {
  it("is the first draft of a new page", () => {
    expect(emptyDraft("mara")).toEqual({
      version: 1,
      rev: 0,
      profile: {
        name: "mara",
        bio: "",
        photo: null,
        photoShape: "circle",
        photoSize: "medium",
        photoBorder: "page",
        showPhoto: true,
        showName: true,
        showBio: true,
      },
      theme: { ref: null, overrides: {} },
      blocks: [],
    });
    expect(draftDocSchema.safeParse(emptyDraft("zq-ok-1a2b3c")).success).toBe(true);
    expect(publishDocSchema.safeParse(emptyDraft("mara")).success).toBe(true);
    expect(emptyDraft("a")).not.toBe(emptyDraft("a"));
  });

  it("publishes as an empty page on the system default tokens", () => {
    const out = toPublishForm(emptyDraft("mara"), null);
    expect(out.blocks).toEqual([]);
    expect(out.tokens).toEqual(SYSTEM_DEFAULT_TOKENS);
    expect(publishedDocSchema.safeParse(out).success).toBe(true);
  });
});

describe("newBlockId", () => {
  it("is 8-24 characters of A-Za-z0-9_-", () => {
    for (let i = 0; i < 500; i++) expect(newBlockId()).toMatch(BLOCK_ID_PATTERN);
  });

  it("does not collide", () => {
    const seen = new Set(Array.from({ length: 20000 }, () => newBlockId()));
    expect(seen.size).toBe(20000);
  });

  it("uses crypto.getRandomValues, not Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const crypto = vi.spyOn(globalThis.crypto, "getRandomValues");
    newBlockId();
    expect(crypto).toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    crypto.mockRestore();
  });

  it("covers the whole alphabet", () => {
    const chars = new Set(Array.from({ length: 4000 }, () => newBlockId()).join(""));
    expect(chars.size).toBe(64);
  });
});

describe("nested ids and platform changes", () => {
  it("new icons and cells have valid fresh ids", () => {
    const icon = newSocialIcon();
    const cell = newGridCell();
    expect(icon).toMatchObject({ platform: "instagram", url: "" });
    expect(icon.id).toMatch(BLOCK_ID_PATTERN);
    expect(newSocialIcon("email")).toMatchObject({ platform: "email", address: "" });
    expect(cell).toMatchObject({ title: "", subtitle: "", url: "" });
    expect(cell.id).toMatch(BLOCK_ID_PATTERN);
  });

  it("changing a platform keeps the id and swaps url and address only across email", () => {
    const web = {
      id: "icon-web-0001",
      platform: "instagram",
      url: "https://instagram.com/a",
    } as const;
    expect(changeSocialPlatform(web, "tiktok")).toEqual({
      id: web.id,
      platform: "tiktok",
      url: web.url,
    });
    expect(changeSocialPlatform(web, "email")).toEqual({
      id: web.id,
      platform: "email",
      address: "",
    });
    const mail = { id: "icon-mail-0001", platform: "email", address: "a@b.co" } as const;
    expect(changeSocialPlatform(mail, "website")).toEqual({
      id: mail.id,
      platform: "website",
      url: "",
    });
    expect(changeSocialPlatform(web, "instagram")).toBe(web);
  });
});

describe("code point helpers", () => {
  it("codePointLength counts emoji as one", () => {
    expect(codePointLength("")).toBe(0);
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength("👍")).toBe(1);
    expect(codePointLength("👨‍👩‍👧")).toBe(5); // family emoji: 3 people + 2 joiners
    expect(codePointLength("é")).toBe(1);
    expect(codePointLength("a👍b")).toBe(3);
    expect("👍".length).toBe(2);
  });

  it("truncateToCodePoints never splits a pair", () => {
    expect(truncateToCodePoints("a".repeat(200), 160)).toHaveLength(160);
    expect(truncateToCodePoints("👍".repeat(80), 60)).toBe("👍".repeat(60));
    expect(codePointLength(truncateToCodePoints("👍".repeat(80), 60))).toBe(60);
    expect(truncateToCodePoints("abc", 10)).toBe("abc");
    expect(truncateToCodePoints("abc", 3)).toBe("abc");
    expect(truncateToCodePoints("abc", 0)).toBe("");
    expect(truncateToCodePoints("a👍b", 2)).toBe("a👍");
  });

  it("singleLine turns line breaks and control characters into spaces", () => {
    expect(singleLine("a\nb")).toBe("a b");
    expect(singleLine("a\r\nb\tc")).toBe("a b c");
    expect(singleLine("plain")).toBe("plain");
  });
});

describe("collectImageRefs", () => {
  it("lists the photo, card images and image blocks", () => {
    expect(collectImageRefs(fullDraft)).toEqual([photoRef, bannerRef, bannerRef]);
    expect(collectImageRefs(emptyDraft("mara"))).toEqual([]);
    expect(collectImageRefs(fullPublished)).toEqual([photoRef, bannerRef, bannerRef]);
  });
});
