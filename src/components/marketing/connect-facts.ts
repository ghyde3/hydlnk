import { PLAN_LIMITS } from "@/lib/limits";
import { ACCESS_TOKEN_SECONDS, REFRESH_IDLE_SECONDS } from "@/lib/oauth/constants";
import { PRODUCT_DOMAIN } from "@/lib/pages/plans";

/**
 * The facts the /connect page and the privacy policy state about the AI connector (M10-34, M10-35),
 * in one place so a number is never typed twice. It imports only modules that have no imports of
 * their own (the plan table, the product domain and the connector's constants), like
 * src/lib/analytics/retention.ts: marketing pages import it, and nothing here may reach the MCP
 * server packages (M10-01's boundary test).
 *
 * The connector address is always the production one, built from PRODUCT_DOMAIN and never from the
 * local root domain, so a visitor on localhost still copies the address that works for them.
 */
export const CONNECTOR_ADDRESS = `https://app.${PRODUCT_DOMAIN}/mcp`;

/*
 * The rate limits and the activity retention the page states are imported from the connector's own
 * dependency-free constants (`@/lib/mcp/constants`: `MCP_USER_PER_MINUTE`, `MCP_PUBLISH_PER_HOUR`,
 * `MCP_ACTIVITY_RETENTION_DAYS`), and the two lifetimes the privacy policy states from the
 * authorization server's (`@/lib/oauth/constants`: `ACCESS_TOKEN_SECONDS`, `REFRESH_IDLE_SECONDS`),
 * so the pages cannot say anything the server does not enforce. Both files have no imports of their
 * own, which is what lets a marketing page read them (M10-01's boundary).
 */

/** Whole days an unused connection lasts, for the privacy policy. */
export const CONNECTION_IDLE_DAYS = REFRESH_IDLE_SECONDS / 86_400;
/** How long an access grant lasts, as the policy says it: "an hour". */
export const ACCESS_LIFETIME_WORDS =
  ACCESS_TOKEN_SECONDS === 3600 ? "an hour" : `${ACCESS_TOKEN_SECONDS / 3600} hours`;

/** How far back analytics read, in words: 30 days, a year. */
export function historyWords(days: number): string {
  if (days === 365) return "a year";
  return `${days} days`;
}

/** What the connector can read of the numbers, by plan (the same table as the Analytics screen). */
export const ANALYTICS_HISTORY = {
  free: historyWords(PLAN_LIMITS.free.analyticsHistoryDays),
  paid: historyWords(PLAN_LIMITS.pro.analyticsHistoryDays),
} as const;
