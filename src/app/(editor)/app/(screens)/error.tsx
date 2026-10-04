"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/error-panel";
import { reportError } from "@/lib/sentry/report";

/**
 * A signed-in screen that throws (M5-20): the app shell stays (sidebar, tab bar), the screen is
 * replaced by "Something went wrong. Try again.", a Retry that renders it again and a small
 * reference id. Never a stack trace. The Editor and Design catch their own load failures first.
 */
export default function ScreenError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Sentry (M9-10): reported once, and only when it is on. Nothing on the page changes.
  useEffect(() => reportError(error), [error]);
  return <ErrorPanel as="div" error={error} onRetry={retry} />;
}
