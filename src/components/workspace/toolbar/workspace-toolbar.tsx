"use client";

import type { ReactNode } from "react";
import { PageName } from "@/components/editor/page-name";
import { StatusChip } from "@/components/editor/status-chip";
import { UndoRedoButtons } from "@/components/editor/undo-redo-controls";
import type { UndoRedo } from "@/components/editor/use-undo-redo";
import type { SaveStatus } from "@/lib/editor/autosave";
import type { PublishStatus } from "@/lib/editor/status";
import { MoreMenu } from "./more-menu";
import { PIN_ATTRIBUTE, usePinnedHeight } from "./pinned-height";
import { PreviewMenu } from "./preview-menu";
import { SaveIndicator } from "./save-status";

/**
 * What the toolbar needs. It owns no draft, history or save queue: the workspace's provider (M7-02)
 * does, and hands what the toolbar shows and calls.
 */
export interface WorkspaceToolbarProps {
  pageId: string;
  /** `{handle}.hydlnk.com`: the mono address line above the page's name. */
  address: string;
  /** `pages.name` (M6-13): the h1, with its "Rename site" pencil. */
  name: string;
  /**
   * The 'Workspace' tablist (M7-02): Edit, Design and Share. The toolbar places it, once: in the
   * row between the page's name and the status chip at 760px and up, in a 48px strip directly
   * under the pinned row (and pinned with it) below 760px. It should fill the strip on a phone
   * (`w-full`, no more than 2px of padding) and size itself on a desktop (`hl:w-auto`).
   */
  tabs: ReactNode;
  /** The publish state, computed from the draft's publish form against `pages.published` (M2-27). */
  status: PublishStatus;
  /** The one autosave queue's state: "Saving...", "Saved" or "Not saved". */
  saveStatus: SaveStatus;
  /** Undo and Redo (M6-07), the same engine on all three tabs. */
  undoRedo: UndoRedo;
  /** Writes pending edits and resolves true once they are stored (the autosave queue's flush). */
  flush: () => Promise<boolean>;
  /** The live page's address, or null while the page has never been published ("View live page" is off). */
  liveUrl: string | null;
  /** A Publish is running: the button reads "Publishing..." and is `aria-busy`. */
  publishing: boolean;
  /**
   * Why Publish is off, or null: a suspended owner (M5-09) or a link to a blocked site (M5-03). It
   * is the button's title.
   */
  publishDisabledReason?: string | null;
  /** Goes to a card of the Share tab and focuses its first control (`/share#preview-links`, `/share#qr`). */
  onOpenShare: (target: "preview-links" | "qr") => void;
  /**
   * Publish, from any tab. The workspace's own handler: it flushes, freezes what is stored and, when
   * the gate refuses, takes the person to the tab that holds the first error (M7-05).
   */
  onPublish: () => void;
}

/**
 * The test ids. `workspace-toolbar` is the bar the workspace keeps in place across tabs: a 56px
 * sticky box from 760px up, where it holds everything (the name, the tabs, the controls); below
 * 760px it is `display: contents` and what is pinned is its `workspace-toolbar-row` (52px) and the
 * `workspace-tabs-pin` strip (48px) under it. The same elements, the same DOM, at every width.
 */
export const TOOLBAR_TEST_ID = "workspace-toolbar";
export const TOOLBAR_ROW_TEST_ID = "workspace-toolbar-row";
export const TOOLBAR_TABS_TEST_ID = "workspace-tabs-pin";

function PublishButton({
  publishing,
  disabledReason,
  onPublish,
  className,
}: {
  publishing: boolean;
  disabledReason: string | null;
  onPublish: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onPublish}
      disabled={publishing || disabledReason !== null}
      aria-busy={publishing}
      title={disabledReason ?? undefined}
      className={`min-h-11 shrink-0 cursor-pointer rounded-md bg-ink px-4 text-sm font-semibold whitespace-nowrap text-surface disabled:cursor-progress disabled:opacity-70 ${className}`}
    >
      {publishing ? "Publishing..." : "Publish"}
    </button>
  );
}

/**
 * The page's name block: the mono address over the h1 and its pencil. On a phone it is the first
 * line of the content under the pinned tabs and scrolls away. From 760px up it is in the bar: one
 * line (the h1 is cut with an ellipsis) and the rename form (M6-14) opens as an overlay on the
 * whole bar, where one 56px row has no room for a 300px field and two buttons beside the tabs;
 * Escape and Cancel close it as before.
 */
function NameBlock({ pageId, address, name }: { pageId: string; address: string; name: string }) {
  return (
    <div
      data-toolbar-name=""
      className="order-[-1] min-w-0 px-4 pt-3 hl:order-none hl:flex-1 hl:p-0 min-[1280px]:max-w-[260px] min-[1280px]:flex-none hl:[&_form]:absolute hl:[&_form]:inset-x-0 hl:[&_form]:top-0 hl:[&_form]:z-10 hl:[&_form]:mt-0 hl:[&_form]:min-h-14 hl:[&_form]:flex-row hl:[&_form]:items-center hl:[&_form]:gap-2 hl:[&_form]:border-b hl:[&_form]:border-line hl:[&_form]:bg-surface hl:[&_form]:px-8 hl:[&_form>div:first-child]:relative hl:[&_form_[role=alert]]:absolute hl:[&_form_[role=alert]]:top-full hl:[&_form_[role=alert]]:left-0 hl:[&_form_[role=alert]]:mt-1 hl:[&_form_[role=alert]]:rounded-sm hl:[&_form_[role=alert]]:bg-surface hl:[&_form_[role=alert]]:px-1 hl:[&_h1]:truncate hl:[&_h1]:[overflow-wrap:normal]"
    >
      <p className="truncate font-mono text-xs leading-[14px] text-text-2">{address}</p>
      <PageName pageId={pageId} name={name} />
    </div>
  );
}

/**
 * The workspace's pinned action toolbar (M7-05), the same bar on Edit, Design and Share. One DOM at
 * every width; CSS lays it out.
 *
 * 1280px and up: one 56px row, white with a 1px bottom border, `position: sticky; top: 0`: the
 * page's name (the h1, with the mono address above it and the rename pencil after it), the
 * 'Workspace' tabs, the status chip, the save indicator, Undo and Redo, the "Preview" menu, the
 * "⋯" menu and Publish, the only charcoal control. From 760px to 1279px the same controls wrap into
 * two rows (the name and the tabs, then the rest) as one pinned block. Below 760px it is a 52px
 * pinned row of Undo, Redo, the status chip and Publish, with the tabs in a 48px strip pinned under
 * it; the page's name is the first line of the content and scrolls away, the save indicator is a
 * small chip above the bottom tab bar, and QR code, history and preview links live in the Share
 * tab (the two menus are not drawn).
 *
 * Mount it as a direct child of a tall flex column (the workspace root): below 760px the bar is
 * `display: contents`, so its row, its tab strip and the name block become that column's own
 * items (`order` puts them first), and `position: sticky` pins them against the whole screen.
 *
 * The preview column pins under whatever is pinned here: `--hl-toolbar-h` (see pinned-height.ts) is
 * kept equal to its measured height. Nothing in the toolbar changes the draft or adds an undo step
 * except the buttons that are about doing so (Undo, Redo, Publish).
 */
export function WorkspaceToolbar(props: WorkspaceToolbarProps) {
  const { pageId, address, name, tabs, status, saveStatus, undoRedo, flush, liveUrl } = props;
  const { publishing, publishDisabledReason = null, onPublish, onOpenShare } = props;
  usePinnedHeight();

  return (
    <div
      data-testid={TOOLBAR_TEST_ID}
      {...{ [PIN_ATTRIBUTE]: "" }}
      className="contents hl:sticky hl:top-0 hl:z-20 hl:box-border hl:flex hl:flex-col hl:border-b hl:border-line hl:bg-surface hl:px-8 min-[1280px]:h-14 min-[1280px]:flex-row min-[1280px]:items-center min-[1280px]:gap-4"
    >
      <div className="contents hl:flex hl:min-h-12 hl:min-w-0 hl:items-center hl:gap-4 min-[1280px]:min-h-0 min-[1280px]:flex-1">
        <NameBlock pageId={pageId} address={address} name={name} />
        <div
          data-testid={TOOLBAR_TABS_TEST_ID}
          {...{ [PIN_ATTRIBUTE]: "" }}
          className="sticky top-[52px] z-20 order-[-2] box-border flex h-12 items-stretch border-b border-line bg-surface px-4 hl:contents"
        >
          {tabs}
        </div>
      </div>
      <div
        data-testid={TOOLBAR_ROW_TEST_ID}
        {...{ [PIN_ATTRIBUTE]: "" }}
        className="sticky top-0 z-20 order-[-3] box-border flex h-[52px] items-center gap-2 border-b border-line bg-surface px-4 hl:static hl:z-auto hl:order-none hl:h-auto hl:min-h-12 hl:flex-wrap hl:gap-x-3 hl:gap-y-1 hl:border-b-0 hl:bg-transparent hl:p-0 min-[1280px]:min-h-0 min-[1280px]:flex-nowrap"
      >
        <div className="order-2 flex min-w-0 flex-1 hl:order-none hl:flex-none">
          <StatusChip status={status} />
        </div>
        <SaveIndicator status={saveStatus} />
        <div className="order-1 flex shrink-0 items-center gap-2 hl:order-none hl:ml-auto min-[1280px]:ml-0">
          <UndoRedoButtons controls={undoRedo} />
          <div className="hidden hl:block">
            <PreviewMenu
              pageId={pageId}
              flush={flush}
              liveUrl={liveUrl}
              onOpenShare={onOpenShare}
            />
          </div>
          <div className="hidden hl:block">
            <MoreMenu flush={flush} onOpenShare={onOpenShare} />
          </div>
        </div>
        <PublishButton
          publishing={publishing}
          disabledReason={publishDisabledReason}
          onPublish={onPublish}
          className="order-3 min-w-[84px] hl:order-none hl:min-w-0"
        />
      </div>
    </div>
  );
}
