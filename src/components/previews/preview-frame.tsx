"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The wrapper around a page drawn for preview outside the editor (the owner's /preview/{pageId} and
 * the shared /share link, M6-10, M6-11). The renderer leaves its links alone so its markup is the
 * same everywhere; this frame stops a click or tap on any link, card, social icon or grid cell from
 * going anywhere, as the editor's own preview does, so a preview never leaves its URL and never
 * reaches /r/ (no click is tracked, and no view is: nothing here renders the beacon). A form block's
 * submit is stopped the same way, so a preview never posts to /f/.
 */
export function PreviewFrame({ children }: { children: ReactNode }) {
  function stopNavigation(event: MouseEvent<HTMLDivElement>): void {
    const anchor = (event.target as Element).closest("a");
    if (!anchor) return;
    // The private share preview's own menu and page links (M12-06) go to another page of the same
    // preview, on this host; every other link stays where it is.
    if (/^\/share\/[A-Za-z0-9_-]{43}(?:\/[a-z0-9-]+)?$/.test(anchor.getAttribute("href") ?? "")) {
      return;
    }
    event.preventDefault();
  }
  return (
    <div
      data-preview-frame=""
      onClickCapture={stopNavigation}
      onAuxClickCapture={stopNavigation}
      // A form block (M17-07) posts nowhere from a preview.
      onSubmitCapture={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}
