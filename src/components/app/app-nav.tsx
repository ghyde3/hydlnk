"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import {
  AccountIcon,
  AnalyticsIcon,
  BillingIcon,
  DesignIcon,
  DomainsIcon,
  EditorIcon,
} from "./icons";

interface NavItem {
  /** First path segment under the app host: /editor -> "editor". */
  segment: string;
  href: string;
  label: string;
  tabLabel: string;
  sidebarIcon: ReactNode;
  tabIcon: ReactNode;
}

const ITEMS: readonly NavItem[] = [
  {
    segment: "editor",
    href: "/editor",
    label: "Editor",
    tabLabel: "Editor",
    sidebarIcon: <EditorIcon size={16} />,
    tabIcon: <EditorIcon size={20} />,
  },
  {
    segment: "design",
    href: "/design",
    label: "Design",
    tabLabel: "Design",
    sidebarIcon: <DesignIcon size={16} />,
    tabIcon: <DesignIcon size={20} />,
  },
  {
    segment: "analytics",
    href: "/analytics",
    label: "Analytics",
    tabLabel: "Stats",
    sidebarIcon: <AnalyticsIcon size={16} />,
    tabIcon: <AnalyticsIcon size={20} />,
  },
  {
    segment: "domains",
    href: "/domains",
    label: "Domains",
    tabLabel: "Domains",
    sidebarIcon: <DomainsIcon size={16} />,
    tabIcon: <DomainsIcon size={20} />,
  },
  {
    segment: "settings",
    href: "/settings",
    label: "Settings & billing",
    tabLabel: "Account",
    sidebarIcon: <BillingIcon size={16} />,
    tabIcon: <AccountIcon size={20} />,
  },
];

/*
 * The current screen comes from the route segment below the (screens) layout, not from the URL
 * text: it is the same on the app host (where the proxy rewrites /editor to /app/editor), after a
 * redirect, and for any sub-route a screen grows later (/editor/anything is still "editor").
 */

/** Desktop sidebar navigation (>= 760px). */
export function SidebarNav() {
  const current = useSelectedLayoutSegment();
  return (
    <nav aria-label="App" className="flex flex-col gap-0.5">
      {ITEMS.map((item) => {
        const active = item.segment === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline ${
              active
                ? "bg-ink-raised-2 font-semibold text-surface"
                : "text-on-ink-muted-2 hover:bg-ink-raised hover:text-on-ink"
            }`}
          >
            <span className={active ? "text-brass" : undefined}>{item.sidebarIcon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone bottom tab bar (< 760px): fixed, five tabs, current one marked with a brass top edge. */
export function TabBar() {
  const current = useSelectedLayoutSegment();
  return (
    <nav
      aria-label="App sections"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] hl:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.segment === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-[3px] text-[11px] no-underline ${
              active
                ? "font-semibold text-ink shadow-[inset_0_2px_0_var(--hl-brass)]"
                : "font-medium text-text-3"
            }`}
          >
            {item.tabIcon}
            {item.tabLabel}
          </Link>
        );
      })}
    </nav>
  );
}
