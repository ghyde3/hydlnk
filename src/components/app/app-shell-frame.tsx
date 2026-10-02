import type { ReactNode } from "react";
import type { AppContext } from "@/lib/pages/context";
import { AppLogo } from "./app-logo";
import { SidebarNav, TabBar } from "./app-nav";
import { PageSwitcher, type SwitcherPage } from "./page-switcher";
import { PlanCard } from "./plan-card";
import { UserBlock } from "./user-block";

/**
 * The signed-in app chrome (DESIGN.md -> Layout and responsive rules), shared by every screen:
 *   >= 760px  a 240px charcoal sidebar (logo, page switcher, nav, plan card, user) beside <main>
 *   <  760px  a charcoal top bar (logo + page chip) over <main>, and a fixed white bottom tab bar
 * One breakpoint (hl:); the hidden variant is display:none, so it is out of the tab order and the
 * accessibility tree. Screens render their own header and content inside <main>.
 */
export function AppShellFrame({ context, children }: { context: AppContext; children: ReactNode }) {
  const { user, pages, current, plan, pageLimit } = context;
  const switcherPages: SwitcherPage[] = pages.map((page) => ({
    id: page.id,
    handle: page.handle,
    published: page.published_at !== null,
  }));

  return (
    <div className="flex min-h-dvh flex-col hl:flex-row">
      <header className="flex min-h-14 items-center justify-between gap-3 bg-ink pr-3 pl-4 text-on-ink hl:hidden">
        <AppLogo size="bar" />
        <PageSwitcher pages={switcherPages} currentId={current.id} variant="chip" />
      </header>

      <aside className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto bg-ink px-3 py-4 text-on-ink hl:sticky hl:top-0 hl:flex hl:h-screen hl:min-h-screen hl:self-start">
        <AppLogo size="sidebar" />
        <div className="flex flex-col gap-1.5">
          <span className="px-2 font-mono text-[11px] tracking-[0.08em] text-on-ink-muted uppercase">
            Page
          </span>
          <PageSwitcher pages={switcherPages} currentId={current.id} variant="sidebar" />
        </div>
        <SidebarNav />
        <div className="flex-1" />
        <PlanCard plan={plan} pageCount={pages.length} pageLimit={pageLimit} />
        <UserBlock email={user.email} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col pb-[calc(84px+env(safe-area-inset-bottom))] hl:pb-0">
        {children}
      </main>

      <TabBar />
    </div>
  );
}
