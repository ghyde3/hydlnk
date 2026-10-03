import { z } from "zod";
import { blockOverridesSchema, storedTokenSetSchema, tokenOverridesSchema } from "@/lib/theme";
import { embedErrorMessage, parseEmbed } from "./embed";
import { IMAGE_SHAPES, IMAGE_SHAPE_MESSAGE, focusSchema, type Focus } from "./focus";
import { BLOCK_ID_PATTERN } from "./ids";
import { LIMITS, codePointLength } from "./limits";
import { MARK_MESSAGES, checkMarks, requireMarkRanges } from "./marks";
import {
  FEATURED_LIMIT_MESSAGE,
  LINK_FEATURED,
  LINK_FEATURED_VALUE_MESSAGE,
  LINK_ICONS,
  LINK_ICON_ERROR_MESSAGE,
  featuredOverLimit,
} from "./link-icons";
import { SHARE_IMAGE_MIN_WIDTH, SHARE_IMAGE_WIDTH_MESSAGE } from "./share";
import {
  PHOTO_BORDERS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  PROFILE_OPTION_DEFAULTS,
  PROFILE_OPTION_MESSAGES,
  type ProfileOptions,
} from "./profile-options";
import { EMAIL_ERROR_MESSAGE, URL_ERROR_MESSAGE, isEmailAddress, isHttpUrl } from "./url";

/**
 * The page document (`pages.draft`) and the published document (`pages.published`).
 *
 * Three schemas, one set of block rules:
 *   draftDocSchema      lenient: half-typed content autosaves (empty strings, any URL string).
 *   publishDocSchema    strict, for a draft-shaped document: what the Publish gate runs on the
 *                       draft. Visible blocks must be complete and safe; hidden blocks only have to
 *                       be well-formed (they are dropped by `toPublishForm`).
 *   publishedDocSchema  strict, for the stored form `toPublishForm` produces (what the public
 *                       page loads from `pages.published`).
 * Everything is stripped to known keys on parse, so unknown keys never reach `published`.
 */

// Block types -----------------------------------------------------------------------------------

/** The nine block types, in the order of the editor's "Add a block" chips. */
export const BLOCK_TYPES = [
  "link",
  "card",
  "header",
  "text",
  "image",
  "social",
  "embed",
  "grid",
  "divider",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  link: "Link",
  card: "Card",
  header: "Header",
  text: "Text",
  image: "Image",
  social: "Social",
  embed: "Embed",
  grid: "Grid",
  divider: "Divider",
};

/** Social platforms, in the order of the platform select. `email` stores an address, not a URL. */
export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "threads",
  "email",
  "website",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialWebPlatform = Exclude<SocialPlatform, "email">;

const SOCIAL_WEB_PLATFORMS = SOCIAL_PLATFORMS.filter(
  (platform): platform is SocialWebPlatform => platform !== "email",
);

/** Display name of each platform: the editor's select and the icon's `aria-label`. */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  github: "GitHub",
  threads: "Threads",
  email: "Email",
  website: "Website",
};

// Field rules -----------------------------------------------------------------------------------

type Mode = "draft" | "publish";

// Control characters: U+0000-U+001F and U+007F-U+009F; only text blocks may keep newlines.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
// Bidi override (U+202A-U+202E) and isolate (U+2066-U+2069) characters.
const BIDI = /[‪-‮⁦-⁩]/;

/**
 * `value` without the characters the Publish gate refuses in text: control characters (a newline
 * stays when `multiline`), bidi overrides and isolates. Trimmed. The same `CONTROL` and `BIDI` rules
 * as `text()` below, for the one place that shows a draft without the gate: the share link (M6-10).
 */
export function stripHiddenCharacters(value: string, opts: { multiline?: boolean } = {}): string {
  const controls = opts.multiline ? CONTROL_EXCEPT_NEWLINE : CONTROL;
  return value
    .replace(new RegExp(controls.source, "g"), "")
    .replace(new RegExp(BIDI.source, "g"), "")
    .trim();
}

export const IMAGE_PATH_PATTERN = /^[0-9a-f-]{36}\/[a-z0-9-]{8,64}[.](?:jpg|png|webp)$/;

const idSchema = z.string().regex(BLOCK_ID_PATTERN, {
  error: "Ids are 8-24 letters, digits, _ or -.",
});

/**
 * Trimmed text, at most `max` code points. At Publish it may also be required (non-empty) and
 * must not contain control characters (newlines only when `multiline`) or bidi override/isolate
 * characters.
 */
function text(
  mode: Mode,
  opts: { max: number; required?: string; multiline?: boolean },
): z.ZodString {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (codePointLength(value) > opts.max) {
        ctx.addIssue({ code: "custom", message: `Use ${opts.max} characters or fewer.` });
      }
      if (mode !== "publish") return;
      if (opts.required && value === "") {
        ctx.addIssue({ code: "custom", message: opts.required });
      }
      if ((opts.multiline ? CONTROL_EXCEPT_NEWLINE : CONTROL).test(value) || BIDI.test(value)) {
        ctx.addIssue({
          code: "custom",
          message: opts.multiline
            ? "Remove the hidden control characters."
            : "Remove line breaks and hidden control characters.",
        });
      }
    });
}

/**
 * A URL string. A draft keeps whatever was typed (an empty or invalid URL autosaves and shows its
 * inline error); Publish requires a valid http(s) URL, or, when `optional`, an empty string.
 */
function url(mode: Mode, opts: { optional?: boolean; embed?: boolean } = {}): z.ZodString {
  const base = z.string().trim().max(LIMITS.draftUrl, { error: URL_ERROR_MESSAGE });
  if (mode === "draft") return base;
  return base.superRefine((value, ctx) => {
    if (value === "" && opts.optional) return;
    if (opts.embed) {
      if (parseEmbed(value) === null)
        ctx.addIssue({ code: "custom", message: embedErrorMessage(value) });
    } else if (!isHttpUrl(value)) {
      ctx.addIssue({ code: "custom", message: URL_ERROR_MESSAGE });
    }
  });
}

function email(mode: Mode): z.ZodString {
  const base = z.string().trim().max(LIMITS.email, { error: EMAIL_ERROR_MESSAGE });
  if (mode === "draft") return base;
  return base.refine(isEmailAddress, { error: EMAIL_ERROR_MESSAGE });
}

// Text marks ------------------------------------------------------------------------------------

/**
 * One mark of a text block (M6-28). Unknown keys (`href`, `style`, `class`...) are stripped and
 * another `type` fails. The offsets are plain finite numbers in both forms here: `toPublishForm`
 * clips them to the text, so an offset past the end is never an error, and the stored published form
 * is held to whole numbers inside the text by `requireMarkRanges`. A link's address follows the
 * URL rule (a draft keeps any string, Publish wants http(s)).
 */
function markSchema(mode: Mode) {
  const range = { start: z.number(), end: z.number() };
  return z.discriminatedUnion(
    "type",
    [
      z.object({ type: z.literal("bold"), ...range }),
      z.object({ type: z.literal("italic"), ...range }),
      z.object({ type: z.literal("link"), ...range, id: idSchema, url: url(mode) }),
    ],
    { error: MARK_MESSAGES.unsupported },
  );
}

/** The `marks` field: at most 30 entries; at Publish also at most 10 links and none overlapping. */
function marksField(mode: Mode) {
  const base = z.array(markSchema(mode)).max(LIMITS.textMarks, { error: MARK_MESSAGES.tooMany });
  return (
    mode === "publish" ? base.superRefine((marks, ctx) => checkMarks(marks, ctx)) : base
  ).optional();
}

// Image references ------------------------------------------------------------------------------

/**
 * A reference to an uploaded image: `{path, width, height}`, where `path` is
 * `{owner uid}/{file name}.{jpg|png|webp}` inside the `page-media` bucket. No URL form exists, so
 * a tenant cannot point the renderer at a third-party image.
 */
export const imageRefSchema = z.object({
  path: z.string().regex(IMAGE_PATH_PATTERN, { error: "Not a valid image reference." }),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  /**
   * Where the picture stays in view when a frame crops it (M6-23): `{x, y}`, two numbers from 0 to 1
   * (see ./focus). Optional, so every older reference is still valid. Published only for card
   * images, image blocks and the share image; `toPublishForm` drops it everywhere else.
   */
  focus: focusSchema.optional(),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

/**
 * The reference of a card or an image block in a DRAFT: the same, but its focus is kept as it
 * came. A draft written straight to the database can hold any value there, and a bad one in a
 * hidden block must not stop Publish (hidden blocks are dropped); Publish checks the focus of every
 * visible block with the strict `imageRefSchema`. Typed as a `Focus` because every reader goes
 * through `focusOf` / `objectPositionOf`, which accept nothing else.
 */
const draftBlockImageRef = imageRefSchema.extend({ focus: z.custom<Focus>().optional() });

// Blocks ----------------------------------------------------------------------------------------

/**
 * A block's own style (M3-18, M6-45), on every block type: only the ten keys of
 * `BLOCK_OVERRIDE_KEYS`; others are stripped. Invalid values for them fail, in the draft as well as
 * at Publish, so a hostile value never reaches `pages.published`. Social icons and grid cells carry
 * none of their own: styling is per block.
 */
const blockOverrides = z.object(blockOverridesSchema.shape);

function buildBlocks(mode: Mode) {
  const publish = mode === "publish";
  const common = { id: idSchema, visible: z.boolean().default(true) };

  const link = z.object({
    ...common,
    type: z.literal("link"),
    label: text(mode, { max: LIMITS.linkLabel, required: "Add a link label." }),
    url: url(mode),
    /**
     * An icon or a small image next to the label (M6-20): one of the 24 built-in names, or an
     * uploaded image reference. There is no URL form. A draft keeps any short name (the editor
     * shows no icon for it and Publish names the field); Publish wants one of the 24. The image
     * reference is strict in both forms, like a card's.
     */
    icon: z
      .discriminatedUnion(
        "type",
        [
          z.object({
            type: z.literal("builtin"),
            name: publish
              ? z.enum(LINK_ICONS, { error: LINK_ICON_ERROR_MESSAGE })
              : z.string().max(64),
          }),
          z.object({ type: z.literal("image"), image: imageRefSchema }),
        ],
        { error: LINK_ICON_ERROR_MESSAGE },
      )
      .optional(),
    /**
     * A featured link (M6-22): the bold style, plus a gentle motion for `pulse` and `shine`. Absent
     * means not featured. A block field, never a token override. A draft keeps any short string;
     * Publish wants one of the three words and at most `LIMITS.featuredLinks` visible links.
     */
    featured: (publish
      ? z.enum(LINK_FEATURED, { error: LINK_FEATURED_VALUE_MESSAGE })
      : z.string().max(32)
    ).optional(),
    overrides: blockOverrides.optional(),
  });

  const card = z.object({
    ...common,
    type: z.literal("card"),
    title: text(mode, { max: LIMITS.cardTitle, required: "Add a card title." }),
    caption: text(mode, { max: LIMITS.cardCaption }),
    url: url(mode),
    image: (publish ? imageRefSchema : draftBlockImageRef).nullable(),
    overrides: blockOverrides.optional(),
  });

  const header = z.object({
    ...common,
    type: z.literal("header"),
    text: text(mode, { max: LIMITS.headerText, required: "Add a heading." }),
    overrides: blockOverrides.optional(),
  });

  const textBlock = z.object({
    ...common,
    type: z.literal("text"),
    text: text(mode, { max: LIMITS.text, required: "Add some text.", multiline: true }),
    /**
     * Bold, italic and links as structured ranges (M6-28), never syntax inside the text. Optional,
     * so a text block without it renders and publishes as it always did. See ./marks.
     */
    marks: marksField(mode),
    overrides: blockOverrides.optional(),
  });

  const image = z.object({
    ...common,
    type: z.literal("image"),
    image: publish
      ? imageRefSchema.nullable().refine((value) => value !== null, { error: "Upload an image." })
      : draftBlockImageRef.nullable(),
    /**
     * The frame the picture is cropped to (M6-23): `square`, `landscape` or `wide`. Absent means
     * the original shape. A draft keeps whatever it holds (a hidden block with a bad value must not
     * stop Publish, and the editor shows the original shape for one it does not know); Publish
     * wants one of the three, and every reader goes through `pickShape`.
     */
    shape: (publish
      ? z.enum(IMAGE_SHAPES, { error: IMAGE_SHAPE_MESSAGE })
      : z.custom<string>()
    ).optional(),
    alt: text(mode, { max: LIMITS.imageAlt, required: "Add a short description of this image." }),
    url: url(mode, { optional: true }).optional(),
    overrides: blockOverrides.optional(),
  });

  const socialIcon = z.discriminatedUnion("platform", [
    z.object({ id: idSchema, platform: z.literal("email"), address: email(mode) }),
    z.object({
      id: idSchema,
      platform: z.enum(SOCIAL_WEB_PLATFORMS as [SocialWebPlatform, ...SocialWebPlatform[]]),
      url: url(mode),
    }),
  ]);
  const social = z.object({
    ...common,
    type: z.literal("social"),
    icons: z.array(socialIcon).min(LIMITS.socialIconsMin).max(LIMITS.socialIconsMax),
    overrides: blockOverrides.optional(),
  });

  const embed = z.object({
    ...common,
    type: z.literal("embed"),
    url: url(mode, { embed: true }),
    caption: text(mode, { max: LIMITS.embedCaption }),
    overrides: blockOverrides.optional(),
  });

  const gridCell = z.object({
    id: idSchema,
    title: text(mode, { max: LIMITS.cellTitle, required: "Add a title." }),
    subtitle: text(mode, { max: LIMITS.cellSubtitle }),
    url: url(mode),
  });
  const grid = z.object({
    ...common,
    type: z.literal("grid"),
    cells: z.array(gridCell).min(LIMITS.gridCellsMin).max(LIMITS.gridCellsMax),
    overrides: blockOverrides.optional(),
  });

  const divider = z.object({
    ...common,
    type: z.literal("divider"),
    overrides: blockOverrides.optional(),
  });

  const block = z.discriminatedUnion("type", [
    link,
    card,
    header,
    textBlock,
    image,
    social,
    embed,
    grid,
    divider,
  ]);

  // The display options (M6-15, M6-17) are the same in both modes: a bad value fails the draft
  // parse itself, with the Publish gate's wording, so Publish names the field. Each has a default,
  // so a document stored before they existed parses with them filled in.
  const profile = z.object({
    name: text(mode, { max: LIMITS.displayName, required: "Add a display name." }),
    bio: text(mode, { max: LIMITS.bio }),
    photo: imageRefSchema.nullable(),
    photoShape: z
      .enum(PHOTO_SHAPES, { error: PROFILE_OPTION_MESSAGES.photoShape })
      .default(PROFILE_OPTION_DEFAULTS.photoShape),
    photoSize: z
      .enum(PHOTO_SIZES, { error: PROFILE_OPTION_MESSAGES.photoSize })
      .default(PROFILE_OPTION_DEFAULTS.photoSize),
    photoBorder: z
      .enum(PHOTO_BORDERS, { error: PROFILE_OPTION_MESSAGES.photoBorder })
      .default(PROFILE_OPTION_DEFAULTS.photoBorder),
    showPhoto: z
      .boolean({ error: PROFILE_OPTION_MESSAGES.showPhoto })
      .default(PROFILE_OPTION_DEFAULTS.showPhoto),
    showName: z
      .boolean({ error: PROFILE_OPTION_MESSAGES.showName })
      .default(PROFILE_OPTION_DEFAULTS.showName),
    showBio: z
      .boolean({ error: PROFILE_OPTION_MESSAGES.showBio })
      .default(PROFILE_OPTION_DEFAULTS.showBio),
  });

  // The share card (M6-32): the title, description and image of the page's link preview. Page-level,
  // not a block. Every key is optional in both forms (an older document has none); the Publish form
  // drops the empty ones (`publishShare` in ./share). One line each: `text()` gives the wording.
  const share = z.object({
    title: text(mode, { max: LIMITS.shareTitle }).optional(),
    description: text(mode, { max: LIMITS.shareDescription }).optional(),
    image: (publish
      ? imageRefSchema
          .nullable()
          .refine((value) => value === null || value.width >= SHARE_IMAGE_MIN_WIDTH, {
            error: SHARE_IMAGE_WIDTH_MESSAGE,
          })
      : imageRefSchema.nullable()
    ).optional(),
  });

  return { block, profile, share };
}

const lenient = buildBlocks("draft");
const strict = buildBlocks("publish");

export const blockSchema = lenient.block;
export const publishBlockSchema = strict.block;

export type Block = z.infer<typeof blockSchema>;
export type LinkBlock = Extract<Block, { type: "link" }>;
export type CardBlock = Extract<Block, { type: "card" }>;
export type HeaderBlock = Extract<Block, { type: "header" }>;
export type TextBlock = Extract<Block, { type: "text" }>;
export type ImageBlock = Extract<Block, { type: "image" }>;
export type SocialBlock = Extract<Block, { type: "social" }>;
export type EmbedBlock = Extract<Block, { type: "embed" }>;
export type GridBlock = Extract<Block, { type: "grid" }>;
export type DividerBlock = Extract<Block, { type: "divider" }>;
export type SocialIcon = SocialBlock["icons"][number];
export type GridCell = GridBlock["cells"][number];
/**
 * The profile. The six display options are optional in the TypeScript type, although parsing always
 * fills them: a draft or published document built by hand (a fixture, an older code path) may leave
 * them out, and every reader goes through `resolveProfileOptions` / `pickOption`, which apply the
 * default. The editor state and `toPublishForm` always carry all six.
 */
export type Profile = Omit<z.infer<typeof lenient.profile>, keyof ProfileOptions> &
  Partial<ProfileOptions>;
/** The share card (M6-32): every key optional; `image` is an uploaded image reference or null. */
export type Share = z.infer<typeof lenient.share>;

// Documents -------------------------------------------------------------------------------------

const themeSchema = z.object({
  /** A theme row id (any UUID shape, so seeded system themes validate), or null for the default. */
  ref: z.guid().nullable(),
  /** Page-level token overrides: the Milestone 0 token model, any subset of token keys. */
  overrides: tokenOverridesSchema,
});
export type DocTheme = z.infer<typeof themeSchema>;

const tooManyBlocks = { error: `Use ${LIMITS.blocks} blocks or fewer.` };

/** Ids are analytics keys: no two blocks, icons or cells in a document may share one. */
function requireUniqueIds(doc: { blocks: readonly Block[] }, ctx: z.core.$RefinementCtx): void {
  const seen = new Set<string>();
  const check = (id: unknown, path: (string | number)[]) => {
    if (typeof id !== "string") return;
    if (seen.has(id)) {
      ctx.addIssue({ code: "custom", path, message: "Ids must be unique within a page." });
    }
    seen.add(id);
  };
  doc.blocks.forEach((block, index) => {
    check(block.id, ["blocks", index, "id"]);
    if (block.type === "social") {
      block.icons.forEach((icon, i) => check(icon.id, ["blocks", index, "icons", i, "id"]));
    } else if (block.type === "text") {
      // A link inside a text block is clicked and counted by its own id (M6-28).
      (block.marks ?? []).forEach((mark, i) => {
        if (mark.type === "link") check(mark.id, ["blocks", index, "marks", i, "id"]);
      });
    } else if (block.type === "grid") {
      block.cells.forEach((cell, i) => check(cell.id, ["blocks", index, "cells", i, "id"]));
    }
  });
}

/** The draft: what the editor autosaves. Lenient about completeness; strict about structure. */
export const draftDocSchema = z
  .object({
    version: z.literal(1),
    /** Bumped by one on every save; the stale-tab guard filters the update on the stored value. */
    rev: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    profile: lenient.profile,
    /** The share card (M6-32). Absent until one of its three fields is filled in. */
    share: lenient.share.optional(),
    theme: themeSchema,
    blocks: z.array(lenient.block).max(LIMITS.blocks, tooManyBlocks),
  })
  .superRefine(requireUniqueIds);
export type DraftDoc = Omit<z.infer<typeof draftDocSchema>, "profile"> & { profile: Profile };

/**
 * The Publish gate's validator for a draft-shaped document. Everything `draftDocSchema` checks,
 * plus: the display name is required, and every visible block is complete and safe (required
 * fields filled, http(s) URLs only, embed URLs on the allowlist, uploaded images, no control or
 * bidi characters, newlines only in text blocks). Hidden blocks are exempt from the completeness
 * rules because Publish drops them. Its issues carry the same paths as the draft, with messages
 * written for the editor ("Add a link label.").
 */
export const publishDocSchema = draftDocSchema.superRefine((doc, ctx) => {
  const profile = strict.profile.safeParse(doc.profile);
  if (!profile.success) {
    for (const issue of profile.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: ["profile", ...issue.path] });
    }
  }
  if (doc.share !== undefined) {
    const share = strict.share.safeParse(doc.share);
    if (!share.success) {
      for (const issue of share.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: ["share", ...issue.path] });
      }
    }
  }
  doc.blocks.forEach((block, index) => {
    if (block.visible === false) return;
    const result = strict.block.safeParse(block);
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: ["blocks", index, ...issue.path],
      });
    }
  });
  // M6-22: at most LIMITS.featuredLinks visible featured links; the 4th (in page order) is named.
  for (const index of featuredOverLimit(doc.blocks)) {
    ctx.addIssue({
      code: "custom",
      message: FEATURED_LIMIT_MESSAGE,
      path: ["blocks", index, "featured"],
    });
  }
});

/**
 * The stored published form (`pages.published`): the draft without `rev`, with hidden blocks
 * removed and the fully resolved `tokens` frozen next to the content. Produced by `toPublishForm`;
 * the public page parses it with this schema and renders only from it.
 */
export const publishedDocSchema = z
  .object({
    version: z.literal(1),
    profile: strict.profile,
    /** The share card, with its empty fields left out (M6-32); absent when all three are empty. */
    share: strict.share.optional(),
    theme: themeSchema,
    /**
     * Every token, resolved: system default, then theme, then page overrides. A document stored
     * before the gradient tokens (M6-41) has 23 keys; the three missing ones take their defaults.
     */
    tokens: storedTokenSetSchema,
    blocks: z.array(strict.block).max(LIMITS.blocks, tooManyBlocks),
  })
  .superRefine(requireUniqueIds)
  .superRefine(requireMarkRanges)
  .superRefine((doc, ctx) => {
    for (const index of featuredOverLimit(doc.blocks)) {
      ctx.addIssue({
        code: "custom",
        message: FEATURED_LIMIT_MESSAGE,
        path: ["blocks", index, "featured"],
      });
    }
  });
export type PublishDoc = Omit<z.infer<typeof publishedDocSchema>, "profile"> & {
  profile: Profile;
};
