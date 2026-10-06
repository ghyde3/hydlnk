"use client";

import { InlineNotice } from "@/components/editor/inline-notice";
import { PublishAlert } from "@/components/editor/publish-alert";
import { SaveBanner } from "@/components/editor/save-banner";
import { UndoRedoNotice } from "@/components/editor/undo-redo-controls";
import { CORRUPTED_NOTICE } from "@/lib/editor/messages";
import { useWorkspace } from "./workspace-context";

/**
 * The one notices area of the workspace (M7-02): under the toolbar and above the tab's content, on
 * every tab, once each. The save banner (M2-04, M5-15), the undo notice (M6-07), the corrupted-draft
 * notice (M2-03), the publish note (M5-15) and the Publish alert (M2-24). A failing save shows the
 * same banner on Edit, Design and Share, never a second copy.
 */
export function WorkspaceNotices() {
  const {
    state,
    dispatch,
    autosave,
    undoRedo,
    repaired,
    publishNote,
    publish,
    publishing,
    activeTab,
  } = useWorkspace();
  return (
    <div
      data-testid="workspace-notices"
      className="flex flex-col gap-2 px-4 pt-3 empty:hidden hl:px-8"
    >
      <SaveBanner
        status={autosave.status}
        blockedHosts={autosave.blocked?.hosts}
        editorLink={activeTab !== "edit"}
      />
      <UndoRedoNotice controls={undoRedo} />
      {repaired ? (
        <p
          role="status"
          className="max-w-[720px] rounded-md border border-line-2 bg-surface px-4 py-3 text-sm text-ink-2"
        >
          {CORRUPTED_NOTICE}
        </p>
      ) : null}
      {publishNote ? (
        <InlineNotice
          kind="publish"
          action={
            publishNote.retry
              ? { label: "Retry", onClick: publish, disabled: publishing }
              : undefined
          }
        >
          {publishNote.message}
        </InlineNotice>
      ) : null}
      <div className="max-w-[720px] empty:hidden">
        <PublishAlert
          errors={state.publishErrors}
          blocks={state.draft.blocks}
          onDismiss={() => dispatch({ type: "publish/clear-errors" })}
        />
      </div>
    </div>
  );
}
