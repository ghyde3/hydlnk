"use client";

import { useEffect, useState } from "react";
import { ERROR_MESSAGE, errorReference } from "@/lib/error-copy";

/**
 * The body of every failure page on the HYDLNK UI (M5-20): "Something went wrong. Try again.", a
 * Retry button and a small reference id, never the error's message or a stack trace. Used by the
 * route error boundaries (`error.tsx`) and the root `global-error.tsx`. `as="div"` inside the app
 * shell (which has its own <main>), `as="main"` on a page of its own.
 *
 * The reference is Next's digest (it matches the server log) or, for an error that began in the
 * browser, a short id made here and logged with the error so the two can still be matched.
 */
export function ErrorPanel({
  error,
  onRetry,
  as: Wrapper = "main",
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
  as?: "main" | "div";
}) {
  // One id per error, stable across renders.
  const [reference] = useState(() => errorReference(error));
  useEffect(() => {
    console.error(`[error ${reference}]`, error);
  }, [error, reference]);

  return (
    <Wrapper className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start justify-center gap-4 px-4 py-16 hl:px-6">
      <p className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase">Error</p>
      <h1
        role="alert"
        data-testid="error-message"
        className="text-[clamp(26px,5.5vw,36px)] leading-[1.15] font-bold tracking-[-0.02em]"
      >
        {ERROR_MESSAGE}
      </h1>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface"
      >
        Retry
      </button>
      <p data-testid="error-reference" className="font-mono text-xs text-text-3">
        Reference: {reference}
      </p>
    </Wrapper>
  );
}
