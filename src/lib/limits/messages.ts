import { formatLimitBytes } from "./format";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "./table";

/**
 * The words the limits use, built from the table so a number is never typed twice. Safe in server
 * and client code. Sentence case, no exclamation marks, curly apostrophes (docs/DESIGN.md -> Copy).
 */

const siteNoun = (count: number) => (count === 1 ? "site" : "sites");

/**
 * Why a new site is refused (M4-18, M11-11: what was a page is a site), by plan:
 *   Free    "Free includes 1 site. Pro includes 3."
 *   Pro     "You’ve used 3 of 3 sites. Studio includes 15."
 *   Studio  "You’ve used 15 of 15 sites."
 * `used` is the account's site count (what a Pro account at the limit has used).
 */
export function pageLimitMessage(plan: PlanId, used: number = PLAN_LIMITS[plan].pages): string {
  const own = PLAN_LIMITS[plan].pages;
  if (plan === "free") {
    return `${PLAN_LABELS.free} includes ${own} ${siteNoun(own)}. ${PLAN_LABELS.pro} includes ${PLAN_LIMITS.pro.pages}.`;
  }
  const head = `You’ve used ${used} of ${own} sites.`;
  if (plan === "pro") return `${head} ${PLAN_LABELS.studio} includes ${PLAN_LIMITS.studio.pages}.`;
  return head;
}

/** "3", or "Unlimited" for Studio (its 500 is a fair-use cap): pages per site as copy shows it (M11-11). */
export function formatPagesPerSite(plan: PlanId): string {
  return plan === "studio" ? "Unlimited" : String(PLAN_LIMITS[plan].pagesPerSite);
}

/**
 * Why a new page is refused in a site (M11-04, M11-08), Home counted in `used`:
 *   Free    "Free includes 3 pages per site, Home and 2 more. Pro includes 10."
 *   Pro     "You’ve used 10 of 10 pages on this site. Studio includes unlimited pages."
 *   Studio  "You’ve used 500 of 500 pages on this site."
 */
export function pagesPerSiteMessage(
  plan: PlanId,
  used: number = PLAN_LIMITS[plan].pagesPerSite,
): string {
  const own = PLAN_LIMITS[plan].pagesPerSite;
  if (plan === "free") {
    return `${PLAN_LABELS.free} includes ${own} pages per site, Home and ${own - 1} more. ${PLAN_LABELS.pro} includes ${PLAN_LIMITS.pro.pagesPerSite}.`;
  }
  const head = `You’ve used ${used} of ${own} pages on this site.`;
  return plan === "pro" ? `${head} ${PLAN_LABELS.studio} includes unlimited pages.` : head;
}

/** Why an upload is refused (M4-31): "Uploads are limited to 10 MB on Free. Delete an image or upgrade." */
export function uploadQuotaMessage(plan: PlanId): string {
  return `Uploads are limited to ${formatLimitBytes(PLAN_LIMITS[plan].uploadBytes)} on ${PLAN_LABELS[plan]}. Delete an image or upgrade.`;
}

/** The helper line under a meter that is past its limit (M4-32, M4-33). */
export const OVER_LIMIT_NOTE = "Over your plan’s limit. What you have stays; you can’t add more.";

/**
 * The plan blurbs on the plan cards (PLAN.md -> Monetization): sites per plan and pages per site,
 * both read from the table (M11-11). Nothing deferred from v1 appears here.
 */
export function planBlurb(plan: PlanId): string {
  const limits = PLAN_LIMITS[plan];
  const sites = `${limits.pages} ${siteNoun(limits.pages)}`;
  const count = formatPagesPerSite(plan).toLowerCase();
  const perSite =
    plan === "free"
      ? `${count} pages (Home and ${limits.pagesPerSite - 1})`
      : `${count} pages each`;
  switch (plan) {
    case "free":
      return `${sites} with ${perSite}, hydlnk.com address, ${limits.analyticsHistoryDays} days of per-link clicks.`;
    case "pro":
      return `${sites} with ${perSite}, ${limits.customDomains} custom domain, a year of analytics, no badge.`;
    case "studio":
      return `${sites} with ${perSite}, ${limits.customDomains} custom domains, a year of analytics, no badge.`;
  }
}

/** Why a Free account cannot publish redirect mode (M9-31): the sentence the Publish gate and the Share tab use. */
export const REDIRECT_MODE_MESSAGE = "Redirect mode is part of Pro. Upgrade to use it.";
