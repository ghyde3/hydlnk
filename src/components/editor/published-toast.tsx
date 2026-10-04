"use client";

import { useEffect, useState } from "react";

/** How long "Published." stays. */
export const PUBLISHED_TOAST_MS = 8000;

/**
 * The publish toast (M2-23): "Published." with a link to the live page, in a polite live region that
 * is always in the page (a region that appears with its text is not reliably announced). It sits
 * where the delete toast does: above the phone tab bar, bottom left of the main column on desktop.
 * `lifted` moves it up while the delete toast is showing so the two never overlap.
 *
 * `token` changes on every successful Publish, so a second Publish shows (and announces) it again.
 */
export function PublishedToast({
  token,
  liveUrl,
  lifted,
}: {
  /** Null until the first successful Publish of this session. */
  token: number | null;
  liveUrl: string;
  lifted: boolean;
}) {
  const [dismissedToken, setDismissedToken] = useState<number | null>(null);
  useEffect(() => {
    if (token === null) return;
    const timer = setTimeout(() => setDismissedToken(token), PUBLISHED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [token]);

  const visible = token !== null && token !== dismissedToken;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-4 right-[72px] z-30 hl:right-auto hl:left-[272px] ${
        lifted
          ? "bottom-[calc(132px+env(safe-area-inset-bottom))] hl:bottom-[88px]"
          : "bottom-[calc(68px+env(safe-area-inset-bottom))] hl:bottom-6"
      }`}
    >
      {visible ? (
        <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-md bg-ink py-1 pr-1 pl-4 text-sm text-on-ink hl:w-fit hl:min-w-[280px]">
          <span>Published.</span>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center rounded-sm px-4 font-semibold text-ink-link underline underline-offset-2"
          >
            View live page
          </a>
        </div>
      ) : null}
    </div>
  );
}
