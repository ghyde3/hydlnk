import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/limits";
import type { DomainErrorCode } from "./types";

/**
 * The words of the Domains flow, in one place (docs/DESIGN.md -> Copy: sentence case, curly
 * apostrophes, no exclamation marks, errors say what to do). Safe in server and client code.
 */

export const DOMAIN_MESSAGES = {
  hostnameTaken: "That domain is already connected to a page.",
  unreachableAdd: "We couldn’t reach our host to add that domain. Try again.",
  conflictElsewhere: "That domain is already connected elsewhere on our host. Contact support.",
  capacity: "We can’t add more domains right now. Try again later.",
  notConfigured: "Custom domains aren’t available right now. Try again later.",
  unreachableRemove: "We couldn’t remove that domain from our host. Try again.",
  unreachableCheck: "We couldn’t check right now. Try again in a minute.",
  expiredReleased:
    "This domain wasn’t connected within 7 days, so we released it. Add it again to try once more.",
  checkedJustNow: "Checked just now. DNS isn’t pointing here yet. Records can take a while to spread.",
  checkedFewSecondsAgo: "Checked a few seconds ago.",
  choosePage: "Choose one of your pages for this domain.",
  notYourPage: "Choose one of your pages for this domain.",
  noSuchDomain: "We couldn’t find that domain.",
  signedOut: "Sign in to manage your domains.",
  suspended: "Your account is suspended. Contact support to appeal.",
  rateLimited: "You’ve tried that a lot in a short time. Wait a minute and try again.",
  generic: "We couldn’t finish that. Try again.",
} as const;

/**
 * Why a domain is refused for the plan (M4-12), built from the limits table:
 *   Free    "Custom domains start on Pro."
 *   Pro     "You’ve used 1 of 1 custom domains. Studio includes 15."
 *   Studio  "You’ve used 15 of 15 custom domains."
 */
export function domainLimitMessage(plan: PlanId, used: number = PLAN_LIMITS[plan].customDomains): string {
  if (plan === "free") return `Custom domains start on ${PLAN_LABELS.pro}.`;
  const head = `You’ve used ${used} of ${PLAN_LIMITS[plan].customDomains} custom domains.`;
  if (plan === "pro") return `${head} ${PLAN_LABELS.studio} includes ${PLAN_LIMITS.studio.customDomains}.`;
  return head;
}

/** HTTP-style status for each error code (the action results carry it next to `error`). */
export const DOMAIN_STATUS: Readonly<Record<DomainErrorCode, number>> = {
  unauthenticated: 401,
  invalid_request: 400,
  invalid_hostname: 400,
  rate_limited: 429,
  plan_required: 403,
  domain_limit: 403,
  account_suspended: 403,
  forbidden: 403,
  not_found: 404,
  domain_expired: 410,
  hostname_taken: 409,
  vercel_conflict: 409,
  vercel_capacity: 503,
  vercel_unavailable: 502,
  not_configured: 503,
  server_error: 500,
};
