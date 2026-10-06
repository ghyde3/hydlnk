import {
  UTM_KEYS,
  UTM_VALUE_MAX,
  hasCustomUtm,
  redirectOptions,
  singleLine,
  truncateToCodePoints,
  type DraftDoc,
  type LinkBlock,
  type LinkUtm,
  type PageUtm,
  type UtmKey,
} from "@/lib/document";

/**
 * Pure draft edits and readings of Wave K's link fields (M9-28, M9-30, M9-32): the page's UTM
 * defaults, a link's own tags, and redirect mode. The Share tab's cards and the link form call these
 * through the workspace's `editDraft` / the form's `onChange`, so every edit is one undo step (typing
 * in one field coalesces) and an emptied field removes its key, never leaves `""` behind.
 *
 * Client-safe and free of React: the unit tests drive them directly.
 */

/** What a UTM input stores: one line, at most 40 code points (a longer paste is shortened). */
export function clampUtmValue(value: string): string {
  return truncateToCodePoints(singleLine(value), UTM_VALUE_MAX);
}

const isBlank = (value: string): boolean => value.trim() === "";

// The page's defaults ----------------------------------------------------------------------------

/** The draft with one page default set; a blank value removes the key, and no key left removes `utm`. */
export function withPageUtmValue(draft: DraftDoc, key: UtmKey, raw: string): DraftDoc {
  const value = clampUtmValue(raw);
  const current: PageUtm = draft.utm ?? {};
  const next: PageUtm = { ...current };
  if (isBlank(value)) delete next[key];
  else next[key] = value;
  if (UTM_KEYS.every((name) => next[name] === undefined)) return withoutPageUtm(draft);
  if (current[key] === next[key]) return draft;
  return { ...draft, utm: next };
}

/** The draft with no page defaults ('Clear all'). The same draft when there are none. */
export function withoutPageUtm(draft: DraftDoc): DraftDoc {
  if (draft.utm === undefined) return draft;
  const rest: DraftDoc = { ...draft };
  delete rest.utm;
  return rest;
}

/** True when no default has a value (what disables 'Clear all'). */
export function isPageUtmEmpty(utm: PageUtm | undefined): boolean {
  return !utm || UTM_KEYS.every((key) => isBlank(utm[key] ?? ""));
}

// A link's own tags -----------------------------------------------------------------------------

export type LinkTagsMode = "defaults" | "custom" | "none";

/** Which segment a link's `utm` shows: absent is the page defaults, `off` is none, anything else custom. */
export function linkTagsMode(utm: LinkUtm | undefined): LinkTagsMode {
  if (utm === undefined) return "defaults";
  return utm.off === true ? "none" : "custom";
}

/** The link with its tags set to a mode: defaults removes the key, none is `{off: true}`, custom starts empty. */
export function withLinkTagsMode(block: LinkBlock, mode: LinkTagsMode): LinkBlock {
  if (linkTagsMode(block.utm) === mode) return block;
  if (mode === "defaults") {
    const rest: LinkBlock = { ...block };
    delete rest.utm;
    return rest;
  }
  return { ...block, utm: mode === "none" ? { off: true } : {} };
}

/** The link with one of its own tag values set (custom mode); a blank value removes the key. */
export function withLinkUtmValue(block: LinkBlock, key: UtmKey, raw: string): LinkBlock {
  const value = clampUtmValue(raw);
  const next: LinkUtm = { ...(block.utm ?? {}) };
  delete next.off;
  if (isBlank(value)) delete next[key];
  else next[key] = value;
  return { ...block, utm: next };
}

export { hasCustomUtm };

// Redirect mode ---------------------------------------------------------------------------------

/** The draft with redirect mode on, pointing at a link. The same draft when it already does. */
export function withRedirect(draft: DraftDoc, linkId: string): DraftDoc {
  if (draft.redirect?.linkId === linkId) return draft;
  return { ...draft, redirect: { linkId } };
}

/** The draft with redirect mode off (`redirect` removed). The same draft when it is already off. */
export function withoutRedirect(draft: DraftDoc): DraftDoc {
  if (draft.redirect === undefined) return draft;
  const rest: DraftDoc = { ...draft };
  delete rest.redirect;
  return rest;
}

/** True when the draft's redirect target is one the select would offer (visible, valid address, no lock). */
export function redirectTargetAvailable(draft: DraftDoc): boolean {
  const linkId = draft.redirect?.linkId;
  return (
    linkId !== undefined && redirectOptions(draft.blocks).some((option) => option.id === linkId)
  );
}
