"use client";

import type { MouseEvent } from "react";
import { PreviewFonts } from "@/components/design/tenant-fonts";
import { resolvePreviewTap, type PreviewTap } from "@/components/editor/preview-taps";
import type { PreviewSite } from "@/components/site/use-site-pages";
import type { PublishDoc } from "@/lib/document";
import { PageRenderer, type PageChrome } from "@/lib/editor/contracts";

/**
 * The 310x660 phone bezel of the workspace's live preview (M2-06, M7-02): `PageRenderer` fed with a
 * publish form, in a screen that scrolls inside itself. The renderer is the same component the
 * public page uses (src/components/page), so what shows here is what Publish will show; the
 * parity test (tests/unit/renderer-parity.test.ts) draws it through this component and through the
 * tenant page and compares the markup.
 *
 * Inside the frame only tenant styling applies: no HYDLNK token reaches the renderer. The frame
 * stops clicks on links so a tap on a link or social icon never leaves the workspace (the renderer
 * leaves the hrefs alone so the markup stays identical everywhere).
 *
 * Tap to edit (M6-03), when `tappable`: a click (or Enter on a link) on a block, a social icon, a
 * grid cell or the avatar, name or bio goes to `onTap` and nothing else sees it; iframes get no
 * pointer events, so a tap on a Spotify player is a tap on its block. The one exception is a
 * facade's Play button (M6-27): it mounts its player here, as it does on the live page, and does
 * not open the block. Taps that mean nothing do nothing.
 */
export function PreviewBezel({
  doc,
  pageId,
  chrome,
  tappable = false,
  onTap,
  view,
  onNavigate,
}: {
  doc: PublishDoc;
  pageId: string;
  /** The footer links, from `pageChrome(plan, pageId)`: the same decision the live page makes (M2-28, M2-29). */
  chrome: PageChrome;
  tappable?: boolean;
  onTap?: (tap: PreviewTap) => void;
  /** The rest of the site (M11-08): the menu and page links, and the sub-page being drawn instead of Home. */
  view?: PreviewSite | undefined;
  /** A click on a menu entry or the sub-page header's link: the editor opens that page ("/" is Home). */
  onNavigate?: ((href: string) => void) | undefined;
}) {
  function onClickCapture(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target as Element;
    if (target.closest("a")) event.preventDefault();
    const nav = target.closest("a.pg-menu-item, a.pg-sitehead-link");
    if (nav && onNavigate) {
      event.stopPropagation();
      onNavigate(nav.getAttribute("href") ?? "/");
      return;
    }
    if (!tappable || !onTap) return;
    // A facade's Play button plays here, like on the live page (M6-27): it is not an edit tap.
    if (target.closest("button.pg-embed-play")) return;
    const tap = resolvePreviewTap(target, event.currentTarget);
    if (!tap) return;
    // Nothing inside the page reacts to a tap that opens the editor (the YouTube Play button), except
    // a FAQ question: its native open and close (M9-16) still happens, next to opening the block.
    if (!target.closest("summary")) event.preventDefault();
    event.stopPropagation();
    onTap(tap);
  }

  return (
    <div
      data-testid="preview-bezel"
      className="box-border h-[660px] w-[310px] rounded-[38px] border border-line-3 bg-ink p-[9px]"
    >
      <div
        data-testid="preview-screen"
        data-page-frame=""
        onClickCapture={onClickCapture}
        className={`h-full overflow-x-hidden overflow-y-auto rounded-[30px] ${
          tappable
            ? "[&_[data-block-id]]:cursor-pointer [&_[data-item-id]]:cursor-pointer [&_[data-profile-part]]:cursor-pointer [&_iframe]:pointer-events-none"
            : ""
        }`}
      >
        <PreviewFonts tokens={doc.tokens} nameFont={doc.profile.nameFont} />
        <PageRenderer
          doc={doc}
          pageId={pageId}
          mode="preview"
          chrome={chrome}
          {...(view?.site ? { site: view.site } : {})}
          {...(view?.subPage ? { subPage: view.subPage } : {})}
        />
      </div>
    </div>
  );
}
