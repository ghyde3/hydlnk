"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

export const ADMIN_SECTIONS = [
  { segment: "reports", href: "/admin/reports", label: "Reports" },
  { segment: "pages", href: "/admin/pages", label: "Pages" },
  { segment: "traffic", href: "/admin/traffic", label: "Traffic" },
  { segment: "blocked-links", href: "/admin/blocked-links", label: "Blocked links" },
] as const;

/** Desktop sidebar navigation (>= 760px): Reports, Pages, Traffic, Blocked links. */
export function AdminSidebarNav() {
  const current = useSelectedLayoutSegment();
  return (
    <nav aria-label="Admin" className="flex flex-col gap-0.5">
      {ADMIN_SECTIONS.map((item) => {
        const active = item.segment === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-md px-2.5 text-sm no-underline ${
              active
                ? "bg-ink-raised-2 font-semibold text-surface"
                : "text-on-ink-muted-2 hover:bg-ink-raised hover:text-on-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phone section nav (< 760px): a segmented control (track, white selected item with a 1px ring)
 * that wraps instead of scrolling, every item at least 44px tall.
 */
export function AdminSegmentedNav() {
  const current = useSelectedLayoutSegment();
  return (
    <nav
      aria-label="Admin sections"
      className="flex flex-wrap gap-1 rounded-md bg-track p-1 hl:hidden"
    >
      {ADMIN_SECTIONS.map((item) => {
        const active = item.segment === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 min-w-20 flex-1 items-center justify-center rounded-sm px-3 text-sm no-underline ${
              active
                ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--hl-line-2)]"
                : "font-medium text-text-2"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
