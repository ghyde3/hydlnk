import { escapeJsonForScript } from "./faq-json-ld";

/**
 * The BlogPosting data of a live post page (Wave B, M16-06): one `application/ld+json` block in the
 * head. A data block, not a script (see `faq-json-ld.ts`): after `JSON.stringify`, every `<`, `>`,
 * `&`, U+2028 and U+2029 is written as a `\uXXXX` escape by the same escaper, so no title can close
 * the element. Built from the PUBLISHED post only; absent when the page has no address to name.
 */

export interface PostJsonLdInput {
  headline: string;
  /** The first publish date and the last publish date, ISO. */
  datePublished: string;
  dateModified: string;
  /** Absolute image address, or null. */
  image: string | null;
  /** The post's canonical address. */
  url: string;
}

const isoDate = (value: string): string | undefined => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};

/** The data object. Control characters are dropped from the headline; it is cut at 110 characters. */
export function blogPostingData(input: PostJsonLdInput): Record<string, unknown> {
  // eslint-disable-next-line no-control-regex
  const headline = [...input.headline.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()]
    .slice(0, 110)
    .join("");
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
  };
  const published = isoDate(input.datePublished);
  const modified = isoDate(input.dateModified);
  if (published) data.datePublished = published;
  if (modified) data.dateModified = modified;
  if (input.image) data.image = [input.image];
  return data;
}

/** The text of the page's BlogPosting data block, safe inside a `<script>` element. */
export function postJsonLd(input: PostJsonLdInput): string {
  return escapeJsonForScript(JSON.stringify(blogPostingData(input)));
}
