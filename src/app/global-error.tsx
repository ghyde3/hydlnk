"use client";

import "./globals.css";
import { ErrorPanel } from "@/components/error-panel";

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
  return (
    <html lang="en">
      <body>
        <ErrorPanel error={error} onRetry={retry} />
      </body>
    </html>
  );
}
