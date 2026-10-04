import type { PublishError } from "@/lib/document";
import type { WorkspaceTab } from "./workspace-context";

/**
 * The tab a failed Publish brings you to (M7-05): the first error in the order profile, blocks,
 * share, page decides it. Profile and block errors are on the Edit tab, share-card errors on the
 * Share tab, and a page-level or theme error with no field stays where you are (null).
 */
export function failureTab(errors: readonly PublishError[]): WorkspaceTab | null {
  const profile = errors.some((e) => e.blockId === null && e.field.startsWith("profile"));
  const blocks = errors.some((e) => e.blockId !== null);
  if (profile || blocks) return "edit";
  const share = errors.some((e) => e.blockId === null && e.field.startsWith("share"));
  return share ? "share" : null;
}
