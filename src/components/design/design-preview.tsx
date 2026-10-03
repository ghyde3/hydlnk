"use client";

import type { MouseEvent } from "react";
import { PageRenderer, type PageChrome } from "@/lib/editor/contracts";
import type { PublishDoc } from "@/lib/document";
import { ThemePreviewBar, ThemePreviewHeader, type ThemePreviewView } from "@/components/themes";
import { PreviewFonts } from "./tenant-fonts";
import { designPanelId, designTabId, type DesignView } from "./design-tabs";

/**
 * The Design screen's live preview (M3-06): `PageRenderer` fed with the draft's publish form, the
 * same component the public page uses, in a 310x660 phone bezel at 760px and up and full width,
 * with no bezel, on the phone's Preview tab. The frame stops clicks on links so a tap on a link
 * never leaves the screen (the renderer leaves the hrefs alone so the markup stays identical).
 *
 * While a theme is on show (`themePreview`, M6-44) `doc` is the page with that theme applied: the
 * column's header reads "Previewing <theme>" with its Apply and Stop buttons (the phone gets a bar
 * above the tab bar instead), and a polite status announces it.
 */
export function DesignPreview({
  doc,
  pageId,
  chrome,
  view,
  isDesktop,
  themePreview = null,
}: {
  doc: PublishDoc;
  pageId: string;
  chrome: PageChrome;
  /** Phone only: which tab is open. At 760px and up the preview is always shown. */
  view: DesignView;
  isDesktop: boolean;
  /** M6-44: a theme on show in place of the page's own, or null. */
  themePreview?: ThemePreviewView | null;
}) {
  function stopNavigation(event: MouseEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("a")) event.preventDefault();
  }

  return (
    <section
      id={designPanelId("preview")}
      aria-label={
        isDesktop ? (themePreview ? `Previewing ${themePreview.name}` : "Live preview") : undefined
      }
      aria-labelledby={isDesktop ? undefined : designTabId("preview")}
      role={isDesktop ? undefined : "tabpanel"}
      className={`min-w-0 flex-col items-center gap-2.5 hl:sticky hl:top-4 hl:flex hl:w-[330px] hl:shrink-0 hl:self-start ${
        view === "preview" ? "flex" : "hidden"
      }`}
    >
      <p role="status" aria-live="polite" className="sr-only" data-testid="theme-preview-status">
        {themePreview?.status ?? ""}
      </p>
      {themePreview && isDesktop ? (
        <ThemePreviewHeader preview={themePreview} />
      ) : (
        <div className="hidden w-full items-center justify-between hl:flex">
          <span className="font-mono text-[13px] font-semibold tracking-[0.06em] text-text-2 uppercase">
            Live preview
          </span>
          <span className="text-xs text-text-2">A block’s own style still wins</span>
        </div>
      )}
      <div
        data-testid="preview-bezel"
        className="box-border w-full border-0 bg-transparent p-0 hl:h-[660px] hl:w-[310px] hl:rounded-[38px] hl:border hl:border-line-3 hl:bg-ink hl:p-[9px]"
      >
        <div
          data-testid="preview-screen"
          data-page-frame=""
          onClickCapture={stopNavigation}
          className="h-auto overflow-x-hidden rounded-md hl:h-full hl:overflow-y-auto hl:rounded-[30px]"
        >
          <PreviewFonts tokens={doc.tokens} />
          <PageRenderer doc={doc} pageId={pageId} mode="preview" chrome={chrome} />
        </div>
      </div>
      {themePreview && !isDesktop ? <ThemePreviewBar preview={themePreview} /> : null}
    </section>
  );
}
