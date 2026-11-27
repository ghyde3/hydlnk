import "server-only";
import { ACTIVITY_RATE_LIMITED_MESSAGE } from "./messages";

/**
 * The limit on changes that the site's activity log records (team attack pass, finding 2): 30 a
 * minute per actor, any site, with the shared limiter (as the schedule writes, M20-12). Every writer
 * that calls `recordSiteActivity` asks it after its access check and before it writes, so a member
 * cannot bury the owner's history under trash/restore toggles (tests/unit/m19t-activity-limit-static
 * holds that). Publish keeps its own stricter limits (60 an hour, src/lib/publish/limits.ts), and a
 * schedule's fire is the worker's, never limited here.
 */
export const SITE_ACTIVITY_RATE_LIMIT = 30;
export const SITE_ACTIVITY_RATE_WINDOW_SECONDS = 60;
export const SITE_ACTIVITY_RATE_LIMITED = ACTIVITY_RATE_LIMITED_MESSAGE;

/**
 * Counts one change of `actorId` and says whether it may go ahead. Fails open like every limit: the
 * limiter is loaded on use (it reads the server env), and a limiter that cannot load or answer lets
 * the change through, logged.
 */
export async function activityAllowed(actorId: string): Promise<boolean> {
  try {
    const { rateLimit } = await import("@/lib/rate-limit");
    const limit = await rateLimit(
      `site-activity:${actorId}`,
      SITE_ACTIVITY_RATE_LIMIT,
      SITE_ACTIVITY_RATE_WINDOW_SECONDS,
    );
    return limit.allowed;
  } catch (error) {
    console.error("[team] the activity limit failed; allowing the change:", error instanceof Error ? error.name : "unknown");
    return true;
  }
}
