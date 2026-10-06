"use client";

import type { PageChrome } from "@/components/page/page-renderer";
import { VersionPreviewBody, type PreviewState } from "./version-preview";

/**
 * The preview beside the list at 760px and up (M6-50): a sticky 330px column, so it stays in view
 * while the list scrolls and while a row opens its confirmation, headed with the version's name and
 * time, the page in the 310x660 bezel below.
 */
export function PreviewColumn({
  state,
  pageId,
  chrome,
  onRetry,
}: {
  state: PreviewState;
  pageId: string;
  chrome: PageChrome;
  onRetry: () => void;
}) {
  return (
    <aside
      aria-label="Version preview"
      data-testid="history-preview"
      className="sticky top-4 flex w-[330px] shrink-0 flex-col items-center gap-2.5 self-start"
    >
      <VersionPreviewBody state={state} pageId={pageId} chrome={chrome} bezel onRetry={onRetry} />
    </aside>
  );
}
