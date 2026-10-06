"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { dismiss, isDismissed } from "@/lib/announcements/dismissal";

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export interface BannerAnnouncement {
  id: string;
  message: string;
  link: string | null;
  startsAt: string;
  endsAt: string;
}

/**
 * The banner itself: the message as React text (never HTML), an optional "Read more" link (https only,
 * checked again here), and Dismiss, which hides it in this browser for good (localStorage keyed by the
 * announcement's id). It also hides itself when the end passes while the screen stays open. In the
 * flow (not fixed), so it never covers the phone top bar or the tab bar.
 */
export function AnnouncementBannerView({ announcement }: { announcement: BannerAnnouncement }) {
  const [hidden, setHidden] = useState(false);
  // Dismissed in this browser before: read from storage after hydration (the server draws it shown).
  const dismissedBefore = useSyncExternalStore(
    subscribeToStorage,
    () => isDismissed(announcement.id),
    () => false,
  );

  useEffect(() => {
    const left = Date.parse(announcement.endsAt) - Date.now();
    if (!Number.isFinite(left)) return;
    // setTimeout caps at about 24.8 days; a longer wait is re-checked on the next screen load.
    if (left > 2_147_000_000) return;
    const timer = window.setTimeout(() => setHidden(true), Math.max(left, 0));
    return () => window.clearTimeout(timer);
  }, [announcement.endsAt]);

  if (hidden || dismissedBefore) return null;
  const safeLink =
    announcement.link && /^https:\/\//i.test(announcement.link) ? announcement.link : null;

  return (
    <div
      role="status"
      data-announcement={announcement.id}
      className="flex items-center gap-2 border-b border-line bg-brass-soft px-4 py-1 text-sm leading-snug text-brass-soft-text hl:px-8"
    >
      <p className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">
        <span data-announcement-message>{announcement.message}</span>
        {safeLink ? (
          <>
            {" "}
            <a
              href={safeLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
            >
              Read more
            </a>
          </>
        ) : null}
      </p>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => {
          dismiss(announcement.id);
          setHidden(true);
        }}
        className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg font-semibold"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
