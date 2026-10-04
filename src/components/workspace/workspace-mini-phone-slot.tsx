"use client";

import { ConnectedMiniPhone } from "./mini-preview/connected-mini-phone";

/**
 * Where the shell mounts the mini phone (M7-09) below 760px: the real one, wired to
 * `useWorkspace()` (see ./README.md).
 */
export function WorkspaceMiniPhoneSlot() {
  return <ConnectedMiniPhone />;
}
