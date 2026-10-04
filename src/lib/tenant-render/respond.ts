import "server-only";
import { getPrimaryDomain } from "@/lib/domains/primary";
import { customOgImageUrl } from "@/lib/domains/urls";
import { clientEnv } from "@/lib/env/client";
import { checkHandle } from "@/lib/handles/availability";
import type { HandleStatus } from "@/lib/handles/status";
import { ogImageUrl, tenantOrigin } from "@/lib/publish/urls";
import { customOrigin } from "@/lib/routing/urls";
import { getTenantPageState, getTenantPageStateById } from "@/app/(tenant)/published-page";
import { failureResponse } from "./failure";
import { htmlResponse } from "./html-response";
import { renderLivePage } from "./live-page";
import {
  missingDocument,
  placeholderDocument,
  plainNotFoundDocument,
  unavailableDocument,
} from "./state-pages";

/**
 * What a tenant address answers (M8-02, M8-03): the one place that turns the public read into a
 * response, shared by `GET /t/[handle]` (a handle host) and `GET /sites/[pageId]` (a verified
 * custom host). The two route files are static route handlers, so Next.js generates each
 * response once and serves it from the cache until the page's tag is expired (src/lib/publish/
 * tags.ts); nothing here reads a request header, a cookie or a query string, and the proxy puts the
 * security headers on the response, so they ride along with a cached copy.
 *
 * Anything that throws is the 500 panel (`failureResponse`), never a 404 and never cached.
 */

/** `/anything` on a tenant host, and every address that is not a page: the plain 404, 5 seconds or a day, never state. */
export function plainNotFoundResponse(): Response {
  return htmlResponse(plainNotFoundDocument(), 404);
}

/** A handle host. `published`: the page. `unpublished`: the placeholder. Everything else is a 404. */
export async function handleResponse(handle: string): Promise<Response> {
  try {
    const state = await getTenantPageState(handle);
    switch (state.kind) {
      case "published": {
        const { page } = state;
        return htmlResponse(
          renderLivePage({
            pageId: page.pageId,
            document: page.document,
            plan: page.plan,
            // The share card (M6-32) changes og:title and og:description only; the image stays the page's own /og.
            urls: { page: `${tenantOrigin(handle)}/`, image: ogImageUrl(handle, page.publishedAt) },
          }),
        );
      }
      case "unpublished":
        return htmlResponse(placeholderDocument(handle));
      case "suspended":
        // A suspended owner (M5-08): the handle is held, so never the claim panel, and never any content.
        return htmlResponse(unavailableDocument(), 404);
      case "missing": {
        let status: HandleStatus | null = null;
        try {
          status = (await checkHandle(handle)).status;
        } catch (error) {
          console.error("[tenant] availability lookup for the 404 page failed", error);
        }
        // A reserved or malformed address says so (M5-20) and never offers to claim it.
        return htmlResponse(missingDocument(handle, status), 404);
      }
    }
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * A verified custom host, after the proxy resolved it to a page id. It is the same cached public
 * read and the same tag as the handle host, so a publish shows on both at once. `og:url` names the
 * page's primary domain (`getPrimaryDomain`, M4-09), which is also what a search engine should treat
 * as canonical. A draft-only page, an unknown id and the sentinel the proxy uses for an unknown
 * host are the plain 404; a suspended owner is the "isn't available" 404.
 */
export async function siteResponse(pageId: string): Promise<Response> {
  try {
    const state = await getTenantPageStateById(pageId);
    if (state.kind === "suspended") return htmlResponse(unavailableDocument(), 404);
    if (state.kind !== "published") return plainNotFoundResponse();

    const { page } = state;
    const hostname = await getPrimaryDomain(pageId);
    const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
    const urls = hostname
      ? {
          page: `${customOrigin(hostname, rootDomain)}/`,
          image: customOgImageUrl(hostname, page.publishedAt, rootDomain),
        }
      : null;
    return htmlResponse(
      renderLivePage({
        pageId: page.pageId,
        document: page.document,
        plan: page.plan,
        urls,
      }),
    );
  } catch (error) {
    return failureResponse(error);
  }
}
