import type { CSSProperties, ReactNode } from "react";
import type { PublishDoc } from "@/lib/document";
import { tokensToCssVars } from "@/lib/theme";
import { backgroundImageUrl } from "./background";
import { BlockView, type BlockContext } from "./blocks";
import { PageFooter, type PageChrome } from "./footer";
import { Profile } from "./profile";
import "./page-renderer.css";

export type { PageChrome } from "./footer";

export interface PageRendererProps {
  /** The page to draw: the stored published form, or `toPublishForm(draft, themeTokens)` in the editor. */
  doc: PublishDoc;
  pageId: string;
  /**
   * Where the page is mounted. The markup of a complete page is identical in both modes (that is
   * what makes the editor preview trustworthy); see `BlockContext.mode` for the one difference.
   */
  mode: "live" | "preview";
  /** The footer links (badge, report). Omit for no footer. */
  chrome?: PageChrome;
  /** Extra footer content for callers that need more than the two standard links. */
  footer?: ReactNode;
  /** A small decorative copy (the editor's phone dock): nothing interactive, nothing third-party. See `BlockContext.thumbnail`. */
  thumbnail?: boolean;
}

/**
 * The one component that outputs a tenant page: profile, blocks and footer. The public page and
 * the editor's live preview both render through it, so what you preview is what you publish.
 *
 * The root `[data-page-root]` carries the resolved tenant tokens as `--t-*` CSS variables and is
 * a size container: everything inside sizes itself from the root's own width (container queries),
 * so the same markup fits the 310px editor bezel, a phone and a desktop. Styling lives in
 * page-renderer.css and reads `--t-*` variables only.
 *
 * Clicks are not handled here: the editor preview wraps the renderer and stops anchors from
 * navigating, so the markup (and the hrefs) stay identical everywhere.
 */
export function PageRenderer({ doc, pageId, mode, chrome, footer, thumbnail }: PageRendererProps) {
  const { tokens } = doc;
  const ctx: BlockContext = thumbnail
    ? { pageId, tokens, mode, thumbnail }
    : { pageId, tokens, mode };
  // The background image is drawn only from the owner's page-media bucket: the URL is rebuilt from
  // a validated path, and anything else (a third-party address, a bad row) draws no image.
  const image = backgroundImageUrl(tokens);
  const vars: Record<string, string> = tokensToCssVars(tokens);
  vars["--t-bg-image"] = image === null ? "none" : `url("${image}")`;
  const backgroundType =
    image !== null ? "image" : tokens.bgType === "gradient" ? "gradient" : "solid";
  return (
    <div
      className="pg-root"
      data-page-root=""
      data-density={tokens.density}
      data-align={tokens.align}
      data-bg-type={backgroundType}
      style={vars as CSSProperties}
    >
      {image === null ? null : (
        // Behind the content, inside the root so it fills the whole page: the picture (blurred on
        // its own, so text and buttons never are) with the page color laid over it at the overlay
        // opacity. Decorative, so hidden from assistive technology.
        <div className="pg-bg" aria-hidden="true">
          <div className="pg-bg-image" data-bg-layer="image" />
          <div className="pg-bg-overlay" data-bg-layer="overlay" />
        </div>
      )}
      <div className="pg-column">
        <Profile profile={doc.profile} />
        <main className="pg-blocks">
          {doc.blocks.map((block) => (
            <BlockView key={block.id} block={block} ctx={ctx} />
          ))}
        </main>
        {chrome ? <PageFooter chrome={chrome} /> : null}
        {footer}
      </div>
    </div>
  );
}
