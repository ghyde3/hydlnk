import * as Sentry from "@sentry/nextjs";
import { parseSentryDsn } from "./dsn";
import { createBeforeBreadcrumb, createBeforeSend, createBeforeSendTransaction } from "./hooks";
import { SENTRY_OPTIONS, sentryEnvironment } from "./options";
import { setErrorReporter } from "./report";

/**
 * Starts the browser SDK on the app host (M9-10). This module is the only place the browser imports
 * `@sentry/nextjs`, and it is only ever loaded by a dynamic `import()` from
 * src/components/app/error-monitor.tsx, when a DSN is set: with none, this chunk is never
 * downloaded and `Sentry.init` is never called.
 *
 * The SDK is initialised with the shared options (./options.ts: no PII, 10% of traces, no replay,
 * no feedback widget, no tunnel), the scrubbing hooks, and no `Sentry.setUser` call anywhere.
 */

let started = false;

export function startSentryClient(rawDsn: string | undefined): boolean {
  if (started) return true;
  const dsn = parseSentryDsn(rawDsn);
  if (!dsn) return false;
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  const scrub = { rootDomain };
  Sentry.init({
    ...SENTRY_OPTIONS,
    dsn,
    environment: sentryEnvironment({ NODE_ENV: process.env.NODE_ENV }),
    beforeSend: createBeforeSend(scrub),
    beforeSendTransaction: createBeforeSendTransaction(scrub),
    beforeBreadcrumb: createBeforeBreadcrumb(scrub),
  });
  setErrorReporter((error) => {
    Sentry.captureException(error);
  });
  started = true;
  return true;
}
