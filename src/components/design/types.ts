import type { TokenSet } from "@/lib/theme";

/**
 * Props every Design screen token section receives (M3-06). The screen owns the draft; a section
 * only reads the resolved tokens and asks for a change through `setToken`.
 *
 *   resolved    the page's tokens as they resolve today: system default, then the applied theme,
 *               then the page overrides. This is what the preview draws.
 *   overrides   the draft's page-level overrides (`draft.theme.overrides`) and nothing else.
 *   setToken    writes one page-level override, or removes it when `value` is undefined (the
 *               token then falls back to the applied theme). Every call schedules an autosave of
 *               the draft; a section never saves on its own.
 *   pageId      the page being designed (a section that uploads or reads page media needs it).
 *   ownerId     the signed-in user's id (the first path segment of the page's uploaded media).
 */
export type DesignSectionProps = {
  resolved: TokenSet;
  overrides: Partial<TokenSet>;
  setToken: <K extends keyof TokenSet>(key: K, value: TokenSet[K] | undefined) => void;
  pageId: string;
  ownerId: string;
};
