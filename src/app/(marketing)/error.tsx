"use client";

import { ErrorPage } from "@/components/error-page";

/** A marketing page that throws (M5-20): the same message and Retry as everywhere else. */
export default function MarketingError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPage error={error} onRetry={retry} />;
}
