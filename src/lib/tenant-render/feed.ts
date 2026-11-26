import "server-only";
import { unstable_cache } from "next/cache";
import { getTenantPageStateById } from "@/app/(tenant)/published-page";
import { getPostCards, getPostIndex, getSiteArchives } from "@/lib/blog/published";
import { FEED_ITEMS, archiveHref, postHref, type PostCard } from "@/lib/blog/types";
import {
  PAGE_REVALIDATE_SECONDS,
  PUBLIC_READ_CACHE_VERSION,
  pageTag,
  typeTag,
} from "@/lib/publish/tags";
import { siteOrigin } from "./post-html";

/**
 * The feed of an archive (Wave B, M16-06): RSS 2.0, the 20 newest posts with title, link, guid,
 * pubDate and excerpt (no full text), on the site's PRIMARY host. The XML is built by hand, so every
 * text value goes through `xmlText` here: the five XML characters are escaped and every character
 * XML 1.0 does not allow (control characters, lone surrogates, U+FFFE and U+FFFF) is dropped, so a
 * hostile title can neither close an element nor make the document unparseable. No CDATA is used,
 * so `]]>` has nothing to end.
 */

export const FEED_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

/** Text that is safe as XML character data and inside a double-quoted attribute. */
export function xmlText(value: string): string {
  let out = "";
  for (const char of String(value)) {
    const code = char.codePointAt(0)!;
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!allowed) continue;
    if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else if (char === "'") out += "&apos;";
    else out += char;
  }
  return out;
}

export interface FeedInput {
  /** The site's primary origin, "https://example.com". */
  origin: string;
  archivePath: string;
  /** The channel title and description: the site's name and the archive's label. */
  title: string;
  description: string;
  posts: readonly Pick<PostCard, "slug" | "title" | "excerpt" | "publishedAt">[];
}

const rfc822 = (iso: string): string | null => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toUTCString();
};

/** The RSS document. Pure. A post whose slug cannot be linked is left out. */
export function feedXml(input: FeedInput): string {
  const home = archiveHref(input.archivePath);
  const channelLink = `${input.origin}${home ?? "/"}`;
  const items = input.posts.slice(0, FEED_ITEMS).flatMap((post) => {
    const href = postHref(input.archivePath, post.slug);
    if (href === null) return [];
    const link = xmlText(`${input.origin}${href}`);
    const date = rfc822(post.publishedAt);
    return [
      "<item>" +
        `<title>${xmlText(post.title)}</title>` +
        `<link>${link}</link>` +
        `<guid isPermaLink="true">${link}</guid>` +
        (date ? `<pubDate>${xmlText(date)}</pubDate>` : "") +
        `<description>${xmlText(post.excerpt)}</description>` +
        "</item>",
    ];
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0"><channel>' +
    `<title>${xmlText(input.title)}</title>` +
    `<link>${xmlText(channelLink)}</link>` +
    `<description>${xmlText(input.description)}</description>` +
    items.join("") +
    "</channel></rss>\n"
  );
}

/** The feed of a live archive, or null (the site or the archive is gone, or it has no host to name). */
export async function renderFeedXml(
  siteId: string,
  typeId: string,
  handle: string | null,
): Promise<string | null> {
  const state = await getTenantPageStateById(siteId);
  if (state.kind !== "published") return null;
  const [{ archives }, origin] = await Promise.all([
    getSiteArchives(siteId),
    siteOrigin(siteId, handle),
  ]);
  const archive = archives.find((candidate) => candidate.typeId === typeId);
  if (!archive || origin === null) return null;
  const index = await getPostIndex(siteId, typeId);
  const posts = await getPostCards(
    siteId,
    typeId,
    index.posts.slice(0, FEED_ITEMS).map((post) => post.id),
  );
  const name = state.page.document.profile.name;
  return feedXml({
    origin,
    archivePath: archive.path,
    title: name === "" ? archive.labelPlural : `${name} · ${archive.labelPlural}`,
    description: state.page.document.profile.bio || archive.labelPlural,
    posts,
  });
}

/** The cache key parts of a type's feed. */
export function feedKey(typeId: string): string[] {
  return ["tenant-feed", PUBLIC_READ_CACHE_VERSION, typeId];
}

/** The feed, from the Data Cache in production. `typeId` must be an enabled archive of the site. */
export function getFeedXml(
  siteId: string,
  typeId: string,
  handle: string | null,
): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") return renderFeedXml(siteId, typeId, handle);
  return unstable_cache(renderFeedXml, feedKey(typeId), {
    tags: [typeTag(typeId), pageTag(siteId)],
    revalidate: PAGE_REVALIDATE_SECONDS,
  })(siteId, typeId, handle);
}
