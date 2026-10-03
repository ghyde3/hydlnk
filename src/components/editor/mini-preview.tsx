"use client";

import { useMemo } from "react";
import type { PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/lib/editor/contracts";

/** The width the page is laid out at inside the thumbnail: a phone screen. */
const PAGE_WIDTH = 390;
/** How much of its size the page is drawn at. */
export const THUMBNAIL_SCALE = 0.3;
/** The thumbnail box: the page's width times the scale; its height is the dock's inside height. */
const BOX_WIDTH = Math.round(PAGE_WIDTH * THUMBNAIL_SCALE);
/** The top of the page is all it can show: drawing more blocks than this would only cost time. */
const MAX_BLOCKS = 4;

/**
 * The dock's thumbnail (M6-01): the same `PageRenderer` as the preview, fed the same publish form,
 * laid out as a 390px phone page and drawn at 30% through a CSS transform, clipped to the box so it
 * shows the profile and the first blocks in the page's own theme.
 *
 * It is a picture of the draft, not a second page: `inert` and `aria-hidden` keep it out of the
 * accessibility tree and the tab order (the page keeps its one <h1>, no landmark, no tab stop), no
 * pointer event reaches it (a tap lands on the dock button around it) and the renderer's thumbnail
 * mode draws embeds as still posters. It carries no analytics: nothing here imports a beacon.
 */
export function MiniPreview({
  doc,
  pageId,
  hidden = false,
}: {
  doc: PublishDoc;
  pageId: string;
  /** Not shown (the dock is a strip while a field has focus), but still drawn from the draft. */
  hidden?: boolean;
}) {
  const top = useMemo(
    () => ({
      ...doc,
      blocks: doc.blocks.filter((block) => block.visible !== false).slice(0, MAX_BLOCKS),
    }),
    [doc],
  );
  return (
    <div
      data-testid="mini-preview"
      aria-hidden="true"
      hidden={hidden}
      inert
      style={{ width: BOX_WIDTH }}
      className="pointer-events-none relative h-full shrink-0 overflow-hidden border-l border-line select-none"
    >
      <div
        data-testid="mini-preview-page"
        data-page-frame=""
        style={{
          width: PAGE_WIDTH,
          height: `${100 / THUMBNAIL_SCALE}%`,
          transform: `scale(${THUMBNAIL_SCALE})`,
        }}
        className="absolute top-0 left-0 origin-top-left overflow-hidden"
      >
        <PageRenderer doc={top} pageId={pageId} mode="preview" thumbnail />
      </div>
    </div>
  );
}
