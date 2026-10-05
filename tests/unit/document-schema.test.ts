import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  LIMITS,
  type Block,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
} from "@/lib/document";
import {
  OWNER_UID,
  bannerRef,
  blocks,
  draftWith,
  fullDraft,
  fullPublished,
  noirTokens,
  photoRef,
} from "./fixtures/page-document";

type Json = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const draftOk = (doc: unknown) => draftDocSchema.safeParse(doc).success;
const publishOk = (doc: unknown) => publishDocSchema.safeParse(doc).success;
const both = (doc: unknown) => [draftOk(doc), publishOk(doc)];

describe("block types (M2-01)", () => {
  it("has the nine originals, then faq, contact, discount, book, apps and map, in chip order (M9-15)", () => {
    // Each Wave K block lands on its own, so the list is the full order cut to the types that exist.
    const order = [
      "link",
      "card",
      "header",
      "text",
      "image",
      "social",
      "embed",
      "grid",
      "divider",
      "faq",
      "contact",
      "discount",
      "book",
      "apps",
      "map",
      "page_link",
      "items",
      "hours",
    ];
    expect(BLOCK_TYPES.length).toBeGreaterThanOrEqual(12);
    expect([...BLOCK_TYPES]).toEqual(order.slice(0, BLOCK_TYPES.length));
  });

  it("the full fixture covers every type and passes both schemas", () => {
    // M12-01, M12-02: items and hours join the full fixture once their renderer lands.
    expect(new Set(fullDraft.blocks.map((b) => b.type))).toEqual(
      new Set(BLOCK_TYPES.filter((t) => t !== "items" && t !== "hours")),
    );
    expect(both(fullDraft)).toEqual([true, true]);
  });

  it("an unknown type fails both schemas (including 'script' and the old M0 names)", () => {
    for (const type of [
      "script",
      "iframe",
      "link_button",
      "link_card",
      "social_row",
      "grid2",
      "",
    ]) {
      expect(both(draftWith({ ...blocks.divider, type }))).toEqual([false, false]);
    }
    expect(both(draftWith({ id: "no-type-here", visible: true }))).toEqual([false, false]);
  });

  it("visible defaults to true, and must be a boolean", () => {
    const { visible: _visible, ...noVisible } = blocks.divider;
    void _visible;
    const parsed = draftDocSchema.parse(draftWith(noVisible));
    expect(parsed.blocks[0]!.visible).toBe(true);
    expect(draftOk(draftWith({ ...blocks.divider, visible: "yes" }))).toBe(false);
  });
});

describe("unknown keys are stripped on parse", () => {
  it("at every level, so published JSON carries only known fields", () => {
    const dirty = clone(fullDraft) as unknown as Json & {
      profile: Json;
      blocks: Json[];
      theme: Json;
    };
    dirty.extra = 1;
    dirty.profile.badge = false;
    dirty.theme.settings = { hideBadge: true };
    for (const block of dirty.blocks) block.settings = { hideReport: true };
    const social = dirty.blocks.find((b) => b.type === "social") as Json & { icons: Json[] };
    social.icons[0]!.extra = "x";
    const grid = dirty.blocks.find((b) => b.type === "grid") as Json & { cells: Json[] };
    grid.cells[0]!.extra = "x";
    const link = dirty.blocks.find((b) => b.type === "link") as Json & { overrides: Json };
    link.overrides.fontHeading = "Geist";
    link.overrides.bg = "#000000";

    for (const schema of [draftDocSchema, publishDocSchema]) {
      const result = schema.safeParse(dirty);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(fullDraft);
    }
  });

  it("the page-level theme overrides reuse the Milestone 0 strict token schema", () => {
    const doc = clone(fullDraft) as unknown as { theme: { overrides: Json } };
    doc.theme.overrides.customCss = "body{}";
    expect(both(doc)).toEqual([false, false]);
    doc.theme.overrides = { bg: "red;}" };
    expect(both(doc)).toEqual([false, false]);
  });
});

describe("draft is lenient, publish is strict", () => {
  it("a link with label '' and url '' passes the draft schema and fails publish", () => {
    const doc = draftWith({ ...blocks.link, label: "", url: "" });
    expect(draftOk(doc)).toBe(true);
    expect(publishOk(doc)).toBe(false);
  });

  it("an empty display name passes the draft schema and fails publish", () => {
    const doc = clone(fullDraft);
    doc.profile.name = "";
    expect(draftOk(doc)).toBe(true);
    expect(publishOk(doc)).toBe(false);
    doc.profile.name = "   ";
    expect(publishOk(doc)).toBe(false);
  });

  it("a draft keeps any URL string a user typed, publish needs an http(s) URL", () => {
    for (const url of ["javascript:alert(1)", "maraokafor.com", "https://", "not a url"]) {
      const doc = draftWith({ ...blocks.link, url });
      expect(both(doc)).toEqual([true, false]);
    }
  });

  it("every default-style incomplete block autosaves", () => {
    const incomplete = [
      { ...blocks.card, title: "", url: "", image: null },
      { ...blocks.header, text: "" },
      { ...blocks.text, text: "" },
      { ...blocks.image, image: null, alt: "", url: "" },
      { ...blocks.social, icons: [{ id: "icon-empty-001", platform: "instagram", url: "" }] },
      { ...blocks.social, icons: [{ id: "icon-empty-002", platform: "email", address: "" }] },
      { ...blocks.embed, url: "", caption: "" },
      {
        ...blocks.grid,
        cells: [
          { id: "cell-empty-001", title: "", subtitle: "", url: "" },
          { id: "cell-empty-002", title: "", subtitle: "", url: "" },
        ],
      },
    ];
    for (const block of incomplete) {
      expect(both(draftWith(block)), JSON.stringify(block).slice(0, 60)).toEqual([true, false]);
    }
  });

  it("hidden blocks only need to be well-formed: Publish drops them", () => {
    const hiddenIncomplete = { ...blocks.link, visible: false, label: "", url: "javascript:x" };
    expect(both(draftWith(hiddenIncomplete))).toEqual([true, true]);
    // ...but a hidden block still has to respect the structure and limits
    expect(both(draftWith({ ...hiddenIncomplete, label: "x".repeat(81) }))).toEqual([false, false]);
    expect(both(draftWith({ ...hiddenIncomplete, type: "script" }))).toEqual([false, false]);
  });

  it("publish requires the per-type fields", () => {
    const failing = [
      { ...blocks.card, title: "" },
      { ...blocks.card, url: "" },
      { ...blocks.header, text: "" },
      { ...blocks.text, text: "" },
      { ...blocks.image, image: null },
      { ...blocks.image, alt: "" },
      { ...blocks.embed, url: "https://evil.example/x" },
      { ...blocks.grid, cells: [{ ...blocks.grid.cells[0]!, title: "" }, blocks.grid.cells[1]!] },
      {
        ...blocks.social,
        icons: [{ id: "icon-bad-email", platform: "email", address: "a b@c.d" }],
      },
    ];
    for (const block of failing) {
      expect(publishOk(draftWith(block)), JSON.stringify(block).slice(0, 80)).toBe(false);
    }
    // and the optional ones stay optional
    expect(publishOk(draftWith({ ...blocks.card, caption: "", image: null }))).toBe(true);
    expect(publishOk(draftWith({ ...blocks.image, url: "" }))).toBe(true);
    const { url: _url, ...noLink } = blocks.image;
    void _url;
    expect(publishOk(draftWith(noLink))).toBe(true);
    expect(publishOk(draftWith({ ...blocks.embed, caption: "" }))).toBe(true);
    expect(
      publishOk(
        draftWith({
          ...blocks.grid,
          cells: blocks.grid.cells.map((c) => ({ ...c, subtitle: "" })),
        }),
      ),
    ).toBe(true);
  });
});

// The M2-01 limit table: each at the limit (passes) and limit + 1 (fails both schemas).
describe("limit table, in code points", () => {
  const withProfile = (patch: Json) => {
    const doc = clone(fullDraft) as unknown as { profile: Json };
    Object.assign(doc.profile, patch);
    return doc;
  };
  const withBlock = (block: Json) => draftWith(block);
  const cell = (n: number, patch: Json = {}) => ({
    id: `cell-limit-${String(n).padStart(2, "0")}`,
    title: "T",
    subtitle: "",
    url: "https://example.com/c",
    ...patch,
  });
  const icon = (n: number) => ({
    id: `icon-limit-${String(n).padStart(2, "0")}`,
    platform: "website",
    url: "https://example.com/i",
  });
  const header = (n: number) => ({
    ...blocks.header,
    id: `header-limit-${String(n).padStart(2, "0")}`,
  });

  const textCases: [string, number, (value: string) => unknown][] = [
    ["display name", LIMITS.displayName, (v) => withProfile({ name: v })],
    ["bio", LIMITS.bio, (v) => withProfile({ bio: v })],
    ["link label", LIMITS.linkLabel, (v) => withBlock({ ...blocks.link, label: v })],
    ["card title", LIMITS.cardTitle, (v) => withBlock({ ...blocks.card, title: v })],
    ["card caption", LIMITS.cardCaption, (v) => withBlock({ ...blocks.card, caption: v })],
    ["header text", LIMITS.headerText, (v) => withBlock({ ...blocks.header, text: v })],
    ["text", LIMITS.text, (v) => withBlock({ ...blocks.text, text: v })],
    ["image alt", LIMITS.imageAlt, (v) => withBlock({ ...blocks.image, alt: v })],
    ["embed caption", LIMITS.embedCaption, (v) => withBlock({ ...blocks.embed, caption: v })],
    [
      "cell title",
      LIMITS.cellTitle,
      (v) => withBlock({ ...blocks.grid, cells: [cell(1, { title: v }), cell(2)] }),
    ],
    [
      "cell subtitle",
      LIMITS.cellSubtitle,
      (v) => withBlock({ ...blocks.grid, cells: [cell(1, { subtitle: v }), cell(2)] }),
    ],
  ];

  it("pins the table", () => {
    expect(LIMITS).toMatchObject({
      displayName: 60,
      bio: 160,
      blocks: 50,
      linkLabel: 80,
      cardTitle: 60,
      cardCaption: 100,
      headerText: 80,
      text: 600,
      imageAlt: 140,
      embedCaption: 80,
      socialIconsMin: 1,
      socialIconsMax: 8,
      gridCellsMin: 2,
      gridCellsMax: 6,
      cellTitle: 40,
      cellSubtitle: 60,
    });
  });

  it.each(textCases)(
    "%s: at the limit passes, one more fails both schemas",
    (_name, limit, build) => {
      expect(both(build("a".repeat(limit)))).toEqual([true, true]);
      expect(both(build("a".repeat(limit + 1)))).toEqual([false, false]);
    },
  );

  it.each(textCases)("%s: counts code points, so an emoji is one", (_name, limit, build) => {
    expect(both(build("👍".repeat(limit)))).toEqual([true, true]);
    expect(both(build("👍".repeat(limit + 1)))).toEqual([false, false]);
  });

  it.each(textCases)(
    "%s: surrounding spaces are trimmed before counting",
    (_name, limit, build) => {
      expect(both(build(` ${"a".repeat(limit)} `))).toEqual([true, true]);
    },
  );

  it("blocks: 50 pass, 51 fail both schemas", () => {
    const doc = (n: number) => draftWith(...Array.from({ length: n }, (_, i) => header(i)));
    expect(both(doc(50))).toEqual([true, true]);
    expect(both(doc(51))).toEqual([false, false]);
    expect(both(doc(60))).toEqual([false, false]);
  });

  it("social icons: 1 to 8", () => {
    const social = (n: number) =>
      withBlock({ ...blocks.social, icons: Array.from({ length: n }, (_, i) => icon(i)) });
    expect(both(social(1))).toEqual([true, true]);
    expect(both(social(8))).toEqual([true, true]);
    expect(both(social(9))).toEqual([false, false]);
    expect(both(social(0))).toEqual([false, false]);
  });

  it("grid cells: 2 to 6", () => {
    const grid = (n: number) =>
      withBlock({ ...blocks.grid, cells: Array.from({ length: n }, (_, i) => cell(i)) });
    expect(both(grid(2))).toEqual([true, true]);
    expect(both(grid(6))).toEqual([true, true]);
    expect(both(grid(7))).toEqual([false, false]);
    expect(both(grid(1))).toEqual([false, false]);
    expect(both(grid(0))).toEqual([false, false]);
  });
});

describe("ids", () => {
  const idDoc = (id: string) => draftWith({ ...blocks.divider, id });

  it("must be 8-24 characters of A-Za-z0-9_-", () => {
    expect(both(idDoc("a".repeat(8)))).toEqual([true, true]);
    expect(both(idDoc("Zz_-09aA".repeat(3)))).toEqual([true, true]);
    for (const id of [
      "a".repeat(7),
      "a".repeat(25),
      "",
      "has space1",
      "dot.in.id1",
      "slash/id-1",
      "émoji-id-1",
      "id\nid-id-1",
    ]) {
      expect(both(idDoc(id)), JSON.stringify(id)).toEqual([false, false]);
    }
  });

  it("must be unique across blocks, social icons and grid cells", () => {
    const social = { ...blocks.social, icons: [...blocks.social.icons] };
    const duplicates: [string, unknown[]][] = [
      ["two blocks", [blocks.divider, { ...blocks.header, id: blocks.divider.id }]],
      ["block and icon", [social, { ...blocks.divider, id: social.icons[0]!.id }]],
      ["block and cell", [blocks.grid, { ...blocks.divider, id: blocks.grid.cells[1]!.id }]],
      [
        "icon and icon",
        [
          {
            ...social,
            icons: [social.icons[0]!, { ...social.icons[1]!, id: social.icons[0]!.id }],
          },
        ],
      ],
      [
        "cell and cell",
        [
          {
            ...blocks.grid,
            cells: [
              blocks.grid.cells[0]!,
              { ...blocks.grid.cells[1]!, id: blocks.grid.cells[0]!.id },
            ],
          },
        ],
      ],
      [
        "icon and cell",
        [
          social,
          {
            ...blocks.grid,
            cells: [{ ...blocks.grid.cells[0]!, id: social.icons[1]!.id }, blocks.grid.cells[1]!],
          },
        ],
      ],
    ];
    for (const [name, list] of duplicates) {
      expect(both(draftWith(...list)), name).toEqual([false, false]);
    }
    expect(both(draftWith(blocks.divider, blocks.header, social, blocks.grid))).toEqual([
      true,
      true,
    ]);
  });

  it("a duplicate is reported on the duplicate's own id", () => {
    const result = draftDocSchema.safeParse(
      draftWith(blocks.divider, { ...blocks.header, id: blocks.divider.id }),
    );
    expect(result.error?.issues[0]?.path).toEqual(["blocks", 1, "id"]);
  });

  it("never change on parse, a JSON round trip or a reorder", () => {
    const ids = (doc: { blocks: readonly Block[] }) =>
      doc.blocks.flatMap((b) => [
        b.id,
        ...(b.type === "social" ? b.icons.map((i) => i.id) : []),
        ...(b.type === "grid" ? b.cells.map((c) => c.id) : []),
      ]);
    const once = draftDocSchema.parse(JSON.parse(JSON.stringify(fullDraft)));
    const twice = draftDocSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(ids(twice)).toEqual(ids(fullDraft));
    expect(twice).toEqual(fullDraft);
    const reordered = { ...fullDraft, blocks: [...fullDraft.blocks].reverse() };
    expect(ids(draftDocSchema.parse(reordered)).sort()).toEqual(ids(fullDraft).sort());
    expect(ids(toPublishForm(fullDraft, noirTokens))).toEqual(
      ids({ ...fullDraft, blocks: fullDraft.blocks.filter((b) => b.visible) }),
    );
  });
});

describe("text rules", () => {
  it("trims every text field on parse", () => {
    const doc = clone(fullDraft);
    doc.profile.name = "  Mara  ";
    doc.profile.bio = "\n bio \t";
    doc.blocks = [{ ...blocks.link, label: "  hi  ", url: "  https://example.com/a  " }];
    const parsed = draftDocSchema.parse(doc);
    expect(parsed.profile).toMatchObject({ name: "Mara", bio: "bio" });
    expect(parsed.blocks[0]).toMatchObject({ label: "hi", url: "https://example.com/a" });
    expect(
      draftDocSchema.parse(draftWith({ ...blocks.link, label: "   " })).blocks[0],
    ).toMatchObject({ label: "" });
  });

  const withField = (field: string, value: string) => {
    const make: Record<string, () => unknown> = {
      name: () => ({ ...clone(fullDraft), profile: { ...fullDraft.profile, name: value } }),
      bio: () => ({ ...clone(fullDraft), profile: { ...fullDraft.profile, bio: value } }),
      label: () => draftWith({ ...blocks.link, label: value }),
      title: () => draftWith({ ...blocks.card, title: value }),
      caption: () => draftWith({ ...blocks.card, caption: value }),
      header: () => draftWith({ ...blocks.header, text: value }),
      alt: () => draftWith({ ...blocks.image, alt: value }),
      embedCaption: () => draftWith({ ...blocks.embed, caption: value }),
      cellTitle: () =>
        draftWith({
          ...blocks.grid,
          cells: [{ ...blocks.grid.cells[0]!, title: value }, blocks.grid.cells[1]!],
        }),
      subtitle: () =>
        draftWith({
          ...blocks.grid,
          cells: [{ ...blocks.grid.cells[0]!, subtitle: value }, blocks.grid.cells[1]!],
        }),
      text: () => draftWith({ ...blocks.text, text: value }),
    };
    return make[field]!();
  };
  const singleLineFields = [
    "name",
    "bio",
    "label",
    "title",
    "caption",
    "header",
    "alt",
    "embedCaption",
    "cellTitle",
    "subtitle",
  ];

  const controls: [string, string][] = [
    ["NUL", "\u0000"],
    ["SOH", "\u0001"],
    ["tab", "\t"],
    ["carriage return", "\r"],
    ["escape", "\u001b"],
    ["unit separator", "\u001f"],
    ["DEL", "\u007f"],
    ["NEL", "\u0085"],
    ["C1 end", "\u009f"],
  ];
  const bidi = ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"];

  it.each(singleLineFields)(
    "%s: control characters and bidi characters fail publish, not the draft",
    (field) => {
      for (const [name, char] of [
        ...controls,
        ["newline", "\n"] as [string, string],
        ...bidi.map((c) => [`U+${c.charCodeAt(0).toString(16)}`, c] as [string, string]),
      ]) {
        const doc = withField(field, `a${char}b`);
        expect(both(doc), `${field} with ${name}`).toEqual([true, false]);
      }
      expect(publishOk(withField(field, "a b"))).toBe(true);
    },
  );

  it("text blocks keep newlines but nothing else of the control range", () => {
    expect(publishOk(withField("text", "line one\nline two\n\nline four"))).toBe(true);
    for (const [name, char] of controls) {
      expect(both(withField("text", `a${char}b`)), name).toEqual([true, false]);
    }
    for (const char of bidi) expect(publishOk(withField("text", `a${char}b`))).toBe(false);
  });

  it("URLs in the document refuse control and bidi characters at publish", () => {
    for (const char of ["\t", "\n", "\u0000", "‮"]) {
      expect(publishOk(draftWith({ ...blocks.link, url: `https://example.com/a${char}b` }))).toBe(
        false,
      );
    }
  });

  it("escapes nothing and strips nothing: markup is valid text for the renderer to escape", () => {
    const xss = "<script>alert(1)</script>";
    const doc = clone(fullDraft);
    doc.profile.name = xss;
    expect(publishDocSchema.parse(doc).profile.name).toBe(xss);
  });
});

describe("image references", () => {
  const good = `${OWNER_UID}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png`;
  const refDocs = (path: string, width = 10, height = 10) => {
    const ref = { path, width, height };
    const profile = { ...clone(fullDraft), profile: { ...fullDraft.profile, photo: ref } };
    return {
      "profile photo": profile,
      "card image": draftWith({ ...blocks.card, image: ref }),
      "image block": draftWith({ ...blocks.image, image: ref }),
    };
  };

  it.each(["profile photo", "card image", "image block"] as const)(
    "%s accepts the owner/file scheme",
    (where) => {
      for (const path of [
        good,
        `${OWNER_UID}/abcdefgh.jpg`,
        `${OWNER_UID}/${"a-1".repeat(21)}.webp`,
        `${"0".repeat(36)}/${"f".repeat(8)}.png`,
      ]) {
        expect(both(refDocs(path)[where]), path).toEqual([true, true]);
      }
    },
  );

  it.each(["profile photo", "card image", "image block"] as const)(
    "%s rejects external URLs, traversal and data URIs in both schemas",
    (where) => {
      const bad = [
        "https://evil.example/x.png",
        "//evil.example/x.png",
        "data:image/png;base64,AAAA",
        `../${OWNER_UID}/abcdefgh.jpg`,
        `${OWNER_UID}/../abcdefgh.jpg`,
        `${OWNER_UID}/..%2fabcdefgh.jpg`,
        "../../etc/passwd",
        `${OWNER_UID}/abcdefgh.gif`,
        `${OWNER_UID}/abcdefgh.svg`,
        `${OWNER_UID}/abcdefgh.JPG`,
        `${OWNER_UID}/ABCDEFGH.jpg`,
        `${OWNER_UID}/abc.jpg`,
        `${OWNER_UID}/${"a".repeat(65)}.jpg`,
        `${OWNER_UID}/sub/abcdefgh.jpg`,
        `${OWNER_UID.toUpperCase()}/abcdefgh.jpg`,
        `${OWNER_UID.slice(1)}/abcdefgh.jpg`,
        `/${OWNER_UID}/abcdefgh.jpg`,
        `${OWNER_UID}/abcdefgh.jpg\n`,
        `${OWNER_UID}/abcdefgh.jpg?x=1`,
        "",
      ];
      for (const path of bad) {
        expect(both(refDocs(path)[where]), JSON.stringify(path)).toEqual([false, false]);
      }
    },
  );

  it("needs integer, positive dimensions", () => {
    for (const [w, h] of [
      [0, 10],
      [10, 0],
      [-1, 10],
      [1.5, 10],
      [10, Number.NaN],
    ] as const) {
      expect(draftOk(refDocs(good, w, h)["profile photo"]), `${w}x${h}`).toBe(false);
    }
  });

  it("is strict about shape: strips extra keys, refuses a bare string", () => {
    const withExtra = draftDocSchema.parse(
      draftWith({ ...blocks.card, image: { ...bannerRef, url: "https://evil.example/x.png" } }),
    );
    expect(withExtra.blocks[0]).toMatchObject({ image: bannerRef });
    expect(draftOk(draftWith({ ...blocks.card, image: good }))).toBe(false);
    expect(
      draftOk(clone({ ...fullDraft, profile: { ...fullDraft.profile, photo: photoRef.path } })),
    ).toBe(false);
  });
});

describe("block overrides", () => {
  const linkWith = (overrides: unknown) => draftWith({ ...blocks.link, overrides });

  it("keeps only the keys the resolver allows and strips the rest", () => {
    const allowed = {
      accent: "#C46A4F",
      buttonBg: "#111111",
      buttonText: "#FFFFFF",
      text: "#222222",
      surface: "#333333",
      border: "#444444",
      buttonStyle: "outline",
      radius: 20,
    };
    const parsed = publishDocSchema.parse(
      linkWith({ ...allowed, fontHeading: "Geist", bg: "#000000", maxWidth: 400, customCss: "x" }),
    );
    expect(parsed.blocks[0]).toMatchObject({ overrides: allowed });
    expect(Object.keys((parsed.blocks[0] as { overrides: Json }).overrides)).toHaveLength(8);
  });

  it("never lets a stripped key reach the publish form", () => {
    const parsed = draftDocSchema.parse(
      linkWith({ fontHeading: "Geist", bg: "#000000", radius: 8 }),
    );
    const published = toPublishForm(parsed, noirTokens);
    expect((published.blocks[0] as { overrides: Json }).overrides).toEqual({ radius: 8 });
    expect(JSON.stringify(published.blocks)).not.toContain("fontHeading");
  });

  it("an invalid value for an allowed key fails publish (and the draft)", () => {
    for (const bad of [
      { radius: -5 },
      { radius: 33 },
      { accent: "red" },
      { accent: "#GGGGGG" },
      { buttonStyle: "glow" },
      { buttonText: 12 },
      { radius: "4" },
    ]) {
      expect(both(linkWith(bad)), JSON.stringify(bad)).toEqual([false, false]);
    }
  });

  // M6-45: every block type carries overrides now (it was link and card until then); the keys
  // outside the ten are still stripped, wherever they sit. The full matrix is in
  // tests/unit/m6-block-style-schema.test.ts.
  it("every block type carries overrides, and only the ten allowed keys", () => {
    const parsed = draftDocSchema.parse(
      draftWith({ ...blocks.header, overrides: { radius: 4, fontHeading: "Geist" } }),
    );
    expect(parsed.blocks[0]).toHaveProperty("overrides", { radius: 4 });
    expect(publishOk(draftWith({ ...blocks.card, overrides: { buttonStyle: "pill" } }))).toBe(true);
  });
});

describe("direct-API abuse of the draft column", () => {
  it("a 60-block document fails publish", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...blocks.header,
      id: `header-many-${String(i).padStart(2, "0")}`,
    }));
    expect(publishOk(draftWith(...many))).toBe(false);
  });

  it("a block with type 'script' fails publish", () => {
    expect(
      publishOk(
        draftWith(blocks.header, {
          id: "script-block-1",
          type: "script",
          visible: true,
          src: "https://evil.example/x.js",
        }),
      ),
    ).toBe(false);
  });

  it("a missing, wrong or extra top-level shape fails", () => {
    for (const doc of [
      {},
      [],
      "x",
      null,
      { blocks: 5 },
      { ...clone(fullDraft), version: 2 },
      { ...clone(fullDraft), rev: -1 },
      { ...clone(fullDraft), rev: 1.5 },
      { ...clone(fullDraft), blocks: "x" },
    ]) {
      expect(both(doc), JSON.stringify(doc)?.slice(0, 40)).toEqual([false, false]);
    }
    const noTheme = clone(fullDraft) as unknown as Json;
    delete noTheme.theme;
    expect(both(noTheme)).toEqual([false, false]);
  });

  it("theme.ref must be a UUID or null", () => {
    expect(both({ ...clone(fullDraft), theme: { ref: null, overrides: {} } })).toEqual([
      true,
      true,
    ]);
    expect(both({ ...clone(fullDraft), theme: { ref: "noir", overrides: {} } })).toEqual([
      false,
      false,
    ]);
  });

  it("the old Milestone 0 shape no longer parses", () => {
    const old = {
      version: 1,
      profile: { displayName: "A", bio: "", avatarUrl: null },
      themeId: null,
      tokens: {},
      blocks: [],
    };
    expect(both(old)).toEqual([false, false]);
  });
});

describe("publishedDocSchema (the stored form)", () => {
  it("accepts what toPublishForm produces, with tokens fully resolved", () => {
    const result = publishedDocSchema.safeParse(JSON.parse(JSON.stringify(fullPublished)));
    expect(result.success).toBe(true);
    expect(result.data).toEqual(fullPublished);
  });

  it("requires complete tokens, drops rev, and is strict about visible content", () => {
    const missing = clone(fullPublished) as unknown as Json & { tokens: Json };
    delete missing.tokens.accent;
    expect(publishedDocSchema.safeParse(missing).success).toBe(false);
    expect(publishedDocSchema.safeParse({ ...fullDraft }).success).toBe(false);
    const withRev = publishedDocSchema.parse({ ...clone(fullPublished), rev: 9 });
    expect(withRev).not.toHaveProperty("rev");
    const bad = clone(fullPublished);
    (bad.blocks[0] as unknown as { icons: Json[] }).icons[0]!.url = "javascript:alert(1)";
    expect(publishedDocSchema.safeParse(bad).success).toBe(false);
    expect(
      publishedDocSchema.safeParse({
        ...clone(fullPublished),
        blocks: [{ ...blocks.link, label: "" }],
      }).success,
    ).toBe(false);
  });

  it("refuses duplicate ids and unknown block types too", () => {
    const dup = clone(fullPublished);
    dup.blocks.push({ ...blocks.divider, id: dup.blocks[0]!.id });
    expect(publishedDocSchema.safeParse(dup).success).toBe(false);
    const script = {
      ...clone(fullPublished),
      blocks: [{ id: "script-block-1", type: "script", visible: true }],
    };
    expect(publishedDocSchema.safeParse(script).success).toBe(false);
  });
});

describe("collectPublishErrors", () => {
  it("is empty for a publishable draft", () => {
    expect(collectPublishErrors(fullDraft)).toEqual([]);
  });

  it("names the block, the item and the field, with editor copy", () => {
    const doc = clone(fullDraft);
    doc.profile.name = "";
    doc.blocks = [
      { ...blocks.link, label: "", url: "javascript:alert(1)" },
      { ...blocks.embed, url: "https://evil.example/x" },
      { ...blocks.image, image: null, alt: "" },
      {
        ...blocks.social,
        icons: [{ id: "icon-bad-url-1", platform: "x", url: "data:text/html,<b>" }],
      },
      {
        ...blocks.grid,
        cells: [
          { ...blocks.grid.cells[0]!, title: "" },
          { ...blocks.grid.cells[1]!, url: "ftp://x" },
        ],
      },
    ];
    const errors = collectPublishErrors(doc);
    expect(errors).toEqual(
      expect.arrayContaining([
        { blockId: null, field: "profile.name", message: "Add a display name." },
        { blockId: "link-portraits", field: "label", message: "Add a link label." },
        {
          blockId: "link-portraits",
          field: "url",
          message: "Enter a full web address, like https://example.com.",
        },
        {
          blockId: "embed-yt-ep04",
          field: "url",
          message:
            "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.",
        },
        { blockId: "image-studio-1", field: "image", message: "Upload an image." },
        {
          blockId: "image-studio-1",
          field: "alt",
          message: "Add a short description of this image.",
        },
        {
          blockId: "social-row-01",
          itemId: "icon-bad-url-1",
          field: "url",
          message: "Enter a full web address, like https://example.com.",
        },
        {
          blockId: "grid-prints-01",
          itemId: "cell-prints-01",
          field: "title",
          message: "Add a title.",
        },
        {
          blockId: "grid-prints-01",
          itemId: "cell-works-001",
          field: "url",
          message: "Enter a full web address, like https://example.com.",
        },
      ]),
    );
    expect(errors).toHaveLength(9);
  });

  it("is safe on garbage and reports one error per field", () => {
    expect(collectPublishErrors({ blocks: 5 }).length).toBeGreaterThan(0);
    expect(collectPublishErrors(null).length).toBeGreaterThan(0);
    const errors = collectPublishErrors(
      draftWith({ id: "script-block-1", type: "script", visible: true }),
    );
    expect(errors).toEqual([expect.objectContaining({ blockId: "script-block-1", field: "type" })]);
    const doubled = collectPublishErrors(
      draftWith({ ...blocks.link, label: "a\u0000b".repeat(50) }),
    );
    expect(doubled.filter((e) => e.field === "label")).toHaveLength(1);
  });
});

describe("one document schema in the codebase (static)", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? sourceFiles(path)
        : /\.(ts|tsx)$/.test(name)
          ? [path]
          : [];
    });
  }
  const files = sourceFiles(join(process.cwd(), "src")).filter(
    (f) => !f.includes("database.types"),
  );

  it("only src/lib/document defines the document and block schemas", () => {
    const definers = files.filter((f) =>
      /discriminatedUnion\(\s*"type"/.test(readFileSync(f, "utf8")),
    );
    expect(definers.map((f) => f.slice(process.cwd().length + 1))).toEqual([
      "src/lib/document/schema.ts",
    ]);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from "@\/lib\/schemas\/(?:blocks|page|url)"/);
      expect(text, file).not.toMatch(
        /(?:pageDocumentSchema|publishedDocumentSchema|safeUrlSchema|mailtoUrlSchema)/,
      );
    }
  });

  it("the editor, the Publish action and the public-page query import their schema from it", () => {
    // M2-01 step 1: the editor (autosave and loading) validates with draftDocSchema, Publish with
    // publishDocSchema, the public query with publishedDocSchema, all from "@/lib/document".
    const importsFrom = (file: string, name: string) => {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      const imports = [...text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)];
      return imports.some(
        ([, names, spec]) => spec === "@/lib/document" && new RegExp(`\\b${name}\\b`).test(names!),
      );
    };
    expect(importsFrom("src/lib/editor/autosave.ts", "draftDocSchema")).toBe(true);
    expect(importsFrom("src/lib/editor/load.ts", "draftDocSchema")).toBe(true);
    expect(importsFrom("src/lib/publish/core.ts", "publishDocSchema")).toBe(true);
    expect(importsFrom("src/app/(tenant)/published-page.ts", "publishedDocSchema")).toBe(true);
  });

  it("the document module never imports the app, the database or the server", () => {
    for (const file of files.filter((f) => f.includes("src/lib/document/"))) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(
          ["zod", "@/lib/theme"].includes(spec) || spec.startsWith("./"),
          `${file}: ${spec}`,
        ).toBe(true);
      }
    }
  });
});
