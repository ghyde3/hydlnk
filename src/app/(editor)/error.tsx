"use client";

import { ErrorPage } from "@/components/error-page";

/** Anything on the app host outside the signed-in screens (sign-in, claim, admin) that throws (M5-20). */
export default function AppHostError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPage error={error} onRetry={retry} />;
}
