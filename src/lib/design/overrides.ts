import type { DraftDoc } from "@/lib/document";
import type { TokenSet } from "@/lib/theme";

/**
 * Writes one page-level token override into a draft and returns the new draft (M3-07), or the same
 * object when nothing changes, so the screen only schedules an autosave for a real edit. A
 * `value` of undefined removes the override: the token falls back to the applied theme.
 */
export function withToken<K extends keyof TokenSet>(
  draft: DraftDoc,
  key: K,
  value: TokenSet[K] | undefined,
): DraftDoc {
  const current = draft.theme.overrides as Partial<TokenSet>;
  if (value === undefined) {
    if (!(key in current)) return draft;
    const next = { ...current };
    delete next[key];
    return { ...draft, theme: { ...draft.theme, overrides: next } };
  }
  if (current[key] === value) return draft;
  return { ...draft, theme: { ...draft.theme, overrides: { ...current, [key]: value } } };
}
