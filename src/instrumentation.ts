import type { Instrumentation } from "next";
import { resolveSentryDsn } from "@/lib/sentry/dsn";

/**
 * Next.js's server hook (M9-10): starts Sentry for the app host when a DSN is set, and sends it the
 * errors of server rendering, server actions and route handlers.
 *
 * `process.env.NEXT_PUBLIC_SENTRY_DSN` is inlined by next.config.ts as the validated DSN, or as ""
 * when it is unset or unusable, so with Sentry off the branches below are removed by the bundler and
 * the SDK is not compiled in. The server config (src/lib/sentry/server.ts) is loaded only inside the
 * branch. `instrumentation-client.ts` is deliberately not used: Next.js 16 would load it on every
 * page, the marketing site's included; the browser starts Sentry from the app host's layout instead.
 */

type SentryServer = typeof import("@/lib/sentry/server");

let sentry: SentryServer | null = null;

/** The raw runtime value, read by name so it is not inlined: only to tell "unset" from "unusable". */
const runtimeValue = (name: string): string | undefined => process.env[name];

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const server = await import("@/lib/sentry/server");
    server.initSentryServer(process.env.NEXT_PUBLIC_SENTRY_DSN);
    sentry = server;
    return;
  }
  // Off. A value that was set but not usable gets one line, naming the variable and never the value.
  resolveSentryDsn(runtimeValue("NEXT_PUBLIC_SENTRY_DSN"), (line) => console.warn(line));
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (sentry === null) return;
  await sentry.captureAppRequestError(error, request, context);
};
