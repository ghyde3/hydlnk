import { z } from "zod";
import { blockOverridesSchema } from "@/lib/theme";
import { mailtoUrlSchema, safeUrlSchema } from "./url";

/**
 * Block schemas (PLAN.md -> Data model: "Zod validates it on write").
 * Everything inside a block is tenant-controlled, so every URL goes through `safeUrlSchema`
 * (or `mailtoUrlSchema` for the email icon) and objects are strict: unknown keys are rejected.
 */

export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{8,24}$/;

/** Required single-line text: trimmed, 1..max characters. */
const line = (max: number) => z.string().trim().min(1).max(max);

const common = {
  id: z
    .string()
    .regex(BLOCK_ID_PATTERN, { error: "Block id must be 8-24 letters, digits, _ or -" }),
  visible: z.boolean(),
  overrides: blockOverridesSchema.optional(),
};

// Social row ------------------------------------------------------------------------------------

/** Platforms whose link is an http(s) URL. */
export const SOCIAL_WEB_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "spotify",
  "website",
] as const;

/** All platforms, in display order. `email` is the only one that must be a `mailto:` link. */
export const SOCIAL_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "facebook",
  "linkedin",
  "github",
  "spotify",
  "email",
  "website",
] as const;

const socialLinkSchema = z.discriminatedUnion("platform", [
  z.strictObject({ platform: z.literal("email"), url: mailtoUrlSchema }),
  z.strictObject({ platform: z.enum(SOCIAL_WEB_PLATFORMS), url: safeUrlSchema }),
]);

// Embed -----------------------------------------------------------------------------------------

/** Hosts each embed provider may use. Compared against the parsed, lower-cased hostname. */
export const EMBED_HOSTS = {
  youtube: ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"],
  spotify: ["open.spotify.com"],
} as const;

export type EmbedProvider = keyof typeof EMBED_HOSTS;

export function isEmbedUrlAllowed(provider: EmbedProvider, url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (EMBED_HOSTS[provider] as readonly string[]).includes(hostname);
  } catch {
    return false;
  }
}

// Blocks ----------------------------------------------------------------------------------------

const linkButtonBlock = z.strictObject({
  ...common,
  type: z.literal("link_button"),
  label: line(80),
  url: safeUrlSchema,
});

const linkCardBlock = z.strictObject({
  ...common,
  type: z.literal("link_card"),
  title: line(80),
  url: safeUrlSchema,
  description: z.string().max(160).optional(),
  imageUrl: safeUrlSchema.optional(),
});

const headerBlock = z.strictObject({
  ...common,
  type: z.literal("header"),
  text: line(80),
});

const textBlock = z.strictObject({
  ...common,
  type: z.literal("text"),
  text: z.string().trim().min(1).max(1000),
});

const imageBlock = z.strictObject({
  ...common,
  type: z.literal("image"),
  url: safeUrlSchema,
  alt: z.string().max(200),
  linkUrl: safeUrlSchema.optional(),
});

const socialRowBlock = z.strictObject({
  ...common,
  type: z.literal("social_row"),
  links: z.array(socialLinkSchema).min(1).max(12),
});

const embedBlock = z
  .strictObject({
    ...common,
    type: z.literal("embed"),
    provider: z.enum(["youtube", "spotify"]),
    url: safeUrlSchema,
  })
  .refine((block) => isEmbedUrlAllowed(block.provider, block.url), {
    path: ["url"],
    error: "URL host is not allowed for this embed provider",
  });

const dividerBlock = z.strictObject({
  ...common,
  type: z.literal("divider"),
});

const grid2Block = z.strictObject({
  ...common,
  type: z.literal("grid2"),
  items: z
    .array(
      z.strictObject({
        title: line(60),
        url: safeUrlSchema,
        imageUrl: safeUrlSchema.optional(),
      }),
    )
    .min(2)
    .max(12),
});

export const blockSchema = z.discriminatedUnion("type", [
  linkButtonBlock,
  linkCardBlock,
  headerBlock,
  textBlock,
  imageBlock,
  socialRowBlock,
  embedBlock,
  dividerBlock,
  grid2Block,
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

/** Every block type, derived from the schema so it cannot drift. */
export const BLOCK_TYPES: BlockType[] = blockSchema.options.map(
  (option) => option.shape.type.value,
);
