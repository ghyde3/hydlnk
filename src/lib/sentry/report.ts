/**
 * `reportError(error)` (M9-10): what the app's error boundaries and `global-error.tsx` call. It does
 * nothing unless the browser SDK was started, which only the app host's layout does and only when a
 * DSN is set, so an error on the marketing site, on a tenant page or anywhere with Sentry off goes
 * nowhere.
 *
 * No Sentry import in this file, on purpose: `global-error.tsx` is shared by every route group, and
 * the marketing site must never reach the SDK. The starter (client.ts) registers the real reporter
 * with `setErrorReporter` once it has started Sentry.
 *
 * An error that carries Next.js's `digest` began on the server, where `onRequestError` has already
 * reported it once (instrumentation.ts); reporting it again from the browser would send it twice.
 */

type Reporter = (error: unknown) => void;

let reporter: Reporter | null = null;

export function setErrorReporter(next: Reporter | null): void {
  reporter = next;
}

export function reportError(error: unknown): void {
  if (reporter === null) return;
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string"
  ) {
    return;
  }
  try {
    reporter(error);
  } catch {
    // Reporting is best effort: it must never break the error page it is called from.
  }
}
