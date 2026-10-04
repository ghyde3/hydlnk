"use client";

import type { MouseEvent } from "react";
import { PreviewFonts } from "@/components/design/tenant-fonts";
import { PageRenderer, type PageChrome } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import {
  PREVIEW_FAILED_MESSAGE,
  missingImagesNote,
  previewingStatus,
} from "@/lib/versions/messages";
import type { HistoryRow } from "@/lib/versions/load";
import { LocalTime } from "./local-time";

/** What the preview shows: nothing chosen yet, one version loading, loaded, or failed. */
export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; version: HistoryRow }
  | { status: "ready"; version: HistoryRow; doc: PublishDoc; missingImages: number }
  | { status: "failed"; version: HistoryRow };

/**
 * A version drawn with the shared `PageRenderer` (M6-50): the same component the live page and the
 * editor use, so what shows here is what that Publish showed, under the version's own frozen
 * tokens. Only that version's two font families are requested (`PreviewFonts`), embeds are still
 * posters (nothing is requested from YouTube or Spotify), and a click on a link goes nowhere.
 *
 * `bezel` draws it in the 310x660 phone frame of the desktop column; without it the page runs at
 * the full width of its container (the phone's full-screen sheet).
 */
export function VersionPage({
  doc,
  pageId,
  chrome,
  bezel,
}: {
  doc: PublishDoc;
  pageId: string;
  chrome: PageChrome;
  bezel: boolean;
}) {
  function onClickCapture(event: MouseEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("a")) event.preventDefault();
  }
  const page = (
    <div data-testid="version-page" onClickCapture={onClickCapture} className="w-full">
      <PreviewFonts tokens={doc.tokens} nameFont={doc.profile.nameFont} />
      <PageRenderer doc={doc} pageId={pageId} mode="preview" chrome={chrome} inertEmbeds />
    </div>
  );
  if (!bezel) return page;
  return (
    <div
      data-testid="version-bezel"
      className="box-border h-[660px] w-[310px] rounded-[38px] border border-line-3 bg-ink p-[9px]"
    >
      <div className="h-full overflow-x-hidden overflow-y-auto rounded-[30px]">{page}</div>
    </div>
  );
}

/**
 * The lines above a previewed version: its name and time, the polite "Previewing version 12.", the
 * note about images that are gone, and the states before and after the load. Shared by the desktop
 * column and the phone sheet.
 */
export function VersionPreviewBody({
  state,
  pageId,
  chrome,
  bezel,
  onRetry,
}: {
  state: PreviewState;
  pageId: string;
  chrome: PageChrome;
  bezel: boolean;
  onRetry: () => void;
}) {
  if (state.status === "idle") {
    return (
      <p
        data-testid="preview-placeholder"
        className="m-0 w-full rounded-md border border-dashed border-line-3 p-4 text-[13px] leading-normal text-text-2"
      >
        Choose Preview on a version to see it here.
      </p>
    );
  }

  const { version } = state;
  return (
    <div
      className="flex w-full flex-col items-center gap-2.5"
      aria-busy={state.status === "loading"}
    >
      <div className="flex w-full flex-col gap-0.5">
        <h2 className="m-0 text-sm font-semibold">Version {version.versionNo}</h2>
        <LocalTime iso={version.publishedAt} className="font-mono text-xs text-text-2" />
      </div>
      <p role="status" data-testid="preview-status" className="m-0 w-full text-xs text-text-2">
        {state.status === "ready"
          ? previewingStatus(version.versionNo)
          : state.status === "loading"
            ? "Loading…"
            : ""}
      </p>
      {state.status === "failed" ? (
        <div className="flex w-full flex-col items-start gap-2">
          <p role="alert" className="m-0 text-[13px] leading-normal text-bad">
            {PREVIEW_FAILED_MESSAGE}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
          >
            Retry
          </button>
        </div>
      ) : null}
      {state.status === "ready" && state.missingImages > 0 ? (
        <p
          data-testid="preview-missing"
          className="m-0 w-full text-[13px] leading-normal text-brass-soft-text"
        >
          {missingImagesNote(state.missingImages)}
        </p>
      ) : null}
      {state.status === "ready" ? (
        <VersionPage doc={state.doc} pageId={pageId} chrome={chrome} bezel={bezel} />
      ) : null}
    </div>
  );
}
