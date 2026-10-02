import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import type { NavKey } from "./site-map";

/**
 * Page chrome for every marketing page: skip link, charcoal header, <main id="main"> and footer.
 * Each page renders its own shell (rather than a shared layout) so the header's current-page mark
 * is server-rendered and the menu starts closed on every navigation.
 */
export function MarketingShell({ current, children }: { current?: NavKey; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-4 py-3 text-sm font-semibold text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Skip to content
      </a>
      <SiteHeader current={current} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
