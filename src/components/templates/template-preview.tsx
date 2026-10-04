"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PageRenderer } from "@/components/page/page-renderer";
import type { DraftDoc } from "@/lib/document";
import { templatePreviewDoc, type Template } from "@/lib/templates";
import type { TokenSet } from "@/lib/theme";

/** The width the page is laid out at inside the card: a phone screen. */
export const PREVIEW_PAGE_WIDTH = 390;
/**
 * The card's picture is this tall whatever the page holds (M9-33, Gary's decision closing the held
 * M7-07: it was 190). The window starts at the very top of the page, so the person's photo and
 * display name show, and a phone page spends about 250px of its 390px width on them: 300px leaves the
 * first block of the template visible below them (at least 24px of it, at both viewports).
 */
export const PREVIEW_HEIGHT = 300;
/** Cards a little way below the fold are drawn before they are scrolled to. */
const PRELOAD_MARGIN = "240px";

/**
 * A template's card picture (M7-07, M9-33): the real `PageRenderer` fed what applying the template
 * would give (`templatePreviewDoc`: the person's own profile, the template's blocks, its own theme),
 * laid out as a 390px phone page and scaled by a CSS transform to the card's width, clipped to a
 * 300px window that starts at the top of the page.
 *
 * It is a picture, not a page: `inert` and `aria-hidden` take it out of the tab order and the
 * accessibility tree (the dialog keeps no extra heading, landmark or tab stop), the renderer's
 * `thumbnail` mode draws every link as a plain box and every embed as a placeholder (nothing is
 * requested from a third party), and no pointer event reaches it. It sends no beacon and reads no
 * database: its only input is data the dialog already holds.
 *
 * Lazy: the page is drawn only once its box has come within reach of the viewport (six cards of
 * five to eight blocks are not all drawn for a person who looks at the first two), and then it
 * stays drawn. Until then the box is already its final size, so the cards do not move.
 */
export function TemplatePreview({
  template,
  profile,
  themeTokens,
}: {
  template: Template;
  /** The page's own profile: name, photo, photo options and the bio the person wrote. */
  profile: DraftDoc["profile"];
  /** The token set of the template's theme, or null (it failed to load: the default colors). */
  themeTokens: Partial<TokenSet> | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  // No observer (an old browser, a unit test): draw at once.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  // The box's width gives the scale; 0 until the dialog is shown.
  const [width, setWidth] = useState(0);
  const scale = width > 0 ? width / PREVIEW_PAGE_WIDTH : 0.77;

  // Memoized so the fresh block ids are made once: a re-render of the card (a radio was picked) must
  // not remount every block.
  const doc = useMemo(
    () => templatePreviewDoc(profile, template, themeTokens),
    [profile, template, themeTokens],
  );

  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    // 0 while the dialog is not shown yet: the page waits for a width.
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      data-testid="template-preview"
      data-preview-template={template.id}
      aria-hidden="true"
      inert
      style={{ height: PREVIEW_HEIGHT }}
      className="pointer-events-none relative w-full shrink-0 overflow-hidden rounded-sm border border-line-2 bg-track select-none"
    >
      {near ? (
        <div
          data-testid="template-preview-page"
          data-page-frame=""
          style={{
            width: PREVIEW_PAGE_WIDTH,
            height: PREVIEW_HEIGHT / scale,
            transform: `scale(${scale})`,
          }}
          className="absolute top-0 left-0 origin-top-left overflow-hidden"
        >
          <PageRenderer doc={doc} pageId="template-preview" mode="preview" thumbnail />
        </div>
      ) : null}
    </div>
  );
}
