import "server-only";
import { getTenantPageStateById } from "@/app/(tenant)/published-page";
import { PageRenderer } from "@/components/page/page-renderer";
import type { FormTarget } from "@/lib/analytics/ingest/types";
import { FORM_VIEW_TITLES, type FormRenderState } from "@/lib/forms/contract";
import { pageChrome } from "@/lib/publish/chrome";
import { getSiteIndex } from "@/lib/site/published";
import { tenantFontPreloads, tenantInlineCss } from "@/lib/tenant-assets";
import { renderDocument, renderHead, type HeadPreload } from "./head";
import { splitHints } from "./live-page";
import { renderStatic } from "./static-markup";

/**
 * The three result pages of a form block (Wave D, M17-06), each one finished HTML document: "Check
 * and send" (the confirm view, values and a fresh token), "Fix and send" (the error view, one
 * sentence per field) and "Sent" (the block's success message and a link back). The site's own
 * `PageRenderer`, theme, fonts, footer and report link, with the form block alone where a sub-page's
 * blocks go and its view in `formState`. Never cached (the route answers `no-store`), `noindex`, no
 * script and no open marker: nothing on these pages loads a script.
 *
 * Null when the site is no longer published (the route answers its 404 notice).
 */
export async function renderFormPage(input: {
  pageId: string;
  target: FormTarget;
  state: FormRenderState;
}): Promise<string | null> {
  const { pageId, target, state } = input;
  const pageState = await getTenantPageStateById(pageId);
  if (pageState.kind !== "published") return null;
  const { document, plan } = pageState.page;
  const backHref = state.view === "sent" ? await backHrefOf(pageId, target.subPageId) : undefined;
  const formState: FormRenderState = backHref ? { ...state, backHref } : state;
  const title = FORM_VIEW_TITLES[state.view];
  const blocks = [target.block];

  const { hints, root } = splitHints(
    renderStatic(
      <PageRenderer
        doc={document}
        pageId={pageId}
        mode="live"
        chrome={pageChrome(plan, pageId)}
        subPage={{ title, blocks }}
        formState={formState}
      />,
    ),
  );
  const preloads: HeadPreload[] = tenantFontPreloads(document.tokens).map((href): HeadPreload => ({
    as: "font",
    href,
    type: "font/woff2",
  }));
  return renderDocument(
    renderHead({
      metadata: { title: `${title} · ${document.profile.name}`, robots: { index: false } },
      css: tenantInlineCss({
        blocks,
        tokens: document.tokens,
        ...(document.banner ? { banner: document.banner } : {}),
        subPage: true,
      }),
      preloads,
      hints,
    }),
    root,
  );
}

/** "/" for a form on Home, "/{path}" for one on a live sub-page (from the cached site index). */
async function backHrefOf(pageId: string, subPageId: string | undefined): Promise<string> {
  if (!subPageId) return "/";
  const index = await getSiteIndex(pageId);
  const page = index.find((entry) => entry.id.toLowerCase() === subPageId.toLowerCase());
  return page ? `/${page.path}` : "/";
}
