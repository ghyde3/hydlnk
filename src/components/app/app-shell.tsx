import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/**
 * Placeholder app chrome (DESIGN.md -> Layout and responsive rules): a 240px charcoal sidebar from
 * 760px up, a charcoal top bar below it, and a white page header over a content area on --hl-page.
 * The page switcher, plan meter, user block and the phone bottom tab bar arrive with the editor.
 */
export function AppShell({
  title,
  breadcrumb,
  children,
}: {
  title: string;
  breadcrumb: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col hl:flex-row">
      <div className="flex min-h-14 items-center bg-ink px-4 text-on-ink hl:hidden">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
      </div>

      <aside className="hidden w-60 shrink-0 flex-col gap-5 bg-ink px-3 py-4 text-on-ink hl:flex">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center px-2">
          <Logo />
        </Link>
        <nav aria-label="App" className="flex flex-col gap-0.5">
          <Link
            href="/"
            aria-current="page"
            className="inline-flex min-h-11 items-center rounded-md bg-ink-raised-2 px-2.5 text-sm font-semibold text-surface"
          >
            Editor
          </Link>
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-surface px-4 py-3.5 hl:px-8">
          <p className="font-mono text-xs text-text-2">{breadcrumb}</p>
          <h1 className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-[-0.01em]">{title}</h1>
        </header>
        <div className="flex-1 p-4 hl:p-8">{children}</div>
      </main>
    </div>
  );
}
