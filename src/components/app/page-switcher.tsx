import { getAppContext } from "@/lib/pages/context";
import { SUSPENDED_REASON } from "@/components/admin/suspension-context";
import { PLAN_LIMITS, pageLimitMessage } from "@/lib/limits";
import { PageSwitcherMenu, type SwitcherPage } from "./page-switcher-menu";

export type { SwitcherPage } from "./page-switcher-menu";

/**
 * The page switcher (M1-18, M4-18). A server component wrapped around the client menu so the menu
 * can know the account's plan without the app shell passing it: `getAppContext` is cached per
 * request, so this reads what the layout already loaded. At the plan's page limit the menu's
 * "New page" item is disabled and shows the plan's message (Free: "Free includes 1 page. Pro
 * includes 3."); under it the server refuses the create anyway (the database trigger is the
 * backstop), this only keeps the UI from offering what will be refused.
 */
export async function PageSwitcher({
  pages,
  currentId,
  variant,
}: {
  pages: SwitcherPage[];
  currentId: string;
  variant: "sidebar" | "chip";
}) {
  const { plan, pages: owned, suspended } = await getAppContext();
  // A suspended account cannot create pages (M5-09): the item is disabled with the reason, and the
  // "See plans" link a page limit offers is left out (a plan does not lift a suspension).
  const limitMessage = suspended
    ? SUSPENDED_REASON
    : owned.length >= PLAN_LIMITS[plan].pages
      ? pageLimitMessage(plan, owned.length)
      : null;
  return (
    <PageSwitcherMenu
      pages={pages}
      currentId={currentId}
      variant={variant}
      limitMessage={limitMessage}
      suspended={suspended}
    />
  );
}
