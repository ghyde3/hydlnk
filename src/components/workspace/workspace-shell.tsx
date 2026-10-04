"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { PublishedToast } from "@/components/editor/published-toast";
import { UndoToast } from "@/components/editor/undo-toast";
import { TemplateToast } from "@/components/templates";
import { WORKSPACE_PANEL_ID, useWorkspace, workspaceTabId } from "./workspace-context";
import { WorkspaceNotices } from "./workspace-notices";
import { WorkspacePreview } from "./workspace-preview";
import { WorkspaceToolbarSlot } from "./workspace-toolbar-slot";
import { WorkspaceMiniPhoneSlot } from "./workspace-mini-phone-slot";

const subscribeNothing = () => () => {};

/**
 * False on the server and while the page hydrates, true from the first render after it: the
 * viewport is not known before that, so the preview (the bezel at 760px and up, the mini phone
 * below) is drawn only once it is, and never the wrong one for a frame.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/**
 * The workspace's frame (M7-02), rendered once by the `(workspace)` layout around whichever tab is
 * open. A soft navigation between tabs swaps only `children` (the tab panel's content): the pinned
 * toolbar, the notices, the preview bezel and the toasts are the same nodes, so a typed-but-unsaved
 * field, the bezel's scroll position and the focus in the toolbar all survive a tab switch.
 *
 *   toolbar          pinned (sticky) by the toolbar itself (M7-05); it publishes the height of
 *                    everything it pins as `--hl-toolbar-h`, which pins the preview column just
 *                    under it (`PREVIEW_PIN_TOP`) and sets the page's scroll padding
 *   notices          the one place every banner shows (M7-02 step 7)
 *   tab panel        the single `role="tabpanel"`, max 720px, labelled by the selected tab
 *   preview column   760px and up, 330px, pinned; below 760px the mini phone (M7-09) instead
 *   toasts           block deleted, template applied, published: they belong to the workspace, so
 *                    they stay when the person switches tabs
 */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { state, dispatch, undoRedo, isDesktop, activeTab, publishedToken, liveUrl } =
    useWorkspace();
  const hydrated = useHydrated();

  return (
    <div data-testid="workspace" className="flex flex-1 flex-col">
      <WorkspaceToolbarSlot />

      <WorkspaceNotices />

      <div className="flex flex-1 flex-col gap-8 px-4 py-3 hl:flex-row hl:items-start hl:gap-8 hl:px-8 hl:py-6">
        <section
          // Below 760px the last row must scroll fully above the tab bar and the mini phone
          // (MINI_PHONE_CONTENT_CLEARANCE, 185px). The app's <main> already pads 84px for the
          // tab bar, so this panel adds the other 101px (pinned by tests/unit/m7-workspace-static).
          id={WORKSPACE_PANEL_ID}
          role="tabpanel"
          aria-labelledby={workspaceTabId(activeTab)}
          className="flex min-w-0 max-w-[720px] flex-col gap-3 pb-[101px] hl:flex-1 hl:pb-0"
        >
          {children}
        </section>
        {hydrated && isDesktop ? <WorkspacePreview /> : null}
      </div>

      {hydrated && !isDesktop ? <WorkspaceMiniPhoneSlot /> : null}

      <UndoToast deleted={state.deleted} dispatch={dispatch} />
      <TemplateToast toast={state.templateToast} dispatch={dispatch} onUndo={undoRedo.undo} />
      <PublishedToast
        token={publishedToken}
        liveUrl={liveUrl}
        lifted={state.deleted !== null || state.templateToast !== null}
      />
    </div>
  );
}
