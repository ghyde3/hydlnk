import type { CSSProperties, ReactNode, Ref } from "react";
import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import { fontStack } from "./fonts";
import "./try.css";

/** The renderer wants a page id for its links; the sample page has none to track. */
const SAMPLE_PAGE_ID = "00000000-0000-4000-8000-0000000000a1";

/**
 * A phone showing the sample page, drawn by the real page renderer (the one behind every live
 * HYDLNK page). Used for the server-rendered first view and by the interactive builder, so both
 * paint the same markup.
 *
 * The page is `inert` and hidden from assistive technology: it holds sample links that must not be
 * followed or tab-stopped, and the builder announces every change in words instead. The screen
 * around it is the scroll box, and takes focus so the keyboard can scroll it. `mode="preview"`
 * lets an Image block show the renderer's empty-image placeholder, since the sample has no uploads.
 */
export function TryPhone({
  doc,
  screenRef,
}: {
  doc: PublishDoc;
  screenRef?: Ref<HTMLDivElement>;
}) {
  const style = {
    "--try-heading": fontStack(doc.tokens.fontHeading),
    "--try-body": fontStack(doc.tokens.fontBody),
  } as CSSProperties;
  return (
    <div className="try-phone" style={style} data-testid="try-phone">
      <div className="try-bezel">
        <div
          ref={screenRef}
          className="try-screen"
          data-page-frame=""
          data-testid="try-screen"
          role="group"
          aria-label="Preview of your page. Scroll to see all of it."
          tabIndex={0}
        >
          <div className="try-page" inert aria-hidden="true" data-nosnippet="">
            <PageRenderer doc={doc} pageId={SAMPLE_PAGE_ID} mode="preview" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The builder's two columns: the phone with a caption under it, then the controls. The phone moves
 * to the right from 900px.
 */
export function TryLayout({
  phone,
  caption,
  panel,
}: {
  phone: ReactNode;
  caption: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div className="try">
      <div className="try-phone-col">
        {phone}
        {caption}
      </div>
      <div className="try-panel">{panel}</div>
    </div>
  );
}
