import type { CSSProperties } from "react";
import { resolveTokens, tokensToCssVars } from "@/lib/theme";

/**
 * What a claimed-but-unpublished handle shows (M1-15). A tenant page, not HYDLNK UI: the root
 * carries the --t-* variables resolved from the system default theme and nothing here reads an
 * --hl-* variable. System fonts, no network requests, never a page document (Milestone 2 renders
 * documents; this milestone only knows the handle).
 */
export function UnpublishedPlaceholder({ handle }: { handle: string }) {
  const tokens = resolveTokens();
  return (
    <div
      className="tenant-root tenant-placeholder"
      style={tokensToCssVars(tokens) as CSSProperties}
      data-density={tokens.density}
      data-align={tokens.align}
    >
      <main className="tenant-main">
        <h1 className="tenant-name">{handle}</h1>
        <p className="tenant-note">Nothing published here yet.</p>
      </main>
    </div>
  );
}
