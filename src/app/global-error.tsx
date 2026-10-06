"use client";

import "./globals.css";
import { useEffect } from "react";
import { ErrorPanel } from "@/components/error-panel";
import { reportError } from "@/lib/sentry/report";

/**
 * The last resort (M5-20): an error in a root layout itself. It replaces the document, so it brings
 * its own <html> and <body> and the global stylesheet, and says exactly what every other error page
 * says: "Something went wrong. Try again.", a Retry and a small reference id.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Sentry (M9-10): a no-op unless the browser SDK was started, which only the app host does.
  useEffect(() => reportError(error), [error]);
  return (
    <html lang="en">
      <body>
        <ErrorPanel error={error} onRetry={retry} />
      </body>
    </html>
  );
}
