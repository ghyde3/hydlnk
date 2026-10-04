import "server-only";
import type { Metadata } from "next";
import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import { pageChrome } from "@/lib/publish/chrome";
import { pageMetadata } from "@/lib/publish/share-meta";
import {
  TENANT_SCRIPT_INTEGRITY,
  TENANT_SCRIPT_SRC,
  tenantFontPreloads,
  tenantInlineCss,
} from "@/lib/tenant-assets";
import { escapeHtml } from "./escape";
import { faqJsonLd } from "./faq-json-ld";
import { renderDocument, renderHead, type HeadPreload } from "./head";
import { renderStatic } from "./static-markup";

/**
 * A published tenant page as one finished HTML document (M8-02). The body is `PageRenderer` in live
 * mode, run once on the server: the very component the editor preview draws in the browser, so the
 * two cannot drift. What the live document adds around it is listed here and nowhere else:
 *
 *   head      `pageMetadata` tags, the favicon, the font and avatar preloads, one `<style>`
 *   after     the body: one deferred same-origin `<script>` (the tenant script: tap to play, and the
 *             view beacon of M4-21), carrying the page id as `data-page-id`
 *
 * The footer's two links come from `pageChrome(plan, pageId)`, decided here from the owner's plan
 * (read server-side with the page) and the page id, never from the document. The script is part of
 * this document and of nothing else, so the editor preview, the shared draft and the demos never
 * report a view. No cookie, no request header and no query string is read: the document is the same
 * for every visitor and is cached per page.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LivePageInput {
  /** From the database row, never from the document. */
  pageId: string;
  document: PublishDoc;
  /** `accounts.plan` of the page's owner. */
  plan: string;
  /**
   * The page's own public URL and its OG image URL, for `og:url` and `og:image`. `null` for a custom
   * host whose page has no verified domain left (a lookup that raced a removal): the title and the
   * description only, as that route has always answered.
   */
  urls: { page: string; image: string } | null;
}

/** The tag of the one script. The page id is checked to be a UUID here, so nothing else can reach the attribute. */
export function scriptTag(pageId: string): string {
  if (!UUID.test(pageId)) throw new Error("The tenant script needs a page id (UUID).");
  return (
    `<script src="${escapeHtml(TENANT_SCRIPT_SRC)}"` +
    (TENANT_SCRIPT_INTEGRITY ? ` integrity="${escapeHtml(TENANT_SCRIPT_INTEGRITY)}"` : "") +
    ` data-page-id="${pageId}" defer></script>`
  );
}

/**
 * What `renderToStaticMarkup(<PageRenderer/>)` puts in front of the root: React hoists a resource
 * hint for the first picture that is not lazy (the avatar) as a `<link rel="preload" as="image">`
 * ahead of the markup, because its own renderer expects a `<head>` to move it into. This is that
 * `<head>` hint: `splitHints` takes them out of the body and the document writes them into its head,
 * so the body is the renderer's root element and nothing else, and the hint is the one the
 * page has always had.
 */
const HINTS = /^(<link rel="preload" as="image"[^>]*\/>)+/;

export function splitHints(markup: string): { hints: string[]; root: string } {
  const lead = HINTS.exec(markup)?.[0] ?? "";
  const root = markup.slice(lead.length);
  if (!root.startsWith("<div ")) {
    throw new Error("The page renderer's markup does not start with its root element");
  }
  return { hints: lead === "" ? [] : lead.match(/<link [^>]*\/>/g)!, root };
}

function renderPage({
  pageId,
  document,
  plan,
}: Pick<LivePageInput, "pageId" | "document" | "plan">) {
  return splitHints(
    renderStatic(
      <PageRenderer doc={document} pageId={pageId} mode="live" chrome={pageChrome(plan, pageId)} />,
    ),
  );
}

/** The renderer's root element alone: the part the editor preview draws identically. */
export function livePageBody(input: Pick<LivePageInput, "pageId" | "document" | "plan">): string {
  return renderPage(input).root;
}

/** The head of a page that has no URL to name itself by: the title and the description. */
function baseMetadata(document: PublishDoc): Metadata {
  const { profile } = document;
  return { title: `${profile.name} - links`, description: profile.bio || undefined };
}

export function renderLivePage(input: LivePageInput): string {
  const { document, pageId, urls } = input;
  const { hints, root } = renderPage(input);
  // The name font (M9-24) is preloaded like the heading and body faces when it is a third family.
  const preloads: HeadPreload[] = tenantFontPreloads({
    ...document.tokens,
    nameFont: document.profile.nameFont,
  }).map((href): HeadPreload => ({ as: "font", href, type: "font/woff2" }));
  return renderDocument(
    renderHead({
      metadata: urls ? pageMetadata(document, urls) : baseMetadata(document),
      css: tenantInlineCss(document),
      preloads,
      hints,
      jsonLd: faqJsonLd(document),
    }),
    root + scriptTag(pageId),
  );
}
