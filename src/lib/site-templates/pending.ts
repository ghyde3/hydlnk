import { isSiteTemplateId, type SiteTemplateId } from "./catalog";

/**
 * The template the owner picked on the new-site form (M12-03), handed to the editor's template card
 * across the one navigation that follows. It is a one-shot flag in this tab's sessionStorage, never
 * an address parameter: a link someone else sends must not be able to fill a site with drafts, so
 * nothing but the owner's own submit of the form (or a click on the card) applies a template.
 */
export const PENDING_TEMPLATE_KEY = "hydlnk:pending-site-template";
/** A flag older than this is stale (the owner left the flow) and is dropped unused. */
export const PENDING_TEMPLATE_MAX_AGE_MS = 2 * 60 * 1000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const defaultStore = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

/** Remember the template the owner chose on the new-site form. */
export function setPendingTemplate(
  id: SiteTemplateId,
  now = Date.now(),
  store: Store | null = defaultStore(),
): void {
  try {
    store?.setItem(PENDING_TEMPLATE_KEY, JSON.stringify({ id, at: now }));
  } catch {
    // Storage blocked: the owner picks the template on the card instead.
  }
}

/** Read and clear the flag: the template to apply once, or null (none, stale, or not a template). */
export function consumePendingTemplate(
  now = Date.now(),
  store: Store | null = defaultStore(),
): SiteTemplateId | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PENDING_TEMPLATE_KEY);
    if (raw === null) return null;
    store.removeItem(PENDING_TEMPLATE_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { id, at } = parsed as { id?: unknown; at?: unknown };
    if (typeof at !== "number" || now - at > PENDING_TEMPLATE_MAX_AGE_MS || now < at - 1000) {
      return null;
    }
    return isSiteTemplateId(id) ? id : null;
  } catch {
    return null;
  }
}
