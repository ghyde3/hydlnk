import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { resolveCustomDomain } from "@/lib/routing/custom-domain";
import { classifyHost, invalidHandleLabel } from "@/lib/routing/host";
import {
  NOT_FOUND_PATH,
  UNKNOWN_SITE_ID,
  appRewritePath,
  isInternalPath,
  siteRewritePath,
  tenantRewritePath,
} from "@/lib/routing/paths";
import { rewriteWithSession } from "@/lib/routing/session";
import { setTenantHeaders } from "@/lib/routing/tenant-headers";
import { appOrigin, protocolFor } from "@/lib/routing/urls";

/**
 * Host routing (PLAN.md -> Architecture). Next.js 16's `proxy` is the renamed middleware and runs
 * on the Node.js runtime. Everything below keys off the Host header:
 *
 *   hydlnk.com, *.vercel.app  marketing, served as-is (/login and /signup: 308 to the app host)
 *   www.hydlnk.com            308 to the root host
 *   app.hydlnk.com            rewrite to /app/..., refreshing the Supabase session (only here)
 *   <handle>.hydlnk.com       rewrite to /t/<handle>/...
 *   anything else             custom-domain lookup (stub), rewrite to /sites/<pageId>
 *
 * The internal prefixes (/app, /t, /sites) exist only as rewrite targets: a visitor asking for one
 * directly on the root host gets a 404. Consequences for later milestones:
 *   - everything on the app host lives under src/app/(editor)/app/, so the auth callback is
 *     .../app/auth/callback/route.ts and the Stripe webhook .../app/api/stripe/webhook/route.ts;
 *   - the tracking routes (/r/..., /api/e) are served from every host, so M4 has to exempt them from
 *     the tenant and custom-domain rewrites.
 */
export async function proxy(request: NextRequest) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  const host = request.headers.get("host") ?? "";
  const { kind, handle } = classifyHost(host, rootDomain);
  const { pathname } = request.nextUrl;

  const rewriteTo = (path: string) => {
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
      return NextResponse.next();

    case "app":
      return rewriteWithSession(request, rewriteTo(appRewritePath(pathname)));

    case "tenant": {
      const response = NextResponse.rewrite(rewriteTo(tenantRewritePath(handle ?? "", pathname)));
      setTenantHeaders(response.headers);
      return response;
    }

    case "custom": {
      // One label under the root that is not a handle ("ab", "-x1"): not a custom domain either.
      // It goes to the tenant route, whose 404 says the address "isn’t valid" (M5-20); the label
      // is a plain DNS label (see invalidHandleLabel) and no page can ever have such a handle.
      const label = invalidHandleLabel(host, rootDomain);
      if (label) {
        const response = NextResponse.rewrite(rewriteTo(tenantRewritePath(label, pathname)));
        setTenantHeaders(response.headers);
        return response;
      }
      // TODO(M4): resolveCustomDomain looks the host up in `domains`; unknown hosts get the plain
      // tenant 404 (the /sites/[pageId] stub always answers notFound until then).
      const pageId = await resolveCustomDomain(host);
      const response = NextResponse.rewrite(
        rewriteTo(siteRewritePath(pageId ?? UNKNOWN_SITE_ID, pathname)),
      );
      setTenantHeaders(response.headers);
      return response;
    }
  }
}

export const config = {
  // Skip Next.js internals (including dev HMR), the framework's metadata files and static assets:
  // any path ending in a static file extension, video included (the showreel in public/marketing
  // is .mp4 and .webm). Those requests never need a host decision, and the proxy would otherwise
  // run once per image and per video range request. tests/unit/routing-proxy-matcher.test.ts
  // checks that every file in public/ is covered. There is deliberately no /marketing/ prefix
  // rule: a path that is not a file must still get its host's routing and 404. robots.txt and
  // sitemap.xml are route handlers that read the Host header themselves
  // (src/lib/marketing/seo.ts), so they stay unmatched. The pattern has to be a literal so
  // Next.js can analyse it at build time.
  matcher: [
    "/((?!_next|__nextjs|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|map|txt|xml|webmanifest|woff2?|mp4|webm)$).*)",
  ],
};
