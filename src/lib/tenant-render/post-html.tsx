import "server-only";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getTenantPageStateById, type PublishedPage } from "@/app/(tenant)/published-page";
import { PageRenderer } from "@/components/page/page-renderer";
import { PostArticle, ownImage } from "@/components/post/post-article";
import { hasBareUrl, plainExcerpt } from "@/lib/blog/markdown";
import {
  getPublishedPost,
  getSiteArchives,
  getSiteOwnerId,
  getTermIndex,
  postHtmlTags,
} from "@/lib/blog/published";
import {
  POST_NAV_MARKER,
  postFieldsOf,
  postHref,
  type ArchiveSummary,
  type PostFields,
  type PublishedPost,
  type TermView,
} from "@/lib/blog/types";
import { parseEmbed } from "@/lib/document";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { customOgImageUrl } from "@/lib/domains/urls";
import { clientEnv } from "@/lib/env/client";
import { pageChrome } from "@/lib/publish/chrome";
import { PAGE_REVALIDATE_SECONDS, PUBLIC_READ_CACHE_VERSION } from "@/lib/publish/tags";
import { ogImageUrl, tenantOrigin } from "@/lib/publish/urls";
import { customOrigin } from "@/lib/routing/urls";
import type { SiteContext } from "@/lib/site/menu";
import { getLiveSiteContext } from "@/lib/site/published";
import { tenantFontPreloads, tenantInlineCss } from "@/lib/tenant-assets";
import { renderDocument, renderHead, type HeadPreload } from "./head";
import { scriptTag, splitHints } from "./live-page";
import { postJsonLd } from "./post-json-ld";
import { renderStatic } from "./static-markup";

/**
 * The finished HTML of a REAL post, cached (Wave B, M16-04; plan 3.3 step 4).
 *
 *   key  `["tenant-post-html", version, entryId]` plus the call's arguments (site id, type id and
 *        the handle, or null on a custom host): the responder asks for it only after the post index
 *        proved the id, so there is one entry per real post and none for an invented slug;
 *   tags `entry:<entryId>` and `page:<siteId>`. NOT the type's tag: publishing post B must not
 *        render post A again. What changes on A when B is published is its previous and next
 *        links, and those are not in this string: it holds `POST_NAV_MARKER` and the responder
 *        writes the links in its place on every request, from the cached index;
 *   TTL  the one-day backstop of every public read.
 *
 * `null` (cached under the same tags) when the site or the post stopped being live between the
 * responder's check and this read. `next dev` renders every time.
 *
 * The page is the site's: `PageRenderer` with the site's published tokens, header, menu, footer,
 * badge and report link, and `PostArticle` where a sub-page's blocks go. It ships the one tenant
 * script (the beacon carries the post's entry id as its sub-page id) and no other JavaScript.
 */

/** The site's primary origin: its oldest verified custom domain, else its handle host, else null. */
export async function siteOrigin(siteId: string, handle: string | null): Promise<string | null> {
  const hostname = await getPrimaryDomain(siteId);
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  if (hostname) return customOrigin(hostname, rootDomain);
  return handle ? tenantOrigin(handle) : null;
}

/** The site's own OG image on its primary host, or null when it has no host to name. */
export async function siteOgImage(
  page: Pick<PublishedPage, "pageId" | "publishedAt">,
  handle: string | null,
): Promise<string | null> {
  const hostname = await getPrimaryDomain(page.pageId);
  if (hostname) {
    return customOgImageUrl(hostname, page.publishedAt, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN);
  }
  return handle ? ogImageUrl(handle, page.publishedAt) : null;
}

/** The slot `PostArticle` is followed by; replaced by `POST_NAV_MARKER` in the finished string. */
const NAV_SLOT = '<span data-post-nav-slot=""></span>';

/** How long a description made from the body is. */
export const POST_DESCRIPTION_LENGTH = 160;

export interface PostHeadInput {
  post: PostFields;
  profileName: string;
  /** The post's canonical address on the primary host, or null when there is none to name. */
  url: string | null;
  /** The share image: the post's own (already checked to be the owner's), else the site's, else null. */
  image: { url: string; width?: number; height?: number } | null;
}

/**
 * The head of a post (M16-06): the SEO title and description, falling back to the title and the
 * excerpt (then the start of the body); a canonical on the primary host; `noindex` when set.
 */
export function postMetadata({ post, profileName, url, image }: PostHeadInput): Metadata {
  const own = post.seoTitle.trim();
  const title = own ? own : profileName === "" ? post.title : `${post.title} · ${profileName}`;
  const description =
    post.seoDescription.trim() ||
    post.excerpt.trim() ||
    plainExcerpt(post.body, POST_DESCRIPTION_LENGTH) ||
    undefined;
  const metadata: Metadata = { title, description };
  if (post.noindex) metadata.robots = { index: false };
  if (url === null) return metadata;
  const cardTitle = own ? own : post.title;
  metadata.alternates = { canonical: url };
  metadata.openGraph = {
    type: "article",
    title: cardTitle,
    description,
    url,
    ...(image
      ? {
          images: [
            {
              url: image.url,
              ...(image.width ? { width: image.width, height: image.height } : {}),
              alt: post.title,
            },
          ],
        }
      : {}),
  };
  metadata.twitter = {
    card: "summary_large_image",
    title: cardTitle,
    description,
    ...(image ? { images: [image.url] } : {}),
  };
  return metadata;
}

/** The terms of a post, in the post's own order: categories, then tags; an unknown id is left out. */
export function postTerms(
  post: Pick<PostFields, "categoryIds" | "tagIds">,
  index: readonly { id: string; taxonomy: "category" | "tag"; slug: string; name: string }[],
): TermView[] {
  const byId = new Map(index.map((term) => [term.id, term]));
  const out: TermView[] = [];
  for (const [ids, taxonomy] of [
    [post.categoryIds, "category"],
    [post.tagIds, "tag"],
  ] as const) {
    for (const id of ids) {
      const term = byId.get(id);
      if (term && term.taxonomy === taxonomy) {
        out.push({ id: term.id, taxonomy, slug: term.slug, name: term.name });
      }
    }
  }
  return out;
}

export interface PostDocumentInput {
  page: PublishedPage;
  archive: ArchiveSummary;
  entry: PublishedPost;
  terms: TermView[];
  ownerId: string;
  site: SiteContext;
  origin: string | null;
  siteImage: string | null;
}

/** One post as a finished HTML document, with `POST_NAV_MARKER` where the responder writes the nav. */
export function renderPostDocument(input: PostDocumentInput): string {
  const { page, archive, entry, ownerId } = input;
  const { document } = page;
  const post = postFieldsOf(entry.post);
  const { body } = post;
  const markup = renderStatic(
    <PageRenderer
      doc={document}
      pageId={page.pageId}
      mode="live"
      chrome={pageChrome(page.plan, page.pageId)}
      site={input.site}
      main={{
        kind: "post",
        title: post.title,
        node: (
          <>
            <PostArticle
              post={{
                title: post.title,
                body,
                excerpt: post.excerpt,
                publishedAt: entry.publishedAt,
                featuredImage: post.featuredImage,
              }}
              archivePath={archive.path}
              terms={input.terms}
              ownerId={ownerId}
              embeds="facade"
            />
            <span data-post-nav-slot="" />
          </>
        ),
      }}
    />,
  );
  if (markup.split(NAV_SLOT).length !== 2) {
    throw new Error("The post page's markup does not hold exactly one nav slot");
  }
  const { hints, root } = splitHints(markup.replace(NAV_SLOT, () => POST_NAV_MARKER));

  const href = postHref(archive.path, post.slug);
  const url = input.origin !== null && href !== null ? `${input.origin}${href}` : null;
  const share = ownImage(post.shareImage, ownerId) ?? ownImage(post.featuredImage, ownerId);
  const image = share
    ? { url: share.src, width: share.width, height: share.height }
    : input.siteImage
      ? { url: input.siteImage, width: 1200, height: 630 }
      : null;
  const preloads: HeadPreload[] = tenantFontPreloads(document.tokens).map((font): HeadPreload => ({
    as: "font",
    href: font,
    type: "font/woff2",
  }));
  const hasEmbed = hasBareUrl(body, (candidate) => parseEmbed(candidate) !== null);
  return renderDocument(
    renderHead({
      metadata: postMetadata({ post, profileName: document.profile.name, url, image }),
      css: tenantInlineCss({
        blocks: hasEmbed ? [{ type: "embed" }] : [],
        tokens: document.tokens,
        ...(document.banner ? { banner: document.banner } : {}),
        ...(input.site.menu ? { menu: true } : {}),
        subPage: true,
        post: true,
      }),
      preloads,
      hints,
      jsonLd:
        url === null
          ? null
          : postJsonLd({
              headline: post.title,
              datePublished: entry.publishedAt,
              dateModified: entry.updatedAt,
              image: image?.url ?? null,
              url,
            }),
    }),
    root + scriptTag(page.pageId, entry.id),
  );
}

export async function renderPostHtml(
  siteId: string,
  typeId: string,
  entryId: string,
  handle: string | null,
): Promise<string | null> {
  const state = await getTenantPageStateById(siteId);
  if (state.kind !== "published") return null;
  const { page } = state;
  const [{ archives }, entry, ownerId, origin, siteImage] = await Promise.all([
    getSiteArchives(siteId),
    getPublishedPost(siteId, typeId, entryId),
    getSiteOwnerId(siteId),
    siteOrigin(siteId, handle),
    siteOgImage(page, handle),
  ]);
  const archive = archives.find((candidate) => candidate.typeId === typeId);
  if (!archive || !entry || ownerId === null) return null;
  const [terms, site] = await Promise.all([
    getTermIndex(siteId, typeId),
    getLiveSiteContext(siteId, page.document, archive.typeId, []),
  ]);
  return renderPostDocument({
    page,
    archive,
    entry,
    terms: postTerms(postFieldsOf(entry.post), terms),
    ownerId,
    site,
    origin,
    siteImage,
  });
}

/** The cache key parts of one post's HTML: the real entry id, under the public-read version. */
export function postHtmlKey(entryId: string): string[] {
  return ["tenant-post-html", PUBLIC_READ_CACHE_VERSION, entryId];
}

/** The cache options of one post's HTML: its own tag and the site's, and the backstop. */
export function postHtmlOptions(
  siteId: string,
  entryId: string,
): { tags: string[]; revalidate: number } {
  return { tags: postHtmlTags(siteId, entryId), revalidate: PAGE_REVALIDATE_SECONDS };
}

/** The post's finished HTML, from the Data Cache in production. `entryId` must be a real live post. */
export function getPostHtml(
  siteId: string,
  typeId: string,
  entryId: string,
  handle: string | null,
): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") return renderPostHtml(siteId, typeId, entryId, handle);
  return unstable_cache(renderPostHtml, postHtmlKey(entryId), postHtmlOptions(siteId, entryId))(
    siteId,
    typeId,
    entryId,
    handle,
  );
}
