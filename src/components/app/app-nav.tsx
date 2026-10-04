"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { AccountIcon, AnalyticsIcon, DomainsIcon, EditorIcon } from "./icons";
import { navKeyForSegment, type NavKey } from "./nav-items";

interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  tabLabel: string;
  sidebarIcon: ReactNode;
  tabIcon: ReactNode;
}

const EDITOR: NavItem = {
  key: "editor",
  href: "/editor",
  label: "Editor",
  tabLabel: "Editor",
  sidebarIcon: <EditorIcon size={16} />,
  tabIcon: <EditorIcon size={20} />,
};
const ANALYTICS: NavItem = {
  key: "analytics",
  href: "/analytics",
  label: "Analytics",
  tabLabel: "Stats",
  sidebarIcon: <AnalyticsIcon size={16} />,
  tabIcon: <AnalyticsIcon size={20} />,
};
const DOMAINS: NavItem = {
  key: "domains",
  href: "/domains",
  label: "Domains",
  tabLabel: "Domains",
  sidebarIcon: <DomainsIcon size={16} />,
  tabIcon: <DomainsIcon size={20} />,
};
/** Phone only: "Settings & billing" is in the account menu on desktop (M7-01). */
const ACCOUNT: NavItem = {
  key: "settings",
  href: "/settings",
  label: "Settings & billing",
  tabLabel: "Account",
  sidebarIcon: <AccountIcon size={16} />,
  tabIcon: <AccountIcon size={20} />,
};

/** The sidebar: Editor (one item for Edit, Design and Share), Analytics and Domains. */
const SIDEBAR_ITEMS: readonly NavItem[] = [EDITOR, ANALYTICS, DOMAINS];
/** The phone tab bar: Editor, Stats, Domains and Account (settings). */
const TAB_ITEMS: readonly NavItem[] = [EDITOR, ANALYTICS, DOMAINS, ACCOUNT];

/*
 * The current screen comes from the route segment below the (screens) layout, not from the URL
 * text: it is the same on the app host (where the proxy rewrites /editor to /app/editor), after a
 * redirect, and for any sub-route a screen grows later. See ./nav-items.ts for the mapping (the
 * workspace's route group reports its own name).
 */

/** Desktop sidebar navigation (>= 760px). */
export function SidebarNav() {
  const current = navKeyForSegment(useSelectedLayoutSegment());
  return (
    <nav aria-label="App" className="flex flex-col gap-0.5">
      {SIDEBAR_ITEMS.map((item) => {
        const active = item.key === current;
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

/** Phone bottom tab bar (< 760px): fixed, four tabs, current one marked with a brass top edge. */
export function TabBar() {
  const current = navKeyForSegment(useSelectedLayoutSegment());
  return (
    <nav
      aria-label="App sections"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] hl:hidden"
    >
      {TAB_ITEMS.map((item) => {
        const active = item.key === current;
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
