"use client";

import { ConnectedWorkspaceToolbar } from "./toolbar/connected-toolbar";

/**
 * Where the shell mounts the pinned toolbar (M7-05): the real toolbar, wired to `useWorkspace()`.
 */
export function WorkspaceToolbarSlot() {
  return <ConnectedWorkspaceToolbar />;
}
