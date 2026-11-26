import "server-only";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getTenantPageStateById, type PublishedPage } from "@/app/(tenant)/published-page";
import { PageRenderer } from "@/components/page/page-renderer";
import { ArchiveList } from "@/components/post/archive-list";
import {
  getPostCards,
  getPostCardsAt,
  getPostIndex,
  getSiteArchives,
  getSiteOwnerId,
  getTermIndex,
  getTermPostCards,
} from "@/lib/blog/published";
import {
  archiveHref,
  termHref,
  type ArchiveSummary,
  type PostCard,
  type TermIndexItem,
} from "@/lib/blog/types";
import { pageChrome } from "@/lib/publish/chrome";
import {
  PAGE_REVALIDATE_SECONDS,
  PUBLIC_READ_CACHE_VERSION,
  pageTag,
  typeTag,
} from "@/lib/publish/tags";
import type { SiteContext } from "@/lib/site/menu";
import { getLiveSiteContext } from "@/lib/site/published";
import { tenantFontPreloads, tenantInlineCss } from "@/lib/tenant-assets";
import { renderDocument, renderHead, type HeadPreload } from "./head";
import { scriptTag, splitHints } from "./live-page";
import { siteOgImage, siteOrigin } from "./post-html";
import { renderStatic } from "./static-markup";

/**
 * The finished HTML of one PROVEN archive page, cached (Wave B, M16-05; plan 3.3 step 7): the
 * archive itself (page 1), `/page/{n}`, and a category's or a tag's pages.
 *
 *   key  `["tenant-archive-html", version, typeId, termId or "", n]` plus the call's arguments. The
 *        responder asks only for a page number the cached post index proved (n is at most the last
 *        page) and a term the cached term index proved (a real term with live posts), so the
 *        entries are bounded by the pages that exist, never by what a visitor typed;
 *   tags `type:<typeId>` and `page:<siteId>`: a post's publish, unpublish, trash or restore
 *        refreshes every list, and Publish design refreshes them with the rest of the site;
 *   TTL  the one-day backstop.
 *
 * Inside: the cached index (or the term's page) and ONE read of the page's cards. The tenant script
 * carries the type's id as the sub-page id, so the beacon counts archive views as "Blog".
 */

/** How many pages `total` posts make at `pageSize` a page: at least 1 (an empty blog has its page 1). */
export function archivePages(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(pageSize) || pageSize < 1)
    return 1;
  return Math.ceil(total / pageSize);
}

const TAXONOMY_LABEL = { category: "Category", tag: "Tag" } as const;

export interface ArchiveDocumentInput {
  page: PublishedPage;
  archive: ArchiveSummary;
  term: Pick<TermIndexItem, "taxonomy" | "slug" | "name"> | null;
  posts: readonly PostCard[];
  pageNumber: number;
  pages: number;
  ownerId: string;
  site: SiteContext;
  origin: string | null;
  siteImage: string | null;
}

/** The head of an archive page: its title, a canonical on the primary host and the site's image. */
export function archiveMetadata(
  input: Pick<
    ArchiveDocumentInput,
    "page" | "archive" | "term" | "pageNumber" | "origin" | "siteImage"
  >,
): Metadata {
  const { archive, term, pageNumber } = input;
  const name = input.page.document.profile.name;
  const heading = term ? term.name : archive.labelPlural;
  const paged = pageNumber > 1 ? `${heading} · Page ${pageNumber}` : heading;
  const title = name === "" ? paged : `${paged} · ${name}`;
  const href = term
    ? termHref(archive.path, term.taxonomy, term.slug, pageNumber)
    : archiveHref(archive.path, pageNumber);
  // A description of its own (search results, and the audit's SEO score): the site's bio on one
  // line, else a sentence from the archive's name. Text only; the head escapes it.
  const bio = input.page.document.profile.bio.replace(/\s+/g, " ").trim();
  const description = bio || (name === "" ? `${paged}.` : `${paged} from ${name}.`);
  if (input.origin === null || href === null) return { title, description };
  const url = `${input.origin}${href}`;
  const images = input.siteImage
    ? [{ url: input.siteImage, width: 1200, height: 630, alt: name }]
    : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", title, description, url, ...(images ? { images } : {}) },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(input.siteImage ? { images: [input.siteImage] } : {}),
    },
  };
}

/** One archive page as a finished HTML document. */
export function renderArchiveDocument(input: ArchiveDocumentInput): string {
  const { page, archive, term } = input;
  const { document } = page;
  const { hints, root } = splitHints(
    renderStatic(
      <PageRenderer
        doc={document}
        pageId={page.pageId}
        mode="live"
        chrome={pageChrome(page.plan, page.pageId)}
        site={input.site}
        main={{
          kind: "archive",
          title: term ? term.name : archive.labelPlural,
          node: (
            <ArchiveList
              archivePath={archive.path}
              posts={input.posts}
              page={input.pageNumber}
              pages={input.pages}
              term={term ? { taxonomy: term.taxonomy, slug: term.slug } : undefined}
              kicker={
                term ? `${TAXONOMY_LABEL[term.taxonomy]} · ${archive.labelPlural}` : undefined
              }
              ownerId={input.ownerId}
            />
          ),
        }}
      />,
    ),
  );
  const preloads: HeadPreload[] = tenantFontPreloads(document.tokens).map((font): HeadPreload => ({
    as: "font",
    href: font,
    type: "font/woff2",
  }));
  return renderDocument(
    renderHead({
      metadata: archiveMetadata(input),
      css: tenantInlineCss({
        blocks: [],
        tokens: document.tokens,
        ...(document.banner ? { banner: document.banner } : {}),
        ...(input.site.menu ? { menu: true } : {}),
        subPage: true,
        archive: true,
      }),
      preloads,
      hints,
    }),
    root + scriptTag(page.pageId, archive.typeId),
  );
}

/**
 * `termId` is "" for the archive itself. null when the site, the archive, the term or the page is
 * not there (any more): the responder answers the plain 404.
 */
export async function renderArchiveHtml(
  siteId: string,
  typeId: string,
  termId: string,
  pageNumber: number,
  handle: string | null,
): Promise<string | null> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;
  const state = await getTenantPageStateById(siteId);
  if (state.kind !== "published") return null;
  const { page } = state;
  const [{ archives }, ownerId, origin, siteImage] = await Promise.all([
    getSiteArchives(siteId),
    getSiteOwnerId(siteId),
    siteOrigin(siteId, handle),
    siteOgImage(page, handle),
  ]);
  const archive = archives.find((candidate) => candidate.typeId === typeId);
  if (!archive || ownerId === null) return null;
  const size = archive.pageSize;
  const offset = (pageNumber - 1) * size;

  let term: TermIndexItem | null = null;
  let posts: PostCard[];
  let pages: number;
  if (termId === "") {
    const index = await getPostIndex(siteId, typeId);
    pages = archivePages(index.total, size);
    if (pageNumber > pages) return null;
    const ids = index.posts.slice(offset, offset + size).map((post) => post.id);
    // Past the index (a type with more live posts than it holds): the same page by its offset.
    posts =
      ids.length > 0
        ? await getPostCards(siteId, typeId, ids)
        : index.complete
          ? []
          : await getPostCardsAt(siteId, typeId, offset, size);
  } else {
    term =
      (await getTermIndex(siteId, typeId)).find((candidate) => candidate.id === termId) ?? null;
    if (!term || term.count < 1) return null;
    pages = archivePages(term.count, size);
    if (pageNumber > pages) return null;
    posts = await getTermPostCards(siteId, typeId, term.id, offset, size);
  }
  const site = await getLiveSiteContext(siteId, page.document, archive.typeId, []);
  return renderArchiveDocument({
    page,
    archive,
    term,
    posts,
    pageNumber,
    pages,
    ownerId,
    site,
    origin,
    siteImage,
  });
}

/** The cache key parts of one archive page: the type, the term ("" for none) and the page number. */
export function archiveHtmlKey(typeId: string, termId: string, pageNumber: number): string[] {
  return ["tenant-archive-html", PUBLIC_READ_CACHE_VERSION, typeId, termId, String(pageNumber)];
}

/** The cache options of a type's archive pages: the type's tag, the site's tag and the backstop. */
export function archiveHtmlOptions(
  siteId: string,
  typeId: string,
): { tags: string[]; revalidate: number } {
  return { tags: [typeTag(typeId), pageTag(siteId)], revalidate: PAGE_REVALIDATE_SECONDS };
}

/** The page's finished HTML, from the Data Cache in production. The caller proved the term and the page. */
export function getArchiveHtml(
  siteId: string,
  typeId: string,
  termId: string,
  pageNumber: number,
  handle: string | null,
): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") {
    return renderArchiveHtml(siteId, typeId, termId, pageNumber, handle);
  }
  return unstable_cache(
    renderArchiveHtml,
    archiveHtmlKey(typeId, termId, pageNumber),
    archiveHtmlOptions(siteId, typeId),
  )(siteId, typeId, termId, pageNumber, handle);
}
