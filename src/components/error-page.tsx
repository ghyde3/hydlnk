"use client";

import Link from "next/link";
import { ErrorPanel } from "@/components/error-panel";
import { Logo } from "@/components/logo";

/** An error page of its own: the charcoal bar with the logo, then the panel. For `error.tsx` files outside the app shell. */
export function ErrorPage({
  error,
  onRetry,
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-14 items-center bg-ink px-4 text-on-ink hl:px-6">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
      </div>
      <ErrorPanel error={error} onRetry={onRetry} />
    </div>
  );
}
