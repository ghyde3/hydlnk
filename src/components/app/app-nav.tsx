"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { ChartColumn, Globe, Inbox, LayoutGrid, User } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { navKeyForSegment, type NavKey } from "./nav-items";

interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  tabLabel: string;
  sidebarIcon: ReactNode;
  tabIcon: ReactNode;
  /** Shown only on the user's own site (Wave F, G3): a member works on the draft, not the account. */
  ownerOnly?: boolean;
}

const EDITOR: NavItem = {
  key: "editor",
  href: "/editor",
  label: "Editor",
  tabLabel: "Editor",
  sidebarIcon: <Icon icon={LayoutGrid} size={16} />,
  tabIcon: <Icon icon={LayoutGrid} size={20} />,
};
const ANALYTICS: NavItem = {
  key: "analytics",
  href: "/analytics",
  label: "Analytics",
  tabLabel: "Stats",
  ownerOnly: true,
  sidebarIcon: <Icon icon={ChartColumn} size={16} />,
  tabIcon: <Icon icon={ChartColumn} size={20} />,
};
/** The submissions of the current site's forms (Wave D, M17-08). */
const AUDIENCE: NavItem = {
  key: "audience",
  href: "/audience",
  label: "Audience",
  tabLabel: "Audience",
  ownerOnly: true,
  sidebarIcon: <Icon icon={Inbox} size={16} />,
  tabIcon: <Icon icon={Inbox} size={20} />,
};
const DOMAINS: NavItem = {
  key: "domains",
  href: "/domains",
  label: "Domains",
  tabLabel: "Domains",
  ownerOnly: true,
  sidebarIcon: <Icon icon={Globe} size={16} />,
  tabIcon: <Icon icon={Globe} size={20} />,
};
/** Phone only: "Settings & billing" is in the account menu on desktop (M7-01). */
const ACCOUNT: NavItem = {
  key: "settings",
  href: "/settings",
  label: "Settings & billing",
  tabLabel: "Account",
  sidebarIcon: <Icon icon={User} size={16} />,
  tabIcon: <Icon icon={User} size={20} />,
};

/** The sidebar: Editor (one item for Edit, Design and Share), Analytics, Audience and Domains. */
const SIDEBAR_ITEMS: readonly NavItem[] = [EDITOR, ANALYTICS, AUDIENCE, DOMAINS];
/** The phone tab bar: Editor, Stats, Audience, Domains and Account (settings). */
const TAB_ITEMS: readonly NavItem[] = [EDITOR, ANALYTICS, AUDIENCE, DOMAINS, ACCOUNT];

/*
 * The current screen comes from the route segment below the (screens) layout, not from the URL
 * text: it is the same on the app host (where the proxy rewrites /editor to /app/editor), after a
 * redirect, and for any sub-route a screen grows later. See ./nav-items.ts for the mapping (the
 * workspace's route group reports its own name).
 */

/** The items for the current site: on a site shared with the user, no owner-only item (M19-10). */
const visible = (items: readonly NavItem[], isOwner: boolean) =>
  items.filter((item) => isOwner || !item.ownerOnly);

/** Desktop sidebar navigation (>= 760px). */
export function SidebarNav({ isOwner = true }: { isOwner?: boolean }) {
  const current = navKeyForSegment(useSelectedLayoutSegment());
  return (
    <nav aria-label="App" className="flex flex-col gap-0.5">
      {visible(SIDEBAR_ITEMS, isOwner).map((item) => {
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

/**
 * Phone bottom tab bar (< 760px): fixed, five tabs (four before Wave D), current one marked with a brass top edge. Its
 * height is `--hl-tab-bar` (57px: the 56px tabs and the 1px top border) plus the safe-area inset;
 * anything placed on top of it uses the same token (`TAB_BAR_TOP_CLASS`).
 */
/** `bottom` of a fixed element that sits exactly on the phone tab bar. */
export const TAB_BAR_TOP_CLASS = "bottom-[calc(var(--hl-tab-bar)+env(safe-area-inset-bottom))]";

export function TabBar({ isOwner = true }: { isOwner?: boolean }) {
  const current = navKeyForSegment(useSelectedLayoutSegment());
  return (
    <nav
      aria-label="App sections"
      className="fixed inset-x-0 bottom-0 z-20 box-border flex h-[calc(var(--hl-tab-bar)+env(safe-area-inset-bottom))] justify-around border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)] hl:hidden"
    >
      {visible(TAB_ITEMS, isOwner).map((item) => {
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
