"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TokenSet } from "@/lib/theme";

/**
 * The page's resolved tokens, for editor controls that need to say what "Theme default" means
 * ("Theme default (Outline)", M3-17). The editor screen mounts one provider around its block list
 * with the tokens of the draft's publish form, so the label follows the page's current theme and
 * page overrides. Without a provider the hook returns null and the control says "Theme default".
 *
 * Editor UI only: it carries data, never `--t-*` variables, so the two token systems stay apart.
 */
const PageTokensContext = createContext<TokenSet | null>(null);

export function PageTokensProvider({
  tokens,
  children,
}: {
  tokens: TokenSet;
  children: ReactNode;
}) {
  return <PageTokensContext.Provider value={tokens}>{children}</PageTokensContext.Provider>;
}

export function usePageTokens(): TokenSet | null {
  return useContext(PageTokensContext);
}
