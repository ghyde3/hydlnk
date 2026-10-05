import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/limits";

/**
 * How the marketing site words the two page limits (M11-11): sites per plan and pages per site. The
 * numbers are read from the limits table (src/lib/limits/table.ts), never typed here; only the rule
 * for showing Studio's fair-use cap of pages per site as "Unlimited" is. A site is what the account
 * owns (its handle, domains, theme and analytics); its pages are Home and the sub-pages.
 */

/** Studio's pages per site is a fair-use cap, so it is shown as "Unlimited" (PLAN.md, Sites with pages). */
const UNLIMITED_PAGES_PLAN: PlanId = "studio";

const unit = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The number of sites the plan allows. */
export function siteCount(plan: PlanId): number {
  return PLAN_LIMITS[plan].pages;
}

/** "1 site", "3 sites", "15 sites". */
export function sitesText(plan: PlanId): string {
  return unit(siteCount(plan), "site", "sites");
}

/** The pages-per-site cell of the comparison: "Home and 2", "10", "Unlimited". */
export function pagesPerSiteCell(plan: PlanId): string {
  if (plan === UNLIMITED_PAGES_PLAN) return "Unlimited";
  const total = PLAN_LIMITS[plan].pagesPerSite;
  return plan === "free" ? `Home and ${total - 1}` : String(total);
}

/** "Home and 2 more pages", "up to 10 pages per site", "unlimited pages per site", for running text. */
export function pagesPerSiteText(plan: PlanId): string {
  if (plan === UNLIMITED_PAGES_PLAN) return "unlimited pages per site";
  const total = PLAN_LIMITS[plan].pagesPerSite;
  return plan === "free" ? `Home and ${total - 1} more pages` : `up to ${total} pages per site`;
}

/** The same line starting a list item or a sentence. */
export function pagesPerSiteItem(plan: PlanId): string {
  const text = pagesPerSiteText(plan);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Free includes 1 site, Pro includes 3 and Studio includes 15": for FAQ and audience answers. */
export function sitesPerPlanSentence(): string {
  return `${PLAN_LABELS.free} includes ${sitesText("free")}, ${PLAN_LABELS.pro} includes ${siteCount("pro")} and ${PLAN_LABELS.studio} includes ${siteCount("studio")}`;
}

/** "Free: Home and 2 pages per site. Pro: 10. Studio: unlimited." for the pages-per-site FAQ answer. */
export function pagesPerSiteSentence(): string {
  const free = PLAN_LIMITS.free.pagesPerSite;
  return `${PLAN_LABELS.free} sites have ${free} pages, Home and ${free - 1} more. ${PLAN_LABELS.pro} sites have up to ${PLAN_LIMITS.pro.pagesPerSite}, and ${PLAN_LABELS.studio} sites have no practical limit`;
}
