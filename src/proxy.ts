import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { testHooksEnabled } from "@/lib/env/test-hooks";
import { resolveCustomDomain } from "@/lib/routing/custom-domain";
import { classifyHost, invalidHandleLabel } from "@/lib/routing/host";
import {
  NOT_FOUND_PATH,
  PLAIN_404_PATH,
  UNKNOWN_SITE_ID,
  appRewritePath,
  isInternalPath,
  isTrackingPath,
  siteRewritePath,
  tenantRewritePath,
} from "@/lib/routing/paths";
import {
  SHARE_INTERNAL_PATH,
  isShareInternalPath,
  isSharePath,
} from "@/lib/previews/share-headers";
import { shareProxy } from "@/lib/previews/share-proxy";
import { adminDraftProxy, isAdminDraftPath } from "@/lib/previews/admin-draft-proxy";
import { classifyAppPath } from "@/lib/routing/app-paths";
import { bearerPathProxy } from "@/lib/routing/bearer-proxy";
import { rewriteWithSession } from "@/lib/routing/session";
import { setTenantHeaders } from "@/lib/routing/tenant-headers";
import { appOrigin, protocolFor } from "@/lib/routing/urls";

/** A tenant page is a read-only document: it answers GET and HEAD. */
function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/**
 * Any method but GET and HEAD on a tenant or custom host, other than the tracking routes (which the
 * callers pass through first). On the page itself (`/`) it is 405 with `Allow: GET, HEAD` and the
 * tenant security headers (M8-02): answered here because a static route handler cannot also export
 * POST, and because Next.js would otherwise hand a POST the cached copy of the page. On every other
 * path it is the plain 404 it always was (M4-09: nothing but the page, its image and the tracking
 * routes lives on these hosts), with the same headers and no body. Never a lookup, never a cookie.
 */
function tenantMethodRejected(pathname: string): NextResponse {
  const page = pathname === "/";
  const response = new NextResponse(null, {
    status: page ? 405 : 404,
    headers: { ...(page ? { Allow: "GET, HEAD" } : {}), "Cache-Control": "no-store" },
  });
  setTenantHeaders(response.headers);
  return response;
}

/**
 * Host routing (PLAN.md -> Architecture). Next.js 16's `proxy` is the renamed middleware and runs
 * on the Node.js runtime. Everything below keys off the Host header:
 *
 *   hydlnk.com, *.vercel.app  marketing, served as-is (/login and /signup: 308 to the app host)
 *   www.hydlnk.com            308 to the root host
 *   app.hydlnk.com            rewrite to /app/..., refreshing the Supabase session (only here)
 *   <handle>.hydlnk.com       rewrite to /t/<handle> (the page) or /t/<handle>/og (its image); every
 *                             other path is rewritten to the one plain 404, /sites/unknown
 *   anything else             custom-domain lookup: a verified domain is rewritten to /sites/<pageId>
 *                             (or /sites/<pageId>/og), which answers the plain 404 unless that page is
 *                             published; every other path, and an unknown host on every path, is the
 *                             one plain 404 as well (M4-09, M8-10)
 *
 * Why one 404 path: the page routes are static, so Next.js stores one cache entry per distinct path
 * it is asked for. A sub-path rewritten to a route of its own would let anybody fill the cache with
 * invented paths (Wave J security review); every request that is not a page, its image, a tracking
 * route or a test hook (flag on, never in production) is rewritten to the same URL instead.
 *
 * The internal prefixes (/app, /t, /sites) exist only as rewrite targets: a visitor asking for one
 * directly on the root host gets a 404. Consequences for later milestones:
 *   - everything on the app host lives under src/app/(editor)/app/, so the auth callback is
 *     .../app/auth/callback/route.ts and the Stripe webhook .../app/api/stripe/webhook/route.ts;
 *   - the tracking routes (/r/..., /c/..., /api/e) are served from every host: tenant hosts and resolved
 *     custom hosts leave them unrewritten (`isTrackingPath`), so the handlers at the root of the app
 *     answer them.
 *
 * A custom host is attacker-controlled input: only the request's real Host header is read (never
 * X-Forwarded-Host or X-Original-Host), the request's cookies are dropped before the page renders
 * (no custom host ever sees an auth cookie) and no response sets one.
 */
export async function proxy(request: NextRequest) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  const host = request.headers.get("host") ?? "";
  const { kind, handle } = classifyHost(host, rootDomain);
  const { pathname } = request.nextUrl;

  const rewriteTo = (path: string) => {
    // The one plain tenant 404 is the same URL whatever was asked for: no query string, no trailing
    // slash, so everything that lands there shares one cache entry.
    if (path === PLAIN_404_PATH) return new URL(PLAIN_404_PATH, request.nextUrl.origin);
    const url = request.nextUrl.clone();
    url.pathname = path;
    return url;
  };

  switch (kind) {
    case "www": {
      const [hostname = "", port = ""] = rootDomain.split(":");
      const url = request.nextUrl.clone();
      url.protocol = protocolFor(rootDomain);
      url.hostname = hostname;
      url.port = port;
      return NextResponse.redirect(url, 308);
    }

    case "marketing":
      // /login and /signup live on the app host only; a stale link or typed URL on the root host
      // is sent there with its query string intact (M1-06).
      if (pathname === "/login" || pathname === "/signup") {
        return NextResponse.redirect(
          new URL(`${pathname}${request.nextUrl.search}`, appOrigin(rootDomain)),
          308,
        );
      }
      if (isInternalPath(pathname)) return NextResponse.rewrite(rewriteTo(NOT_FOUND_PATH));
      // The click redirect and "Save contact" belong to a page's own hosts: on the root host (and
      // deployment hosts) there is no page, so /r/* and /c/* are the plain 404 here (the handlers
      // check the host as well).
      if (pathname.startsWith("/r/") || pathname.startsWith("/c/")) {
        return NextResponse.rewrite(rewriteTo(NOT_FOUND_PATH));
      }
      return NextResponse.next();

    case "app": {
      // Wave L (M10-02): the connector's bearer and discovery paths are the second set of app-host paths
      // that never touch a session cookie (src/lib/routing/app-paths.ts): the proxy only rewrites them.
      const bearerPath = classifyAppPath(pathname);
      if (bearerPath) {
        return bearerPathProxy(request, rewriteTo(appRewritePath(pathname)), bearerPath);
      }
      // The private share link (M6-10) is the other app-host path that never touches the session: the
      // proxy rate limits it, sets its headers and only rewrites (see src/lib/previews/share-proxy.ts).
      if (isSharePath(pathname)) {
        return shareProxy(request, rewriteTo(appRewritePath(SHARE_INTERNAL_PATH)));
      }
      // The admin's read-only view of a draft (M13-11) needs the session (admin only) and the share
      // preview's response headers: see src/lib/previews/admin-draft-proxy.ts.
      if (isAdminDraftPath(pathname)) {
        return adminDraftProxy(request, rewriteTo(appRewritePath(pathname)));
      }
      // That internal route is a rewrite target only. Asked for directly it would skip the rate
      // limit, the share headers and the nonce policy above and read a token from a request header
      // the client chose, so it is the app's plain 404 like any other unknown path.
      if (isShareInternalPath(pathname)) {
        return rewriteWithSession(request, rewriteTo(appRewritePath(NOT_FOUND_PATH)));
      }
      return rewriteWithSession(request, rewriteTo(appRewritePath(pathname)));
    }

    case "tenant": {
      if (isTrackingPath(pathname)) return NextResponse.next();
      if (!isReadMethod(request.method)) return tenantMethodRejected(pathname);
      const response = NextResponse.rewrite(
        rewriteTo(tenantRewritePath(handle ?? "", pathname, testHooksEnabled())),
      );
      setTenantHeaders(response.headers);
      return response;
    }

    case "custom": {
      // One label under the root that is not a handle ("ab", "-x1"): not a custom domain either.
      // It goes to the tenant route, whose 404 says the address "isn’t valid" (M5-20); the label
      // is a plain DNS label (see invalidHandleLabel) and no page can ever have such a handle.
      const label = invalidHandleLabel(host, rootDomain);
      if (label) {
        if (!isReadMethod(request.method)) return tenantMethodRejected(pathname);
        const response = NextResponse.rewrite(
          rewriteTo(tenantRewritePath(label, pathname, testHooksEnabled())),
        );
        setTenantHeaders(response.headers);
        return response;
      }
      // A custom host answers GET and HEAD and nothing else, apart from the tracking routes (which a
      // resolved host passes through below): any other method is the 405 or 404 above, with no lookup.
      if (!isReadMethod(request.method) && !isTrackingPath(pathname)) {
        return tenantMethodRejected(pathname);
      }
      // The real Host header only. A verified domain rewrites to its page, and the page route answers
      // the plain 404 for a draft-only page or a suspended owner; an unknown host, a pending domain
      // and a lookup error all rewrite to the plain tenant 404 (/sites/unknown), with no tenant data in it.
      // The lookup answers null on every failure; the catch is the second wall: never a 500 here.
      // M8-10: the lookup is remembered for a short while (src/lib/routing/custom-domain.ts). The
      // test flag HYDLNK_QUERY_COUNTER=1 (never set in production, and ignored on a Vercel production
      // deployment, see testHooksEnabled) adds `x-hl-domain-cache: HIT|MISS`
      // to the response so a spec can tell a remembered answer from a database read.
      let pageId: string | null = null;
      let domainCache = null as string | null; // assigned from the callback below
      try {
        pageId = testHooksEnabled()
          ? await resolveCustomDomain(host, {
              report: (state) => {
                if (state === "HIT" || state === "MISS") domainCache = state;
              },
            })
          : await resolveCustomDomain(host);
      } catch {
        pageId = null;
      }
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      if (pageId && isTrackingPath(pathname)) {
        const passed = NextResponse.next({ request: { headers } });
        if (domainCache) passed.headers.set("x-hl-domain-cache", domainCache);
        return passed;
      }
      const response = NextResponse.rewrite(
        rewriteTo(siteRewritePath(pageId ?? UNKNOWN_SITE_ID, pathname)),
        { request: { headers } },
      );
      setTenantHeaders(response.headers);
      response.headers.delete("set-cookie");
      if (domainCache) response.headers.set("x-hl-domain-cache", domainCache);
      return response;
    }
  }
}

export const config = {
  // Skip Next.js internals (including dev HMR), the framework's metadata files and static assets:
  // any path ending in a static file extension, video included (the showreel in public/marketing
  // is .mp4, .webm and .mov). Those requests never need a host decision, and the proxy would otherwise
  // run once per image and per video range request. The extension rule does not apply under /app,
  // /t, /sites, /r and /c (the lookahead `(?!(?:app|t|sites|r|c)/)`): those are routed by host, so
  // `/app/api/domains/<uuid>.png` still gets its host check instead of reaching the app route. tests/unit/routing-proxy-matcher.test.ts
  // checks that every file in public/ is covered. There is deliberately no /marketing/ prefix
  // rule: a path that is not a file must still get its host's routing and 404. robots.txt and
  // sitemap.xml are route handlers that read the Host header themselves
  // (src/lib/marketing/seo.ts), so they stay unmatched. The pattern has to be a literal so
  // Next.js can analyse it at build time.
  matcher: [
    "/((?!_next|__nextjs|favicon\\.ico|robots\\.txt|sitemap\\.xml|(?!(?:app|t|sites|r|c)/).*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|map|txt|xml|webmanifest|woff2?|mp4|webm|mov)$).*)",
  ],
};
