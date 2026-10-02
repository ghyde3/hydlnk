import { formatLimitBytes } from "./format";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "./table";

/**
 * The words the limits use, built from the table so a number is never typed twice. Safe in server
 * and client code. Sentence case, no exclamation marks, curly apostrophes (docs/DESIGN.md -> Copy).
 */

const pageNoun = (count: number) => (count === 1 ? "page" : "pages");

/**
 * Why a new page is refused (M4-18), by plan:
 *   Free    "Free includes 1 page. Pro includes 3."
 *   Pro     "You’ve used 3 of 3 pages. Studio includes 15."
 *   Studio  "You’ve used 15 of 15 pages."
 * `used` is the account's page count (what a Pro account at the limit has used).
 */
export function pageLimitMessage(plan: PlanId, used: number = PLAN_LIMITS[plan].pages): string {
  const own = PLAN_LIMITS[plan].pages;
  if (plan === "free") {
    return `${PLAN_LABELS.free} includes ${own} ${pageNoun(own)}. ${PLAN_LABELS.pro} includes ${PLAN_LIMITS.pro.pages}.`;
  }
  const head = `You’ve used ${used} of ${own} pages.`;
  if (plan === "pro") return `${head} ${PLAN_LABELS.studio} includes ${PLAN_LIMITS.studio.pages}.`;
  return head;
}

/** Why an upload is refused (M4-31): "Uploads are limited to 10 MB on Free. Delete an image or upgrade." */
export function uploadQuotaMessage(plan: PlanId): string {
  return `Uploads are limited to ${formatLimitBytes(PLAN_LIMITS[plan].uploadBytes)} on ${PLAN_LABELS[plan]}. Delete an image or upgrade.`;
}

/** The helper line under a meter that is past its limit (M4-32, M4-33). */
export const OVER_LIMIT_NOTE = "Over your plan’s limit. What you have stays; you can’t add more.";

/** The plan blurbs on the plan cards (PLAN.md -> Monetization). Nothing deferred from v1 appears here. */
export function planBlurb(plan: PlanId): string {
  const limits = PLAN_LIMITS[plan];
  switch (plan) {
    case "free":
      return `${limits.pages} ${pageNoun(limits.pages)}, hydlnk.com address, ${limits.analyticsHistoryDays} days of per-link clicks.`;
    case "pro":
      return `${limits.pages} pages, ${limits.customDomains} custom domain, a year of analytics, no badge.`;
    case "studio":
      return `${limits.pages} pages, ${limits.customDomains} custom domains, a year of analytics, no badge.`;
  }
}
