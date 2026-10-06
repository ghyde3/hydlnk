import type { NextConfig } from "next";
import { inlinedSentryDsn, sentryBuildEnabled, sentryBuildOptions } from "./src/lib/sentry/build";
import { TENANT_ASSET_HEADERS } from "./src/lib/tenant-assets/headers";

// Host routing lives in src/proxy.ts (local dev hosts need no allowedDevOrigins in Next.js 16).
//
// The www -> root redirect is declared here as well, and runs before the proxy does. The reason is
// local development: when the app is self-hosted (`next dev`, `next start`), Next.js rewrites any
// redirect that points at its own origin into a relative Location header. Redirecting
// www.localhost:3000 to localhost:3000 from the proxy would therefore answer "Location: /" and loop
// forever. A redirect declared in config keeps its absolute Location. The proxy keeps its own www
// branch as a fallback; on Vercel the platform redirects www before the app is reached.
const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim().toLowerCase() ?? "";
const rootHostname = rootDomain.split(":")[0] ?? "";
const isLocal = rootHostname === "localhost" || rootHostname.endsWith(".localhost");

const nextConfig: NextConfig = {
  // Sentry (M9-10) is on only when NEXT_PUBLIC_SENTRY_DSN holds a usable DSN. It is inlined as that
  // DSN, or as "" when it is unset or unusable: a constant the bundler folds, so with Sentry off its
  // code is not compiled into any bundle (src/components/app/error-monitor.tsx, src/instrumentation.ts).
  env: { NEXT_PUBLIC_SENTRY_DSN: inlinedSentryDsn(process.env) },
  // The tenant script and the theme font files are static files under public/_t/ at hashed paths:
  // a year, immutable, nosniff (M8-01, M8-05). The platform serves public/ files as they are, so this
  // is the only place their headers can be declared.
  async headers() {
    return TENANT_ASSET_HEADERS;
  },
  async redirects() {
    if (!rootDomain) return [];
    return [
      {
        source: "/:path*",
        // The value is a regular expression and Next.js compares it with the hostname, port removed.
        has: [{ type: "host", value: `www\\.${rootHostname.replaceAll(".", "\\.")}` }],
        destination: `${isLocal ? "http" : "https"}://${rootDomain}/:path*`,
        permanent: true,
      },
    ];
  },
};

/**
 * Source maps are uploaded to Sentry only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are
 * all set at build (M9-10). Only then is the SDK's build wrapper loaded (it is large) and applied;
 * with any of them missing the plain config above is exported and the build never talks to Sentry.
 * The wrapper adds `experimental.clientTraceMetadata`, which makes Next.js write `sentry-trace` and
 * `baggage` meta tags into rendered HTML: marketing pages must not carry them, so it is put back.
 */
function withSentry(config: NextConfig): NextConfig {
  // Loaded lazily, and through `require`: next.config.ts is compiled to CommonJS by Next.js. The
  // `/config` entry holds the build wrapper only, not the SDK itself.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withSentryConfig } = require("@sentry/nextjs/config") as typeof import("@sentry/nextjs/config");
  const wrapped = withSentryConfig(config, sentryBuildOptions(process.env)) as NextConfig;
  if (wrapped.experimental) {
    const { clientTraceMetadata, ...experimental } = wrapped.experimental;
    void clientTraceMetadata;
    wrapped.experimental = experimental;
  }
  return wrapped;
}

export default sentryBuildEnabled(process.env) ? withSentry(nextConfig) : nextConfig;
