"use client";

import { ErrorPanel } from "@/components/error-panel";

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
  return <ErrorPanel as="div" error={error} onRetry={retry} />;
}
