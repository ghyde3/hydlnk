import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { resolveCustomDomain } from "@/lib/routing/custom-domain";
import { classifyHost } from "@/lib/routing/host";
import {
  NOT_FOUND_PATH,
  UNKNOWN_SITE_ID,
  appRewritePath,
  isInternalPath,
  siteRewritePath,
  tenantRewritePath,
} from "@/lib/routing/paths";
import { rewriteWithSession } from "@/lib/routing/session";
import { protocolFor } from "@/lib/routing/urls";

/**
 * Host routing (PLAN.md -> Architecture). Next.js 16's `proxy` is the renamed middleware and runs
 * on the Node.js runtime. Everything below keys off the Host header:
 *
 *   hydlnk.com, *.vercel.app  marketing, served as-is
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
      if (isInternalPath(pathname)) return NextResponse.rewrite(rewriteTo(NOT_FOUND_PATH));
      return NextResponse.next();

    case "app":
      return rewriteWithSession(request, rewriteTo(appRewritePath(pathname)));

    case "tenant":
      return NextResponse.rewrite(rewriteTo(tenantRewritePath(handle ?? "", pathname)));

    case "custom": {
      // TODO(M4): resolveCustomDomain looks the host up in `domains`; unknown hosts get the plain
      // tenant 404 (the /sites/[pageId] stub always answers notFound until then).
      const pageId = await resolveCustomDomain(host);
      return NextResponse.rewrite(rewriteTo(siteRewritePath(pageId ?? UNKNOWN_SITE_ID, pathname)));
    }
  }
}

export const config = {
  // Skip Next.js internals (including dev HMR), the framework's metadata files and static assets.
  // The pattern has to be a literal so Next.js can analyse it at build time.
  matcher: [
    "/((?!_next|__nextjs|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|map|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
