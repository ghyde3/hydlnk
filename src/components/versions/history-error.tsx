"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOAD_FAILED_MESSAGE } from "@/lib/versions/messages";

/**
 * The list could not be read (M6-50, as M5-16 does for the editor): one sentence and a Retry, never
 * the error's own text. Retry asks the server to render the screen again; while that runs the
 * button says so and ignores a second press.
 */
export function HistoryError() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section
      data-testid="history-error"
      className="flex flex-col items-start gap-3 rounded-md border border-bad-line bg-surface p-4 hl:p-5"
    >
      <p role="alert" className="m-0 text-[15px] leading-normal text-bad">
        {LOAD_FAILED_MESSAGE}
      </p>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => startTransition(() => router.refresh())}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-progress disabled:opacity-70"
      >
        Retry
      </button>
    </section>
  );
}
