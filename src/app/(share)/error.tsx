"use client";

import { ErrorPage } from "@/components/error-page";

/** A shared preview that throws (a database failure is a 500, never "not active"): the same error page as the rest of the app host, with no session read. */
export default function ShareError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPage error={error} onRetry={retry} />;
}
