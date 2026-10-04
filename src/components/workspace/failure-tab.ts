import type { PublishError } from "@/lib/document";
import type { WorkspaceTab } from "./workspace-context";

/**
 * The tab a failed Publish brings you to (M7-05): the first error in the order profile, blocks,
 * share, page decides it. Profile and block errors are on the Edit tab, share-card errors on the
 * Share tab, and a page-level or theme error with no field stays where you are (null).
 */
export function failureTab(errors: readonly PublishError[]): WorkspaceTab | null {
  // The name's own font and size (M9-24) are set on the Design tab; every other profile field is on Edit.
  const designStyle = (field: string) => /^profile\.name(Font|Size)(\.|$)/.test(field);
  const profile = errors.some(
    (e) => e.blockId === null && e.field.startsWith("profile") && !designStyle(e.field),
  );
  const blocks = errors.some((e) => e.blockId !== null);
  // The support banner's card is on the Edit tab too (M9-23); its blocklist error names block "banner".
  const banner = errors.some((e) => e.blockId === null && e.field.startsWith("banner"));
  if (profile || blocks || banner) return "edit";
  // The share card, the page's UTM defaults (M9-28) and redirect mode (M9-32) are all on the Share tab.
  const share = errors.some(
    (e) =>
      e.blockId === null &&
      (e.field.startsWith("share") || e.field.startsWith("utm") || e.field.startsWith("redirect")),
  );
  if (share) return "share";
  return errors.some((e) => e.blockId === null && designStyle(e.field)) ? "design" : null;
}
