"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { LOAD_FAILED_MESSAGE } from "@/lib/editor/messages";

/**
 * What the Editor and Design show when the page's draft cannot be read (M5-15, M5-16): the screen's
 * own header, then an error card with the one sentence and a Retry button, never a blank screen or
 * the error's own text. Retry asks the server to render the screen again (`router.refresh`), which
 * reads the draft anew; while that runs the button says so and ignores a second press.
 */
export function LoadFailure({
  breadcrumb,
  title,
  message = LOAD_FAILED_MESSAGE,
}: {
  breadcrumb: string;
  title: string;
  message?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <ScreenHeader breadcrumb={breadcrumb} title={title} />
      <ScreenBody>
        <section className="flex flex-col items-start gap-3 rounded-md border border-bad-line bg-surface p-4 hl:p-5">
          <p
            role="alert"
            data-testid="load-failure"
            className="m-0 text-[15px] leading-normal text-bad"
          >
            {message}
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
      </ScreenBody>
    </>
  );
}
