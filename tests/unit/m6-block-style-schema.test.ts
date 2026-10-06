import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  blockSchema,
  collectPublishErrors,
  draftDocSchema,
  publishBlockSchema,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { computePublishStatus } from "@/lib/editor/status";
import {
  BLOCK_OVERRIDE_KEYS,
  blockOverridesSchema,
  resolveBlockTokens,
  validBlockOverrides,
} from "@/lib/theme";
import { friendlyPublishErrors } from "@/lib/themes";
import { blocks, draftWith, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M6-45 at the document level: the ten override keys, an `overrides` object on every block type in
 * the draft, publish and published schemas, what the resolver ignores, what Publish keeps, and the
 * abuse table (security and limits get the full table). The renderer and the editor controls have
 * their own files (m6-block-style-render, m6-block-style-model, m6-block-style-form).
 */

const COLOR = "#C46A4F";
const TYPES = BLOCK_TYPES;

/** A complete block of each type from the shared fixture. */
const base = (type: (typeof TYPES)[number]) => ({ ...blocks[type] });

/** Every one of the ten keys, with values inside their ranges. */
const ALL_KEYS = {
  accent: COLOR,
  buttonBg: COLOR,
  buttonText: COLOR,
  text: COLOR,
  textMuted: COLOR,
  surface: COLOR,
  border: COLOR,
  buttonStyle: "soft",
  radius: 20,
  borderWidth: 2,
};

function docOf(...docBlocks: unknown[]): DraftDoc {
  return draftWith(...docBlocks) as DraftDoc;
}

describe("M6-45 the ten override keys", () => {
  it("BLOCK_OVERRIDE_KEYS is the original eight plus textMuted and borderWidth", () => {
    expect([...BLOCK_OVERRIDE_KEYS]).toEqual([
      "accent",
      "buttonBg",
      "buttonText",
      "text",
      "textMuted",
      "surface",
      "border",
      "buttonStyle",
      "radius",
      "borderWidth",
    ]);
    expect(Object.keys(blockOverridesSchema.shape).sort()).toEqual([...BLOCK_OVERRIDE_KEYS].sort());
  });

  it("accepts every key at once, and none", () => {
    expect(blockOverridesSchema.safeParse(ALL_KEYS).success).toBe(true);
    expect(blockOverridesSchema.safeParse({}).success).toBe(true);
  });

  it("the two new keys take the page-level tokens' values and ranges", () => {
    for (const ok of ["#C46A4F", "#c46a4f", "#FFF", "#C46A4FCC"]) {
      expect(blockOverridesSchema.safeParse({ textMuted: ok }).success, ok).toBe(true);
    }
    for (const bad of ["red", "#GGGGGG", "#12", "C46A4F", "", 5, null, "rgb(1,2,3)"]) {
      expect(blockOverridesSchema.safeParse({ textMuted: bad }).success, String(bad)).toBe(false);
    }
    for (const ok of [0, 1, 2, 3, 4, 0.5]) {
      expect(blockOverridesSchema.safeParse({ borderWidth: ok }).success, String(ok)).toBe(true);
    }
    for (const bad of [-1, 5, 99, 4.01, "2", null, Number.NaN, Infinity]) {
      expect(blockOverridesSchema.safeParse({ borderWidth: bad }).success, String(bad)).toBe(false);
    }
    for (const ok of [0, 12, 32]) {
      expect(blockOverridesSchema.safeParse({ radius: ok }).success, String(ok)).toBe(true);
    }
    for (const bad of [-5, 33, "20"]) {
      expect(blockOverridesSchema.safeParse({ radius: bad }).success, String(bad)).toBe(false);
    }
  });

  it.each([
    "fontHeading",
    "fontBody",
    "scale",
    "weightHeading",
    "letterCase",
    "density",
    "maxWidth",
    "align",
    "bg",
    "bgType",
    "bgImage",
    "overlayOpacity",
    "blur",
    "gradientAngle",
    "gradientFrom",
    "gradientTo",
  ])("a block override for %s is refused by the schema and ignored by the resolver", (key) => {
    const value = key.startsWith("font")
      ? "Geist"
      : key.startsWith("bg") || key === "gradientFrom" || key === "gradientTo"
        ? "#000000"
        : 1;
    expect(blockOverridesSchema.safeParse({ [key]: value }).success).toBe(false);
    // Stored JSON can hold anything: the resolver reads the ten keys and nothing else.
    const resolved = resolveBlockTokens(noirTokens, { [key]: value } as never);
    expect(resolved).toEqual(noirTokens);
    // And the helper the renderer uses drops it.
    expect(validBlockOverrides({ [key]: value })).toBeUndefined();
  });

  it("the resolver applies only the ten, with a font beside them ignored", () => {
    const resolved = resolveBlockTokens(noirTokens, {
      ...ALL_KEYS,
      fontHeading: "Geist",
      bg: "#000000",
      density: "airy",
    } as never);
    expect(resolved).toEqual({ ...noirTokens, ...ALL_KEYS });
  });

  it("validBlockOverrides keeps a valid value and drops a bad one, key by key", () => {
    expect(validBlockOverrides(undefined)).toBeUndefined();
    expect(validBlockOverrides(null)).toBeUndefined();
    expect(validBlockOverrides([])).toBeUndefined();
    expect(validBlockOverrides("x")).toBeUndefined();
    expect(validBlockOverrides({})).toBeUndefined();
    expect(validBlockOverrides({ radius: -5 })).toBeUndefined();
    expect(
      validBlockOverrides({ radius: 20, borderWidth: 99, border: "red", text: COLOR }),
    ).toEqual({ radius: 20, text: COLOR });
    expect(
      validBlockOverrides({ text: "#FFF;}</style><script>window.__x=1</script>" }),
    ).toBeUndefined();
    expect(validBlockOverrides(ALL_KEYS)).toEqual(ALL_KEYS);
  });
});

describe("M6-45 every block type accepts overrides, in all three schemas", () => {
  it.each(TYPES.map((type) => [type]))("%s: draft, publish and published", (type) => {
    const withOverrides = { ...base(type), overrides: { text: COLOR, radius: 20, borderWidth: 2 } };
    const draft = blockSchema.parse(withOverrides);
    expect(draft).toHaveProperty("overrides", { text: COLOR, radius: 20, borderWidth: 2 });
    const strict = publishBlockSchema.parse(withOverrides);
    expect(strict).toHaveProperty("overrides", { text: COLOR, radius: 20, borderWidth: 2 });
    expect(draftDocSchema.safeParse(docOf(withOverrides)).success).toBe(true);
    expect(publishDocSchema.safeParse(docOf(withOverrides)).success).toBe(true);
    const form = toPublishForm(docOf(withOverrides), noirTokens);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it.each(TYPES.map((type) => [type]))(
    "%s: a document without overrides still parses and publishes",
    (type) => {
      const plain = base(type);
      expect(blockSchema.parse(plain)).not.toHaveProperty("overrides");
      expect(publishBlockSchema.parse(plain)).not.toHaveProperty("overrides");
      const form = toPublishForm(docOf(plain), noirTokens);
      expect(publishedDocSchema.safeParse(form).success).toBe(true);
      expect(form.blocks[0]).not.toHaveProperty("overrides");
    },
  );

  it("every stored document from before this change still parses, unchanged", () => {
    // The committed fixture: one block of every type, a link override and page overrides.
    expect(draftDocSchema.safeParse(fullDraft).success).toBe(true);
    expect(publishDocSchema.safeParse(fullDraft).success).toBe(true);
    const published = toPublishForm(fullDraft, noirTokens);
    const parsed = publishedDocSchema.parse(published);
    expect(parsed.blocks.map((b) => b.type)).toEqual(
      fullDraft.blocks.filter((b) => b.visible !== false).map((b) => b.type),
    );
    // Only the link carried overrides, and it still carries exactly those three keys.
    const withOverrides = parsed.blocks.filter((b) => "overrides" in b);
    expect(withOverrides).toHaveLength(1);
    expect(withOverrides[0]).toHaveProperty("overrides", {
      buttonStyle: "pill",
      accent: "#9DB3C4",
      radius: 4,
    });
  });

  it("an empty overrides object is accepted, and Publish drops it", () => {
    const form = toPublishForm(docOf({ ...base("header"), overrides: {} }), noirTokens);
    expect(form.blocks[0]).not.toHaveProperty("overrides");
  });

  it("keys outside the ten are stripped on parse, on every type, wherever they sit", () => {
    for (const type of TYPES) {
      const parsed = blockSchema.parse({
        ...base(type),
        overrides: { text: COLOR, fontHeading: "Geist", bg: "#000000", density: "airy", scale: 2 },
      });
      expect(parsed, type).toHaveProperty("overrides", { text: COLOR });
    }
  });

  it("social icons and grid cells carry no overrides of their own", () => {
    const social = blockSchema.parse({
      ...base("social"),
      icons: blocks.social.icons.map((icon) => ({ ...icon, overrides: { text: COLOR } })),
    });
    for (const icon of (social as { icons: object[] }).icons) {
      expect(icon).not.toHaveProperty("overrides");
    }
    const grid = blockSchema.parse({
      ...base("grid"),
      cells: blocks.grid.cells.map((cell) => ({ ...cell, overrides: { border: COLOR } })),
    });
    for (const cell of (grid as { cells: object[] }).cells) {
      expect(cell).not.toHaveProperty("overrides");
    }
    const form = toPublishForm(
      docOf({
        ...base("grid"),
        cells: blocks.grid.cells.map((c) => ({ ...c, overrides: { x: 1 } })),
      }),
      noirTokens,
    );
    expect(JSON.stringify(form.blocks[0])).not.toContain('"x":1');
  });
});

describe("M6-45 Publish keeps the ten keys that have a value", () => {
  it.each(TYPES.map((type) => [type]))(
    "%s: toPublishForm keeps only the ten, canonically",
    (type) => {
      const draft = docOf({
        ...base(type),
        overrides: { ...ALL_KEYS, fontHeading: "Geist", bg: "#000000" },
      });
      const form = toPublishForm(draft, noirTokens);
      expect(form.blocks[0]).toHaveProperty("overrides", ALL_KEYS);
      // Two equal drafts give deep-equal forms, whatever the key order of the stored overrides.
      const reversed = Object.fromEntries(Object.entries(ALL_KEYS).reverse());
      const again = toPublishForm(docOf({ ...base(type), overrides: reversed }), noirTokens);
      expect(again).toEqual(form);
      expect(publishFormsEqual(form, again)).toBe(true);
    },
  );

  it("a key with no value is left out, and no key at all leaves no overrides property", () => {
    const sparse = toPublishForm(
      docOf({
        ...base("image"),
        overrides: { radius: 20, border: undefined, borderWidth: undefined },
      }),
      noirTokens,
    );
    expect(sparse.blocks[0]).toHaveProperty("overrides", { radius: 20 });
    const none = toPublishForm(
      docOf({ ...base("image"), overrides: { border: undefined } }),
      noirTokens,
    );
    expect(none.blocks[0]).not.toHaveProperty("overrides");
  });

  it("hidden blocks are still dropped, and their overrides with them", () => {
    const form = toPublishForm(
      docOf({ ...base("header"), visible: false, overrides: { text: COLOR } }, base("divider")),
      noirTokens,
    );
    expect(form.blocks).toHaveLength(1);
    expect(form.blocks[0]!.type).toBe("divider");
  });

  it("setting an override on a header flips the status to unpublished changes, removing it flips it back", () => {
    const status = (draft: DraftDoc) =>
      computePublishStatus({
        hasPublished: true,
        published,
        form: toPublishForm(draft, noirTokens),
      });
    const draft = docOf(base("header"), base("divider"));
    const published = toPublishForm(draft, noirTokens);
    expect(status(draft)).toBe("published");
    const styled = docOf({ ...base("header"), overrides: { text: COLOR } }, base("divider"));
    expect(status(styled)).toBe("unpublished-changes");
    expect(publishFormsEqual(toPublishForm(styled, noirTokens), published)).toBe(false);
    // Back to no overrides: the forms are equal again.
    expect(status(docOf(base("header"), base("divider")))).toBe("published");
    // The same for every other type.
    for (const type of TYPES) {
      const plain = docOf(base(type));
      const stored = toPublishForm(plain, noirTokens);
      const withStyle = docOf({ ...base(type), overrides: { border: COLOR } });
      expect(
        computePublishStatus({
          hasPublished: true,
          published: stored,
          form: toPublishForm(withStyle, noirTokens),
        }),
        type,
      ).toBe("unpublished-changes");
    }
  });

  it("a published document stored before this change, with no overrides on these types, renders the same form", () => {
    const stored = toPublishForm(
      docOf(
        base("header"),
        base("text"),
        base("image"),
        base("social"),
        base("embed"),
        base("grid"),
        base("divider"),
      ),
      noirTokens,
    );
    const parsed = publishedDocSchema.parse(JSON.parse(JSON.stringify(stored)));
    expect(parsed).toEqual(stored);
    for (const block of parsed.blocks) expect(block).not.toHaveProperty("overrides");
  });
});

describe("M6-45 direct-API abuse: the draft column", () => {
  it("a header with a font, a background and a color publishes only the color", () => {
    const draft = docOf({
      ...base("header"),
      overrides: { fontHeading: "Geist", bg: "#000000", text: COLOR },
    });
    expect(publishDocSchema.safeParse(draft).success).toBe(true);
    const parsed = publishDocSchema.parse(draft);
    const form = toPublishForm(parsed, noirTokens);
    expect(form.blocks[0]).toHaveProperty("overrides", { text: COLOR });
    expect(JSON.stringify(form.blocks)).not.toContain("Geist");
    expect(JSON.stringify(form.blocks)).not.toContain("#000000");
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  const HOSTILE = "#FFF;}</style><script>window.__x=1</script>";
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
      "a header with a text color of 'red'",
      "header",
      { text: "red" },
      "overrides.text",
      messages.color,
    ],
    [
      "a text block with a muted color of 'red'",
      "text",
      { textMuted: "red" },
      "overrides.textMuted",
      messages.color,
    ],
    ["an embed with a radius of 99", "embed", { radius: 99 }, "overrides.radius", messages.radius],
    [
      "a social block with a border thickness of -1",
      "social",
      { borderWidth: -1 },
      "overrides.borderWidth",
      messages.borderWidth,
    ],
  ] as const)(
    "%s fails Publish naming the block and the fix",
    (_name, type, overrides, field, message) => {
      const draft = docOf({ ...base(type), overrides });
      expect(publishDocSchema.safeParse(draft).success).toBe(false);
      const errors = friendlyPublishErrors(collectPublishErrors(draft));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ blockId: base(type).id, field, message });
    },
  );

  it("a hostile value is refused even in a hidden block: the draft schema is strict about the ten keys", () => {
    const draft = docOf(
      { ...base("grid"), visible: false, overrides: { text: HOSTILE } },
      base("divider"),
    );
    // The draft schema is strict about the ten keys (a hostile value fails every parse of it), so
    // the Publish gate refuses it even in a hidden block: the editor never writes one.
    expect(draftDocSchema.safeParse(draft).success).toBe(false);
    expect(publishDocSchema.safeParse(draft).success).toBe(false);
  });

  it("a published row holding a hostile block value fails the published schema (the live page fails closed)", () => {
    const good = toPublishForm(docOf(base("grid"), base("image")), noirTokens);
    for (const [index, overrides] of [
      [0, { text: HOSTILE }],
      [1, { radius: -5 }],
      [1, { borderWidth: 99 }],
      [0, { border: "red" }],
    ] as const) {
      const hostile = JSON.parse(JSON.stringify(good));
      hostile.blocks[index].overrides = overrides;
      expect(publishedDocSchema.safeParse(hostile).success, JSON.stringify(overrides)).toBe(false);
    }
  });

  it("an unknown key beside valid ones in a published row is stripped, not served", () => {
    const good = toPublishForm(docOf(base("header")), noirTokens);
    const stored = JSON.parse(JSON.stringify(good));
    stored.blocks[0].overrides = { text: COLOR, fontHeading: "Geist", customCss: "x" };
    const parsed = publishedDocSchema.parse(stored);
    expect(parsed.blocks[0]).toHaveProperty("overrides", { text: COLOR });
  });
});
