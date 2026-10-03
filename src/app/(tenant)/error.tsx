"use client";

import { TenantErrorPanel } from "@/components/tenant/error-panel";

/** A tenant page that throws (M5-20): never a stack trace, never the tenant's own content. */
export default function TenantError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <TenantErrorPanel error={error} onRetry={retry} />;
}
