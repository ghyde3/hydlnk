"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { HOME_PAGE_ID } from "@/lib/site-pages/pages";
import { useWorkspace } from "../workspace-context";
import { PageRevisions } from "./page-revisions";
import { PublishBarView } from "./publish-bar-view";
import { publishRows, type PublishRow } from "./rows";

export const PUBLISH_BAR_ID = "publish-bar";

/**
 * The publish bar (M15-10): what the toolbar's status chip opens. It lists the design, Home and
 * each page with its own state and its own publish button, and Publish all changes; a page's
 * Revisions swaps the bar's content for that page's revision list.
 *
 * A non-modal dialog (`role="dialog"`, named "Publish"): from 760px a 380px panel under the toolbar,
 * right aligned; below 760px a full-width sheet above the bottom tab bar, with its own vertical
 * scroll and the safe-area inset. Escape and a press outside close it and focus returns to the
 * toggle. It is mounted only while open, so no button named "Publish …" exists while it is closed.
 *
 * A publish that is refused closes the bar: what failed is shown where it is fixed (the field, or
 * the publish note under the toolbar). One that goes through leaves it open, with the row now Live.
 */
export function PublishBar({
  toggleRef,
  onClose,
}: {
  toggleRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const { site, publishState, publishingItem, pageId } = workspace;
  const panelRef = useRef<HTMLDivElement>(null);
  const [revisionsOf, setRevisionsOf] = useState<PublishRow | null>(null);

  // Focus moves into the bar when it opens.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape and a press outside close it. A publish in flight keeps it open: its row is busy.
  const busy = publishingItem !== null;
  useEffect(() => {
    const close = () => {
      onClose();
      toggleRef.current?.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || busy) return;
      if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [busy, onClose, toggleRef]);

  const rows = publishRows({
    items: site.items,
    design: publishState.design,
    home: publishState.home,
    pages: publishState.pages,
  });
  const run = (action: Promise<boolean>) =>
    void action.then((ok) => {
      if (!ok) onClose();
    });
  const revisionsEntry =
    revisionsOf === null
      ? null
      : revisionsOf.key === HOME_PAGE_ID
        ? workspace.homeEntryId
        : revisionsOf.key;

  return (
    <div
      ref={panelRef}
      id={PUBLISH_BAR_ID}
      role="dialog"
      aria-label="Publish"
      data-testid="publish-bar"
      tabIndex={-1}
      className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-40 flex max-h-[min(70dvh,calc(100dvh-180px))] flex-col border-t border-line bg-surface text-ink outline-none hl:absolute hl:inset-x-auto hl:top-full hl:right-8 hl:bottom-auto hl:mt-1.5 hl:max-h-[calc(100dvh-160px)] hl:w-[380px] hl:rounded-md hl:border"
    >
      {revisionsOf !== null && revisionsEntry !== null ? (
        <PageRevisions
          siteId={pageId}
          entryId={revisionsEntry}
          title={revisionsOf.title}
          onBack={() => setRevisionsOf(null)}
          onRestore={(rev) => workspace.restoreRevision(revisionsOf.key, rev)}
        />
      ) : (
        <PublishBarView
          rows={rows}
          siteLive={workspace.hasPublished}
          publishingItem={publishingItem}
          disabledReason={workspace.publishDisabledReason}
          onPublishDesign={() => run(workspace.publishDesignOnly())}
          onPublishPage={(key) => run(workspace.publishPageById(key))}
          onPublishAll={() => run(workspace.publishAll())}
          onRevisions={setRevisionsOf}
        />
      )}
    </div>
  );
}
