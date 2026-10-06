import { parseSentryDsn } from "./dsn";

/**
 * Build-time Sentry configuration (M9-10). Loaded by next.config.ts through Node, so relative
 * imports only and nothing from `@sentry/nextjs` at the top: the SDK's build wrapper is required
 * lazily by next.config.ts, and only in the one case below.
 *
 * Source maps are uploaded, and the build wrapped with `withSentryConfig`, only when all three of
 * SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set at build. With any of them missing the
 * plain config is exported and the build makes no request to a Sentry host.
 */

/** An environment: `process.env`, or a test's own. Read here: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, NEXT_PUBLIC_SENTRY_DSN. */
export type SentryBuildEnv = Readonly<Record<string, string | undefined>>;

const present = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/** True when the build should wrap the config and upload source maps. */
export function sentryBuildEnabled(env: SentryBuildEnv): boolean {
  return present(env.SENTRY_AUTH_TOKEN) && present(env.SENTRY_ORG) && present(env.SENTRY_PROJECT);
}

/**
 * The value `NEXT_PUBLIC_SENTRY_DSN` is inlined as: the validated DSN, or "" when it is unset or not
 * usable. An empty string is a constant the bundler folds, so with Sentry off its code is not even
 * compiled into a bundle (see src/components/app/error-monitor.tsx and src/instrumentation.ts).
 */
export function inlinedSentryDsn(env: SentryBuildEnv): string {
  return parseSentryDsn(env.NEXT_PUBLIC_SENTRY_DSN) ?? "";
}

/**
 * The options of `withSentryConfig`: quiet, no telemetry to Sentry about the build itself, no tunnel
 * route (no new route on any host), source maps uploaded then deleted from the build, and none of
 * the webpack-only auto-instrumentation that would wrap marketing and tenant routes in Sentry code.
 * The token never appears in the app: it is read here and handed to the build plugin only.
 */
export function sentryBuildOptions(env: SentryBuildEnv) {
  return {
    org: env.SENTRY_ORG!.trim(),
    project: env.SENTRY_PROJECT!.trim(),
    authToken: env.SENTRY_AUTH_TOKEN!.trim(),
    silent: true,
    telemetry: false,
    // No new route on any host: the browser talks to Sentry directly.
    tunnelRoute: undefined,
    widenClientFileUpload: false,
    // Source maps exist to be uploaded, then removed from what is served.
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    // Nothing is wrapped at build time: the SDK is started by instrumentation.ts and the layout
    // only, so a marketing or tenant module never gets Sentry code added to it.
    buildTimeInstrumentation: false,
    routeManifestInjection: false as const,
    webpack: {
      autoInstrumentServerFunctions: false,
      autoInstrumentMiddleware: false,
      autoInstrumentAppDirectory: false,
      automaticVercelMonitors: false,
    },
  };
}
