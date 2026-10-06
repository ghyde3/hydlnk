import Link from "next/link";
import type { ReactNode } from "react";
import { SuspendedBanner } from "@/components/admin/suspended-banner";
import { SuspensionProvider } from "@/components/admin/suspension-context";
import { isCurrentUserAdmin } from "@/lib/admin/auth";
import type { AppContext } from "@/lib/pages/context";
import { AppLogo } from "./app-logo";
import { SidebarNav, TabBar } from "./app-nav";
import { PageSwitcher, type SwitcherPage } from "./page-switcher";
import { PlanCard } from "./plan-card";
import { AccountMenu } from "./account-menu";
import { AnnouncementBanner } from "./announcement-banner";

/**
 * The signed-in app chrome (DESIGN.md -> Layout and responsive rules), shared by every screen:
 *   >= 760px  a 240px charcoal sidebar (logo, page switcher, nav, plan card, user) beside <main>
 *   <  760px  a charcoal top bar (logo + page chip) over <main>, and a fixed white bottom tab bar
 * One breakpoint (hl:); the hidden variant is display:none, so it is out of the tab order and the
 * accessibility tree. Screens render their own header and content inside <main>.
 *
 * Admins get an "Admin" link in the sidebar's user area (and in the phone top bar). A suspended
 * account (M5-09) gets a persistent banner at the top of <main>, above every screen's header, and
 * every client component below can read `useAccountSuspended()` to disable what it may not do.
 */
export async function AppShellFrame({
  context,
  children,
}: {
  context: AppContext;
  children: ReactNode;
}) {
  const { user, pages, current, plan, pageLimit, suspended } = context;
  const admin = await isCurrentUserAdmin();
  const switcherPages: SwitcherPage[] = pages.map((page) => ({
    id: page.id,
    handle: page.handle,
    name: page.name,
    published: page.published_at !== null,
  }));

  return (
    <div className="flex min-h-dvh flex-col hl:flex-row">
      <header className="flex min-h-14 items-center justify-between gap-3 bg-ink pr-3 pl-4 text-on-ink hl:hidden">
        <AppLogo size="bar" />
        <div className="flex min-w-0 items-center gap-2">
          {admin ? <AdminLink variant="bar" /> : null}
          <PageSwitcher pages={switcherPages} currentId={current.id} variant="chip" />
        </div>
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
        {admin ? <AdminLink variant="sidebar" /> : null}
        <AccountMenu email={user.email} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col pb-[calc(84px+env(safe-area-inset-bottom))] hl:pb-0">
        <AnnouncementBanner />
        {suspended ? <SuspendedBanner /> : null}
        <SuspensionProvider suspended={suspended}>{children}</SuspensionProvider>
      </main>

      <TabBar />
    </div>
  );
}

/** The link to /admin, shown to admins only: the sidebar's user area, or the phone top bar. */
function AdminLink({ variant }: { variant: "sidebar" | "bar" }) {
  return (
    <Link
      href="/admin"
      data-admin-link
      className={
        variant === "sidebar"
          ? "flex min-h-11 items-center rounded-md px-2.5 text-sm text-ink-link no-underline hover:bg-ink-raised"
          : "inline-flex min-h-11 shrink-0 items-center rounded-md px-2 font-mono text-xs text-ink-link no-underline"
      }
    >
      Admin
    </Link>
  );
}
