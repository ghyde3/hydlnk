import { z } from "zod";
import { blockOverridesSchema, tokenOverridesSchema, tokenSetSchema } from "@/lib/theme";
import { EMBED_ERROR_MESSAGE, parseEmbed } from "./embed";
import { BLOCK_ID_PATTERN } from "./ids";
import { LIMITS, codePointLength } from "./limits";
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
        ctx.addIssue({ code: "custom", message: EMBED_ERROR_MESSAGE });
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
});
export type ImageRef = z.infer<typeof imageRefSchema>;

// Blocks ----------------------------------------------------------------------------------------

/** Only the keys the resolver allows; others are stripped. Invalid values for them fail. */
const blockOverrides = z.object(blockOverridesSchema.shape);

function buildBlocks(mode: Mode) {
  const publish = mode === "publish";
  const common = { id: idSchema, visible: z.boolean().default(true) };

  const link = z.object({
    ...common,
    type: z.literal("link"),
    label: text(mode, { max: LIMITS.linkLabel, required: "Add a link label." }),
    url: url(mode),
    overrides: blockOverrides.optional(),
  });

  const card = z.object({
    ...common,
    type: z.literal("card"),
    title: text(mode, { max: LIMITS.cardTitle, required: "Add a card title." }),
    caption: text(mode, { max: LIMITS.cardCaption }),
    url: url(mode),
    image: imageRefSchema.nullable(),
    overrides: blockOverrides.optional(),
  });

  const header = z.object({
    ...common,
    type: z.literal("header"),
    text: text(mode, { max: LIMITS.headerText, required: "Add a heading." }),
  });

  const textBlock = z.object({
    ...common,
    type: z.literal("text"),
    text: text(mode, { max: LIMITS.text, required: "Add some text.", multiline: true }),
  });

  const image = z.object({
    ...common,
    type: z.literal("image"),
    image: publish
      ? imageRefSchema.nullable().refine((value) => value !== null, { error: "Upload an image." })
      : imageRefSchema.nullable(),
    alt: text(mode, { max: LIMITS.imageAlt, required: "Add a short description of this image." }),
    url: url(mode, { optional: true }).optional(),
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
  });

  const embed = z.object({
    ...common,
    type: z.literal("embed"),
    url: url(mode, { embed: true }),
    caption: text(mode, { max: LIMITS.embedCaption }),
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
  });

  const divider = z.object({ ...common, type: z.literal("divider") });

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

  return { block, profile };
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
    theme: themeSchema,
    /** Every token, resolved: system default, then theme, then page overrides. */
    tokens: tokenSetSchema,
    blocks: z.array(strict.block).max(LIMITS.blocks, tooManyBlocks),
  })
  .superRefine(requireUniqueIds);
export type PublishDoc = Omit<z.infer<typeof publishedDocSchema>, "profile"> & {
  profile: Profile;
};
