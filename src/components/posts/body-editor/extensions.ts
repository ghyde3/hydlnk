import type { AnyExtension } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { isHttpUrl } from "@/lib/document";
import { BodyImage, type BodyImageOptions } from "./image-node";

/**
 * The schema of the post body editor (M16-13), a Tiptap instance of its own: the text block's editor
 * is pinned to the page document and is not widened.
 *
 *   headings 2 to 4, paragraphs, bold, italic, strike, inline code, links (http and https only, no
 *   autolink, no link on paste, never opened by a click), bullet and numbered lists, quote, code
 *   block, rule, hard break, and images of the owner's uploads.
 *
 * No underline (Markdown has none), no tables and no raw HTML: a body holding those opens in the
 * plain Markdown box (see `markdown.ts`). `bodySchema` is everything that decides what a document
 * can hold and how it is written to Markdown; the Markdown round trip runs on it without an editor.
 */
export const BODY_HEADING_LEVELS = [2, 3, 4] as const;

export function bodySchema(image: Partial<BodyImageOptions> = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [...BODY_HEADING_LEVELS] },
      underline: false,
      link: {
        autolink: false,
        linkOnPaste: false,
        openOnClick: false,
        protocols: [],
        isAllowedUri: (url) => typeof url === "string" && isHttpUrl(url),
        HTMLAttributes: { rel: "noopener noreferrer", target: null },
      },
    }),
    BodyImage.configure(image),
  ];
}

/** The editor's extensions: the schema plus Markdown in and out. */
export function bodyExtensions(image: Partial<BodyImageOptions> = {}): AnyExtension[] {
  return [...bodySchema(image), Markdown];
}
