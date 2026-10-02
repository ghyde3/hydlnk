import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";

/**
 * The page footer's two links, decided here and never by the page document (M2-28, M2-29): a
 * tenant cannot add or remove either one through the draft or the published JSON. Safe in server
 * and client code (the editor preview uses the same helpers as the public page).
 */

/** Plans that may remove the badge. Anything else, including a value we do not know, shows it. */
const BADGE_FREE_PLANS: readonly string[] = ["pro", "studio"];

/** "Made with HYDLNK" shows unless the plan is pro or studio: an unknown plan fails closed. */
export function showBadge(plan: string | null | undefined): boolean {
  return !(typeof plan === "string" && BADGE_FREE_PLANS.includes(plan));
}

/**
 * Where "Report this page" points: the HYDLNK marketing origin plus `/report?page={pageId}`
 * (`http://localhost:3000/report?page=...` locally). Only the page id goes in, URL-encoded; no
 * handle, name or other tenant string ever reaches it.
 */
export function reportUrl(
  pageId: string,
  rootDomain: string = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
): string {
  return `${rootOrigin(rootDomain)}/report?${new URLSearchParams({ page: pageId }).toString()}`;
}

/** The `chrome` prop of `PageRenderer` for a page owned by an account on `plan`. */
export function pageChrome(
  plan: string | null | undefined,
  pageId: string,
): { badge: boolean; reportHref: string } {
  return { badge: showBadge(plan), reportHref: reportUrl(pageId) };
}
