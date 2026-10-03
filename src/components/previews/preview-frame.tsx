"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The wrapper around a page drawn for preview outside the editor (the owner's /preview/{pageId} and
 * the shared /share link, M6-10, M6-11). The renderer leaves its links alone so its markup is the
 * same everywhere; this frame stops a click or tap on any link, card, social icon or grid cell from
 * going anywhere, as the editor's own preview does, so a preview never leaves its URL and never
 * reaches /r/ (no click is tracked, and no view is: nothing here renders the beacon).
 */
export function PreviewFrame({ children }: { children: ReactNode }) {
  function stopNavigation(event: MouseEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("a")) event.preventDefault();
  }
  return (
    <div data-preview-frame="" onClickCapture={stopNavigation} onAuxClickCapture={stopNavigation}>
      {children}
    </div>
  );
}
