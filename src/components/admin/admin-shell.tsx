import Link from "next/link";
import type { ReactNode } from "react";
import { AppLogo } from "@/components/app/app-logo";
import { UserBlock } from "@/components/app/user-block";
import { AdminSegmentedNav, AdminSidebarNav } from "./admin-nav";

/**
 * The admin chrome (DESIGN.md -> Layout and responsive rules), the same shape as the app shell but
 * with its own sections and no page switcher or plan card:
 *   >= 760px  a 240px charcoal sidebar (logo, Reports / Pages / Traffic, a link back to the app, the
 *             signed-in admin) beside <main>
 *   <  760px  a charcoal top bar (logo and "Admin") with the sections as a segmented control under it
 * Screens render their own header and content inside <main>.
 */
export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col hl:flex-row">
      <header className="flex min-h-14 items-center justify-between gap-3 bg-ink pr-4 pl-4 text-on-ink hl:hidden">
        <AppLogo size="bar" />
        <span className="font-mono text-[11px] tracking-[0.08em] text-on-ink-muted uppercase">
          Admin
        </span>
      </header>

      <aside className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto bg-ink px-3 py-4 text-on-ink hl:sticky hl:top-0 hl:flex hl:h-screen hl:min-h-screen hl:self-start">
        <AppLogo size="sidebar" />
        <div className="flex flex-col gap-1.5">
          <Link
            href="/admin"
            className="px-2 font-mono text-[11px] tracking-[0.08em] text-on-ink-muted uppercase no-underline hover:text-on-ink"
          >
            Admin
          </Link>
          <AdminSidebarNav />
        </div>
        <div className="flex-1" />
        <Link
          href="/editor"
          className="flex min-h-11 items-center rounded-md px-2.5 text-sm text-ink-link no-underline hover:bg-ink-raised"
        >
          Back to the app
        </Link>
        <UserBlock email={email} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line bg-page px-4 py-3 hl:hidden">
          <AdminSegmentedNav />
        </div>
        {children}
      </main>
    </div>
  );
}
