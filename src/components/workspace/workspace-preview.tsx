"use client";

import { ThemePreviewHeader } from "@/components/themes";
import { PreviewBezel } from "./preview-bezel";
import { PREVIEW_PIN_TOP } from "./toolbar/pinned-height";
import { useWorkspace } from "./workspace-context";

/**
 * The workspace's one live preview column (M7-02): the bezel (`PreviewBezel`) fed with the draft's
 * publish form, or the page in the theme being previewed (M6-44), in a 330px column pinned under
 * the toolbar. It is rendered once by the shell, at 760px and up only (a phone gets the mini phone
 * and its full-size sheet, M7-09, and there is NO second page root in the DOM), so a tab switch never
 * remounts it and its screen keeps its scroll position.
 *
 * The bezel is the first thing in the pinned column, so its top is exactly `PREVIEW_PIN_TOP` (the
 * toolbar's bottom plus 16px, M7-05 step 8); the "Live preview" caption sits under it, and only a
 * theme preview (M6-44) puts its header (Apply / Stop previewing) above it, in the column's flow.
 *
 * Tap to edit (M6-03) works on the Edit tab. On Design and Share a click does nothing (it never
 * navigates), and during a theme preview it does nothing either.
 */
export function WorkspacePreview() {
  const { shownForm, pageId, chrome, preview, activeTab, onPreviewTap, draft } = useWorkspace();
  const themePreview = preview.view;
  return (
    <section
      aria-label={themePreview ? `Previewing ${themePreview.name}` : "Live preview"}
      data-testid="workspace-preview"
      style={{ top: PREVIEW_PIN_TOP }}
      className="sticky flex w-[330px] shrink-0 flex-col items-center gap-2.5 self-start"
    >
      <p role="status" aria-live="polite" className="sr-only" data-testid="theme-preview-status">
        {themePreview?.status ?? ""}
      </p>
      {themePreview ? <ThemePreviewHeader preview={themePreview} /> : null}
      <PreviewBezel
        doc={shownForm}
        pageId={pageId}
        chrome={chrome}
        tappable={activeTab === "edit" && themePreview === null}
        onTap={onPreviewTap}
      />
      {themePreview ? null : (
        <div className="flex w-full items-center justify-between">
          <span className="font-mono text-[13px] font-semibold tracking-[0.06em] text-text-2 uppercase">
            Live preview
          </span>
          <span className="text-xs text-text-2">
            {activeTab === "design" ? "A block’s own style still wins" : "Your page's own theme"}
          </span>
        </div>
      )}
      {draft.redirect && themePreview === null ? (
        // M9-32: the preview still draws the page (redirect mode is the live page's behavior only).
        <p
          data-testid="redirect-caption"
          className="m-0 w-full rounded-md border border-line bg-surface px-3 py-2 text-xs text-text-2"
        >
          Redirect mode is on. Visitors skip this page.
        </p>
      ) : null}
    </section>
  );
}
