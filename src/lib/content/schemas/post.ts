import { z } from "zod";
import { imageRefSchema, text } from "@/lib/document/schema";
import { draftEntrySlug, strictEntrySlug } from "./slug";

export const POST_LIMITS = {
  title: 200,
  excerpt: 400,
  bodyBytes: 512 * 1024,
  seoTitle: 120,
  seoDescription: 320,
  terms: 50,
  fields: 50,
} as const;

const encoder = new TextEncoder();

/** The Markdown body, measured in UTF-8 bytes. */
const body = z.string().refine((value) => encoder.encode(value).length <= POST_LIMITS.bodyBytes, {
  error: "The body is over 512 KiB.",
});

const termIds = z.array(z.uuid()).max(POST_LIMITS.terms);
const terms = z.object({ categories: termIds.optional(), tags: termIds.optional() });
const fields = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length <= POST_LIMITS.fields, {
    error: "Too many fields.",
  });

/** A draft image reference may be incomplete (an upload in progress); publish uses the strict one. */
const draftImage = z
  .object({
    path: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    focus: z.unknown().optional(),
  })
  .nullable();

/**
 * A short text field. A draft keeps any string; publish uses the page document's `text` rule: no
 * control or bidi characters, and a required one must hold more than spaces. Used to validate only,
 * the stored text is never changed.
 */
function line(publish: boolean, max: number, required?: string): z.ZodString {
  return publish ? text("publish", { max, required }) : z.string().max(max);
}

function shape(image: z.ZodType, publish: boolean) {
  return {
    title: line(publish, POST_LIMITS.title),
    excerpt: publish
      ? text("publish", { max: POST_LIMITS.excerpt, multiline: true })
      : z.string().max(POST_LIMITS.excerpt),
    body,
    featuredImage: image,
    seo: z
      .object({
        title: line(publish, POST_LIMITS.seoTitle).optional(),
        description: line(publish, POST_LIMITS.seoDescription).optional(),
        ogImage: image.optional(),
        noindex: z.boolean().optional(),
      })
      .strict(),
    terms,
    fields,
  };
}

const draftShape = shape(draftImage, false);
const publishShape = shape(imageRefSchema.nullable(), true);

/** The post draft: every field optional, the slug may be empty. Never transforms. */
export const postDraftSchema = z
  .object({
    ...Object.fromEntries(Object.entries(draftShape).map(([k, v]) => [k, v.optional()])),
    slug: draftEntrySlug.optional(),
  } as { [K in keyof typeof draftShape]: z.ZodOptional<(typeof draftShape)[K]> } & {
    slug: z.ZodOptional<typeof draftEntrySlug>;
  })
  .strict();

/** The post publish gate: a non-empty title and a valid slug; everything else optional but valid. */
export const postPublishSchema = z
  .object({
    ...Object.fromEntries(Object.entries(publishShape).map(([k, v]) => [k, v.optional()])),
    title: line(true, POST_LIMITS.title, "Add a title."),
    slug: strictEntrySlug,
  } as { [K in keyof typeof publishShape]: z.ZodOptional<(typeof publishShape)[K]> } & {
    title: z.ZodString;
    slug: typeof strictEntrySlug;
  })
  .strict();

export type PostDraft = z.infer<typeof postDraftSchema>;
export type PostPublish = z.infer<typeof postPublishSchema>;
