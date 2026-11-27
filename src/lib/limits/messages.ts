import { TERMS_PER_TYPE } from "@/lib/blog/types";
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

const grouped = (count: number) => count.toLocaleString("en-US");
const postNoun = (count: number) => (count === 1 ? "post" : "posts");

/** "25", "1,000", or "Unlimited" for Studio (its 100,000 is a fair-use cap): posts per site as copy shows it (M16-12). */
export function formatPostsLimit(plan: PlanId): string {
  return plan === "studio" ? "Unlimited" : grouped(PLAN_LIMITS[plan].entriesPerType);
}

/**
 * The line in the Posts screen's header (M16-12), the trash counted in `used` as HL010 counts it:
 *   Free    "3 of 25 posts"
 *   Pro     "40 of 1,000 posts"
 *   Studio  "40 posts · Unlimited"
 */
export function postsUsageText(plan: PlanId, used: number): string {
  if (plan === "studio") return `${grouped(used)} ${postNoun(used)} · Unlimited`;
  return `${grouped(used)} of ${formatPostsLimit(plan)} posts`;
}

/**
 * Why a new post is refused (HL010, M16-12), by plan:
 *   Free    "Free includes 25 posts, the trash included. Pro includes 1,000."
 *   Pro     "You’ve used 1,000 of 1,000 posts, the trash included. Studio includes unlimited posts."
 *   Studio  "You’ve used 100,000 of 100,000 posts, the trash included."
 */
export function postLimitMessage(
  plan: PlanId,
  used: number = PLAN_LIMITS[plan].entriesPerType,
): string {
  const own = grouped(PLAN_LIMITS[plan].entriesPerType);
  if (plan === "free") {
    return `${PLAN_LABELS.free} includes ${own} posts, the trash included. ${PLAN_LABELS.pro} includes ${grouped(PLAN_LIMITS.pro.entriesPerType)}.`;
  }
  const head = `You’ve used ${grouped(used)} of ${own} posts, the trash included.`;
  return plan === "pro" ? `${head} ${PLAN_LABELS.studio} includes unlimited posts.` : head;
}

/** Why a new category or tag is refused (HL015, M16-14). The cap is the same on every plan. */
export const TERM_LIMIT_MESSAGE = `A blog holds up to ${TERMS_PER_TYPE} categories and tags. Delete one to add another.`;
