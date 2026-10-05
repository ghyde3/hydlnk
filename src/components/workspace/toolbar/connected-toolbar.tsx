"use client";

import { useWorkspace } from "../workspace-context";
import { WorkspaceTabs } from "../workspace-tabs";
import { WorkspaceToolbar } from "./workspace-toolbar";

/**
 * The pinned toolbar wired to the workspace (M7-05): everything it shows and calls comes from
 * `useWorkspace()`. The shell mounts this once, through `workspace-toolbar-slot.tsx`.
 */
export function ConnectedWorkspaceToolbar() {
  const workspace = useWorkspace();
  const { pageId, address, name, activeTab, status, undoRedo, autosave, site } = workspace;
  // Sub-pages save through their own queue (M11-08): while Home is settled, an unsaved page shows.
  const homeSettled = autosave.status === "idle" || autosave.status === "saved";
  const saveStatus =
    homeSettled && site.saveStatus !== "idle" && site.saveStatus !== "saved"
      ? site.saveStatus === "missing"
        ? "conflict"
        : site.saveStatus
      : autosave.status;
  return (
    <WorkspaceToolbar
      pageId={pageId}
      address={address}
      name={name}
      tabs={<WorkspaceTabs active={activeTab} className="w-full p-0.5! hl:w-auto hl:p-[3px]!" />}
      status={status}
      saveStatus={saveStatus}
      undoRedo={undoRedo}
      flush={autosave.flush}
      liveUrl={workspace.hasPublished ? workspace.liveUrl : null}
      publishing={workspace.publishing}
      publishDisabledReason={workspace.publishDisabledReason}
      onPublish={workspace.publish}
      onOpenShare={workspace.openShare}
    />
  );
}
