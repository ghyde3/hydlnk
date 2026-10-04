"use client";

import { useEffect } from "react";
import { ErrorPage } from "@/components/error-page";
import { reportError } from "@/lib/sentry/report";

/** Anything on the app host outside the signed-in screens (sign-in, claim, admin) that throws (M5-20). */
export default function AppHostError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Sentry (M9-10): reported once, and only when it is on. Nothing on the page changes.
  useEffect(() => reportError(error), [error]);
  return <ErrorPage error={error} onRetry={retry} />;
}
