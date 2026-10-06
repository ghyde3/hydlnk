import type { PublishDoc } from "@/lib/document";

/**
 * The FAQPage data of a live page (M9-16): one `application/ld+json` block in the head, for the
 * questions of the page's visible FAQ blocks in page order. Built by one pure function from the
 * PUBLISHED document and written only into the live static document (never into the editor
 * preview, the share page, the placeholder or any 404 or error page).
 *
 * Search engines read it; the page does not run it. It is a data block, not a script: its `type` is
 * not a JavaScript type, the tenant policy's `script-src 'self'` neither runs nor blocks it, and the
 * page still has exactly one executable script. No tenant string can close the element: after
 * `JSON.stringify`, every `<`, `>`, `&`, U+2028 and U+2029 is written as a `\uXXXX` escape, which a
 * JSON parser reads back as the same character.
 */

/** Most questions one page names in its data. */
export const FAQ_JSON_LD_MAX = 50;

/** The data object, or null when the page has no visible FAQ block with a question. */
export function faqPageData(doc: Pick<PublishDoc, "blocks">): Record<string, unknown> | null {
  const entities: {
    "@type": "Question";
    name: string;
    acceptedAnswer: { "@type": "Answer"; text: string };
  }[] = [];
  for (const block of doc.blocks) {
    if (block.type !== "faq" || block.visible === false) continue;
    for (const item of block.items) {
      if (entities.length >= FAQ_JSON_LD_MAX) break;
      entities.push({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      });
    }
  }
  if (entities.length === 0) return null;
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: entities };
}

/** `JSON.stringify` output that is safe inside a `<script>` element: see the module comment. */
export function escapeJsonForScript(json: string): string {
  return json.replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** The text of the page's one FAQPage data block, or null when the page has none. */
export function faqJsonLd(doc: Pick<PublishDoc, "blocks">): string | null {
  const data = faqPageData(doc);
  return data === null ? null : escapeJsonForScript(JSON.stringify(data));
}
