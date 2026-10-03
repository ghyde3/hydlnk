import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEATURED_LIMIT_MESSAGE,
  LIMITS,
  LINK_FEATURED,
  LINK_ICONS,
  LINK_ICON_LABELS,
  LINK_THUMB_UPLOAD_KIND,
  blockSchema,
  collectImageRefs,
  collectPublishErrors,
  draftDocSchema,
  featuredOverLimit,
  imageRefSchema,
  isLinkFeatured,
  isLinkIconName,
  publishBlockSchema,
  publishDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  toPublishForm,
  type DraftDoc,
} from "@/lib/document";
import { computePublishStatus } from "@/lib/editor/status";
import {
  AVATAR_SIZE,
  OUTPUT_BYTE_BUDGET,
  STORED_NAME_PREFIX,
  STORED_PATH_PATTERN,
  UPLOAD_KINDS,
} from "@/lib/media/limits";
import { BLOCK_OVERRIDE_KEYS, blockOverridesSchema, resolveBlockTokens } from "@/lib/theme";
import { OWNER_UID, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M6-20 (link icons and thumbnails) and M6-22 (featured links) at the document level: the schemas,
 * the publish form, the limit and the abuse table. Security and limits get the full table; the
 * renderer and the editor have their own files.
 */

const THUMB = `${OWNER_UID}/avatar-0123456789ab.webp`;
const OTHER_UID = "11111111-2222-4333-8444-555555555555";

const link = (extra: Record<string, unknown> = {}, id = "link-aaaa-0001") => ({
  id,
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://example.com/book",
  ...extra,
});

const doc = (...blocks: unknown[]): unknown => ({
  version: 1,
  rev: 1,
  profile: { name: "Mara Okafor", bio: "", photo: null },
  theme: { ref: null, overrides: {} },
  blocks,
});

const draftOk = (block: unknown) => draftDocSchema.safeParse(doc(block)).success;
const publishOk = (block: unknown) => publishDocSchema.safeParse(doc(block)).success;

describe("M6-20 the icon list", () => {
  it("is the 24 names in the order of the spec, one exported list", () => {
    expect([...LINK_ICONS]).toEqual([
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "threads",
      "link",
      "mail",
      "globe",
      "music",
      "video",
      "mic",
      "camera",
      "calendar",
      "bag",
      "ticket",
      "heart",
      "star",
      "book",
      "gift",
      "pin",
      "phone",
    ]);
    expect(new Set(LINK_ICONS).size).toBe(24);
  });

  it("gives every name its label, in the grid's order", () => {
    expect(LINK_ICONS.map((name) => LINK_ICON_LABELS[name])).toEqual([
      "Instagram",
      "TikTok",
      "YouTube",
      "X",
      "Facebook",
      "LinkedIn",
      "GitHub",
      "Threads",
      "Link",
      "Email",
      "Website",
      "Music",
      "Video",
      "Microphone",
      "Camera",
      "Calendar",
      "Shopping bag",
      "Ticket",
      "Heart",
      "Star",
      "Book",
      "Gift",
      "Location",
      "Phone",
    ]);
    expect(Object.keys(LINK_ICON_LABELS).sort()).toEqual([...LINK_ICONS].sort());
  });

  it("looks a name up in a fixed set: inherited keys and look-alikes are not names", () => {
    for (const name of LINK_ICONS) expect(isLinkIconName(name)).toBe(true);
    for (const bad of [
      "Instagram",
      "<script>",
      "__proto__",
      "constructor",
      "toString",
      "",
      " x",
      3,
      null,
    ])
      expect(isLinkIconName(bad), String(bad)).toBe(false);
  });
});

describe("M6-20 icon: the schema table", () => {
  it.each(LINK_ICONS)("the built-in name %s parses in the draft and at Publish", (name) => {
    const block = link({ icon: { type: "builtin", name } });
    expect(draftOk(block)).toBe(true);
    expect(publishOk(block)).toBe(true);
    expect(blockSchema.parse(block)).toMatchObject({ icon: { type: "builtin", name } });
    expect(publishBlockSchema.parse(block)).toMatchObject({ icon: { type: "builtin", name } });
  });

  it("an uploaded image reference parses in both forms", () => {
    const block = link({
      icon: { type: "image", image: { path: THUMB, width: 400, height: 400 } },
    });
    expect(draftOk(block)).toBe(true);
    expect(publishOk(block)).toBe(true);
  });

  it("a link without an icon is exactly what it was", () => {
    const block = link();
    const parsed = blockSchema.parse(block) as Record<string, unknown>;
    expect(parsed).toEqual(block);
    expect("icon" in parsed).toBe(false);
    expect("featured" in parsed).toBe(false);
    expect(draftOk(block)).toBe(true);
    expect(publishOk(block)).toBe(true);
  });

  it.each(["Instagram", "<script>", "__proto__", 'x"onload="alert(1)', "", "link ", "LINK"])(
    "the name %j is refused at Publish with the list sentence",
    (name) => {
      const block = link({ icon: { type: "builtin", name } });
      expect(publishOk(block)).toBe(false);
      expect(publishBlockSchema.safeParse(block).success).toBe(false);
      expect(collectPublishErrors(doc(block))).toEqual([
        {
          blockId: "link-aaaa-0001",
          field: "icon.name",
          message: "Pick an icon from the list.",
        },
      ]);
    },
  );

  it("a draft keeps any short name (the editor shows no icon, Publish names the field); a long one fails", () => {
    expect(draftOk(link({ icon: { type: "builtin", name: "Instagram" } }))).toBe(true);
    expect(draftOk(link({ icon: { type: "builtin", name: "x".repeat(64) } }))).toBe(true);
    expect(draftOk(link({ icon: { type: "builtin", name: "x".repeat(65) } }))).toBe(false);
    expect(draftOk(link({ icon: { type: "builtin", name: 3 } }))).toBe(false);
  });

  it.each([
    ["a URL", "https://evil.example/a.png"],
    ["a protocol-relative URL", "//evil.example/a.png"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a path with ..", `${OWNER_UID}/../${OTHER_UID}/avatar-0123456789ab.webp`],
    ["a leading ..", `../${OWNER_UID}/avatar-0123456789ab.webp`],
    ["an extra segment", `${OWNER_UID}/x/avatar-0123456789ab.webp`],
    ["an unsupported extension", `${OWNER_UID}/avatar-0123456789ab.svg`],
    ["a query string", `${OWNER_UID}/avatar-0123456789ab.webp?x=1`],
    ["no folder", "avatar-0123456789ab.webp"],
  ])("an image icon with %s as its path is refused in both forms", (_name, path) => {
    const block = link({ icon: { type: "image", image: { path, width: 400, height: 400 } } });
    expect(draftOk(block)).toBe(false);
    expect(publishOk(block)).toBe(false);
  });

  it("an image icon needs a whole reference", () => {
    expect(draftOk(link({ icon: { type: "image", image: { path: THUMB } } }))).toBe(false);
    expect(draftOk(link({ icon: { type: "image" } }))).toBe(false);
    expect(draftOk(link({ icon: { type: "image", image: null } }))).toBe(false);
    expect(
      publishOk(link({ icon: { type: "image", image: { path: THUMB, width: 0, height: 400 } } })),
    ).toBe(false);
  });

  it("there is no URL form: a url or href key is stripped, and a url-typed icon is refused", () => {
    const withUrl = blockSchema.parse(
      link({
        icon: {
          type: "image",
          image: { path: THUMB, width: 400, height: 400, url: "https://evil.example/i.png" },
          url: "https://evil.example/i.png",
          href: "https://evil.example/i.png",
        },
      }),
    ) as { icon: Record<string, unknown> };
    expect(Object.keys(withUrl.icon).sort()).toEqual(["image", "type"]);
    expect(Object.keys(withUrl.icon.image as object).sort()).toEqual(["height", "path", "width"]);

    const builtin = publishBlockSchema.parse(
      link({
        icon: { type: "builtin", name: "link", url: "https://evil.example/i.png", href: "x" },
      }),
    ) as { icon: Record<string, unknown> };
    expect(Object.keys(builtin.icon).sort()).toEqual(["name", "type"]);

    for (const icon of [
      { type: "url", url: "https://evil.example/i.png" },
      { type: "favicon", host: "example.com" },
      { url: "https://evil.example/i.png" },
      "https://evil.example/i.png",
      "link",
      null,
      42,
      [],
    ]) {
      expect(draftOk(link({ icon })), JSON.stringify(icon)).toBe(false);
      expect(publishOk(link({ icon })), JSON.stringify(icon)).toBe(false);
    }
  });

  it("a hidden block is exempt from the Publish checks (Publish drops it)", () => {
    const block = link({ visible: false, icon: { type: "builtin", name: "Instagram" } });
    expect(publishOk(block)).toBe(true);
    expect(toPublishForm(doc(block) as DraftDoc, null).blocks).toEqual([]);
  });
});

describe("M6-20 uploads: thumbnails use the profile photo's kind", () => {
  it("there is no new upload kind: UPLOAD_KINDS is still avatar, background and content", () => {
    expect([...UPLOAD_KINDS]).toEqual(["avatar", "background", "content"]);
    expect(LINK_THUMB_UPLOAD_KIND).toBe("avatar");
    expect(UPLOAD_KINDS).toContain(LINK_THUMB_UPLOAD_KIND);
  });

  it("an avatar is a square 400px WebP of at most 100 KB named avatar-{hash}.webp", () => {
    expect(AVATAR_SIZE).toBe(400);
    expect(OUTPUT_BYTE_BUDGET.avatar).toBe(100 * 1024);
    expect(STORED_NAME_PREFIX.avatar).toBe("avatar");
  });

  it("every stored path still matches the M5-13 pattern, and a thumbnail's does", () => {
    expect(STORED_PATH_PATTERN.source).toBe(
      "^[0-9a-f-]{36}\\/(?:avatar|bg|img)-[0-9a-f]{12,}[.]webp$",
    );
    expect(STORED_PATH_PATTERN.test(THUMB)).toBe(true);
    expect(imageRefSchema.safeParse({ path: THUMB, width: 400, height: 400 }).success).toBe(true);
  });
});

describe("M6-20 the publish form", () => {
  const draftOf = (blocks: unknown[]): DraftDoc =>
    ({ ...fullDraft, theme: { ref: null, overrides: {} }, blocks }) as DraftDoc;

  it("copies the built-in name, or the image's path, width and height and nothing else", () => {
    const stored = {
      type: "image",
      image: { path: THUMB, width: 400, height: 400, url: "https://evil.example/x", extra: 1 },
      href: "https://evil.example/x",
    };
    const form = toPublishForm(
      draftOf([
        link(
          { icon: { type: "builtin", name: "star", href: "https://evil.example/x" } },
          "link-aaaa-0001",
        ),
        link({ icon: stored }, "link-aaaa-0002"),
        link({}, "link-aaaa-0003"),
      ]),
      noirTokens,
    );
    expect(form.blocks[0]).toEqual({
      id: "link-aaaa-0001",
      type: "link",
      visible: true,
      label: "Book a session",
      url: "https://example.com/book",
      icon: { type: "builtin", name: "star" },
    });
    expect((form.blocks[1] as { icon: unknown }).icon).toEqual({
      type: "image",
      image: { path: THUMB, width: 400, height: 400 },
    });
    expect("icon" in form.blocks[2]!).toBe(false);
    expect("featured" in form.blocks[2]!).toBe(false);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("two equal drafts give deep-equal forms, however their keys are ordered", () => {
    const a = draftOf([link({ icon: { type: "builtin", name: "star" }, featured: "pulse" })]);
    const b = draftOf([
      {
        featured: "pulse",
        icon: { name: "star", type: "builtin" },
        url: "https://example.com/book",
        label: "Book a session",
        visible: true,
        type: "link",
        id: "link-aaaa-0001",
      },
    ]);
    expect(publishFormsEqual(toPublishForm(a, noirTokens), toPublishForm(b, noirTokens))).toBe(
      true,
    );
  });

  it("changing a block's icon, or adding one, flips the chip to Unpublished changes", () => {
    const base = draftOf([link({ icon: { type: "builtin", name: "star" } })]);
    const published = toPublishForm(base, noirTokens);
    const status = (draft: DraftDoc) =>
      computePublishStatus({
        hasPublished: true,
        published,
        form: toPublishForm(draft, noirTokens),
      });
    expect(status(base)).toBe("published");
    expect(status(draftOf([link({ icon: { type: "builtin", name: "heart" } })]))).toBe(
      "unpublished-changes",
    );
    expect(status(draftOf([link()]))).toBe("unpublished-changes");
    expect(
      status(
        draftOf([
          link({ icon: { type: "image", image: { path: THUMB, width: 400, height: 400 } } }),
        ]),
      ),
    ).toBe("unpublished-changes");
  });

  it("collectImageRefs includes the link thumbnails (the history engine checks them)", () => {
    const ref = { path: THUMB, width: 400, height: 400 };
    const refs = collectImageRefs(
      draftOf([
        link({ icon: { type: "image", image: ref } }),
        link({ icon: { type: "builtin", name: "star" } }, "link-aaaa-0002"),
      ]),
    );
    expect(refs).toContainEqual(ref);
    expect(refs.filter((r) => r.path === THUMB)).toHaveLength(1);
  });
});

describe("M6-22 featured: the schema", () => {
  it.each(LINK_FEATURED)(
    "%s parses in both forms and is copied to the publish form",
    (featured) => {
      const block = link({ featured });
      expect(draftOk(block)).toBe(true);
      expect(publishOk(block)).toBe(true);
      const form = toPublishForm(doc(block) as DraftDoc, null);
      expect((form.blocks[0] as { featured?: string }).featured).toBe(featured);
    },
  );

  it("is the three words, and an absent value is not featured", () => {
    expect([...LINK_FEATURED]).toEqual(["bold", "pulse", "shine"]);
    for (const value of LINK_FEATURED) expect(isLinkFeatured(value)).toBe(true);
    for (const bad of ["blink", "BOLD", "bold ", "__proto__", "", true, 1, null, undefined])
      expect(isLinkFeatured(bad), String(bad)).toBe(false);
    expect("featured" in toPublishForm(doc(link()) as DraftDoc, null).blocks[0]!).toBe(false);
  });

  it.each([["blink"], [true], [1], ['bold"onmouseover="x'], ["BOLD"], [""]])(
    "%j is refused at Publish",
    (featured) => {
      const block = link({ featured });
      expect(publishOk(block)).toBe(false);
      expect(publishBlockSchema.safeParse(block).success).toBe(false);
    },
  );

  it("a bad word is named under the field `featured`", () => {
    expect(collectPublishErrors(doc(link({ featured: "blink" })))).toEqual([
      {
        blockId: "link-aaaa-0001",
        field: "featured",
        message: "Pick a featured style from the list.",
      },
    ]);
  });

  it("unknown keys are stripped, and `featured` never travels in the overrides", () => {
    const parsed = blockSchema.parse(link({ featured: "bold", nope: 1 })) as Record<
      string,
      unknown
    >;
    expect(parsed.nope).toBeUndefined();
    const withOverride = publishBlockSchema.parse(
      link({ overrides: { accent: "#C46A4F", featured: "bold" } }),
    ) as { overrides: Record<string, unknown> };
    expect(withOverride.overrides).toEqual({ accent: "#C46A4F" });
    const form = toPublishForm(
      doc(link({ overrides: { accent: "#C46A4F", featured: "bold" } })) as DraftDoc,
      null,
    );
    expect((form.blocks[0] as { overrides: object }).overrides).toEqual({ accent: "#C46A4F" });
  });

  it("the M3-18 rule holds: no font, spacing or background override; the keys are the ten of M6-45", () => {
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
    const resolved = resolveBlockTokens(noirTokens, { featured: "bold" } as never);
    expect(resolved).toEqual(noirTokens);
  });
});

describe("M6-22 featured: at most 3 visible links per page", () => {
  const featuredLinks = (count: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, i) =>
      link({ featured: "bold", ...extra }, `link-feat-${String(i + 1).padStart(4, "0")}`),
    );

  it("is LIMITS.featuredLinks = 3", () => {
    expect(LIMITS.featuredLinks).toBe(3);
  });

  it("three pass; the 4th, in page order, is refused and named", () => {
    expect(publishDocSchema.safeParse(doc(...featuredLinks(3))).success).toBe(true);
    const four = doc(...featuredLinks(4));
    expect(publishDocSchema.safeParse(four).success).toBe(false);
    expect(collectPublishErrors(four)).toEqual([
      {
        blockId: "link-feat-0004",
        field: "featured",
        message: "Feature up to 3 links. Turn one off to feature another.",
      },
    ]);
    expect(FEATURED_LIMIT_MESSAGE).toBe("Feature up to 3 links. Turn one off to feature another.");
  });

  it("a draft with 5 featured links is a valid draft (the database takes it) but not publishable", () => {
    const five = doc(...featuredLinks(5));
    expect(draftDocSchema.safeParse(five).success).toBe(true);
    const errors = collectPublishErrors(five);
    expect(errors.map((e) => e.blockId)).toEqual(["link-feat-0004", "link-feat-0005"]);
    expect(errors.every((e) => e.field === "featured")).toBe(true);
  });

  it("the count is by page order, not by the order the blocks were featured in", () => {
    const blocks = [
      link({}, "link-plain-0001"),
      ...featuredLinks(2),
      link({}, "link-plain-0002"),
      link({ featured: "shine" }, "link-feat-0003"),
      link({ featured: "pulse" }, "link-feat-0004"),
    ];
    expect(featuredOverLimit(blocks as never)).toEqual([5]);
    expect(collectPublishErrors(doc(...blocks)).map((e) => e.blockId)).toEqual(["link-feat-0004"]);
  });

  it("hidden blocks do not count: Publish drops them", () => {
    const blocks = [
      ...featuredLinks(3),
      link({ featured: "bold", visible: false }, "link-hide-0001"),
    ];
    expect(publishDocSchema.safeParse(doc(...blocks)).success).toBe(true);
    const form = toPublishForm(doc(...blocks) as DraftDoc, null);
    expect(form.blocks).toHaveLength(3);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    // A hidden block in front does not use up a place either.
    const front = [
      link({ featured: "bold", visible: false }, "link-hide-0002"),
      ...featuredLinks(3),
    ];
    expect(publishDocSchema.safeParse(doc(...front)).success).toBe(true);
  });

  it("only links count: other block types are not featured links", () => {
    const blocks = [
      ...featuredLinks(3),
      {
        id: "card-aaaa-0001",
        type: "card",
        visible: true,
        title: "T",
        caption: "",
        url: "https://example.com",
        image: null,
        featured: "bold",
      },
    ];
    expect(featuredOverLimit(blocks as never)).toEqual([]);
  });

  it("the stored form is held to the limit too", () => {
    const form = toPublishForm(doc(...featuredLinks(3)) as DraftDoc, noirTokens);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
    const over = {
      ...form,
      blocks: [...form.blocks, { ...form.blocks[0]!, id: "link-feat-0009" }],
    };
    expect(publishedDocSchema.safeParse(over).success).toBe(false);
  });
});

describe("M6-20 no fetching of icons from other sites", () => {
  const ROOT = resolve(process.cwd());
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
  const code = (path: string) =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const FAVICON_HOSTS =
    /google\.com\/s2\/favicons|icon\.horse|favicon\.ico|favicons?\b.*service|gstatic\.com\/faviconV2|duckduckgo\.com\/ip3/i;

  const rendererFiles = readdirSync(join(ROOT, "src/components/page"))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `src/components/page/${f}`);
  const iconCode = [
    "src/lib/document/schema.ts",
    "src/lib/document/link-icons.ts",
    "src/lib/document/publish.ts",
    "src/lib/publish/core.ts",
    "src/components/blocks/forms/link-form.tsx",
    "src/components/blocks/forms/link-icon-field.tsx",
    "src/components/blocks/forms/link-feature-field.tsx",
    "src/components/blocks/forms/featured-context.tsx",
    "src/components/blocks/featured-chip.tsx",
    ...rendererFiles,
  ];

  it("the document has no URL-valued icon field: the icon is a name or an image reference", () => {
    const schema = code("src/lib/document/schema.ts");
    const icon = schema.slice(schema.indexOf("icon: z"), schema.indexOf("featured:"));
    expect(icon).toContain('z.literal("builtin")');
    expect(icon).toContain("imageRefSchema");
    expect(icon).not.toMatch(/\burl\b|httpUrl|z\.url|\.url\(/);
  });

  it.each(iconCode)("%s makes no fetch and names no favicon service", (path) => {
    const source = code(path);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(FAVICON_HOSTS);
  });

  it("the one fetch in the editor's icon code is the upload route, with a constant address", () => {
    const upload = code("src/components/blocks/forms/link-thumb-upload.tsx");
    const calls = [...upload.matchAll(/\bfetch\s*\(([^)]*)\)/g)].map((m) =>
      m[1]!.split(",")[0]!.trim(),
    );
    expect(calls).toEqual(['"/api/media"']);
    expect(upload).not.toMatch(FAVICON_HOSTS);
    expect(upload).toMatch(/body\.append\("kind", LINK_THUMB_UPLOAD_KIND\)/);
  });

  it("a thumbnail's URL comes from mediaUrl(path) of a validated reference, nothing else", () => {
    const renderer = code("src/components/page/link-icon.tsx");
    expect(renderer).toMatch(/src=\{mediaUrl\(image\.path\)\}/);
    expect(renderer).toMatch(/IMAGE_PATH_PATTERN\.test\(/);
    expect(renderer).not.toMatch(/\bsrc=\{(?!mediaUrl)/);
    expect(renderer).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
