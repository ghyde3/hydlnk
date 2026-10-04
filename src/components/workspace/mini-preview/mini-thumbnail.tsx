"use client";

import { useMemo } from "react";
import type { PublishDoc } from "@/lib/document";
import { PageRenderer } from "@/lib/editor/contracts";
import {
  MINI_PHONE_HEIGHT,
  MINI_PHONE_WIDTH,
  THUMBNAIL_PAGE_WIDTH as PAGE_WIDTH,
  THUMBNAIL_SCALE,
} from "./measures";

/** The thumbnail box inside the button's 1px border. */
const BOX_WIDTH = MINI_PHONE_WIDTH - 2;
const BOX_HEIGHT = MINI_PHONE_HEIGHT - 2;
export { THUMBNAIL_SCALE };
/** The top of the page is all it can show: drawing more blocks than this would only cost time. */
const MAX_BLOCKS = 8;

/**
 * The mini phone's thumbnail (M7-09): the same `PageRenderer` as the preview, fed the same publish
 * form, laid out as a 390px phone page and drawn at about 12% through a CSS transform, clipped to
 * the box so it shows the profile and the first visible blocks in the page's own theme.
 *
 * It is a picture of the draft, not a second page: `inert` and `aria-hidden` keep it out of the
 * accessibility tree and the tab order (the page keeps its one <h1>, no landmark, no tab stop), no
 * pointer event reaches it (a tap lands on the button around it) and the renderer's thumbnail mode
 * draws embeds as still posters. It carries no analytics: nothing here imports a beacon.
 */
export function MiniThumbnail({
  doc,
  pageId,
  hidden = false,
}: {
  doc: PublishDoc;
  pageId: string;
  /** Not shown (the mini phone is round while a field has focus), but still drawn from the draft. */
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
      style={{ width: BOX_WIDTH, height: BOX_HEIGHT }}
      className="pointer-events-none relative shrink-0 overflow-hidden rounded-[7px] select-none"
    >
      <div
        data-testid="mini-preview-page"
        data-page-frame=""
        style={{
          width: PAGE_WIDTH,
          height: Math.round(BOX_HEIGHT / THUMBNAIL_SCALE),
          transform: `scale(${THUMBNAIL_SCALE})`,
        }}
        className="absolute top-0 left-0 origin-top-left overflow-hidden"
      >
        <PageRenderer doc={top} pageId={pageId} mode="preview" thumbnail />
      </div>
    </div>
  );
}
