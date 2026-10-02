"use client";

import type { MouseEvent } from "react";
import { PreviewFonts } from "@/components/design/tenant-fonts";
import type { PublishDoc } from "@/lib/document";
import { PageRenderer, type PageChrome } from "@/lib/editor/contracts";
import { panelId, tabId, type EditorView } from "./view-tabs";

/**
 * The live preview (M2-06): `PageRenderer` fed with the draft's publish form, in a 310x660 phone
 * bezel at 760px and up and full width, with no bezel, on the phone's Preview tab. The renderer is
 * the same component the public page uses, so what shows here is what Publish will show.
 *
 * Inside the frame only tenant styling applies: no HYDLNK token reaches the renderer. The frame
 * stops clicks on links so a tap on a link or social icon never leaves the editor (the renderer
 * leaves the hrefs alone so the markup stays identical everywhere).
 */
export function PreviewPanel({
  doc,
  pageId,
  chrome,
  view,
  isDesktop,
}: {
  doc: PublishDoc;
  pageId: string;
  /** The footer links, from `pageChrome(plan, pageId)`: the same decision the live page makes (M2-28, M2-29). */
  chrome: PageChrome;
  /** Phone only: which tab is open. At 760px and up the preview is always shown. */
  view: EditorView;
  isDesktop: boolean;
}) {
  function stopNavigation(event: MouseEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("a")) event.preventDefault();
  }

  return (
    <section
      id={panelId("preview")}
      aria-label={isDesktop ? "Live preview" : undefined}
      aria-labelledby={isDesktop ? undefined : tabId("preview")}
      role={isDesktop ? undefined : "tabpanel"}
      className={`min-w-0 flex-col items-center gap-2.5 hl:sticky hl:top-4 hl:flex hl:w-[330px] hl:shrink-0 hl:self-start ${
        view === "preview" ? "flex" : "hidden"
      }`}
    >
      <div className="hidden w-full items-center justify-between hl:flex">
        <span className="font-mono text-[13px] font-semibold tracking-[0.06em] text-text-2 uppercase">
          Live preview
        </span>
        <span className="text-xs text-text-2">Your page&apos;s own theme</span>
      </div>
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
    </section>
  );
}
