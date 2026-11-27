import "server-only";
import { activityAllowed } from "@/lib/team/activity-limit";
import { failure } from "./errors";
import type { ContentFailure } from "./types";

/**
 * The content writers' activity limit (team attack pass, finding 2): asked after the access check and
 * before the write by every writer that records site activity. `rate_limited` (429) past the limit.
 */
export async function activityLimited(access: { actorId: string }): Promise<ContentFailure | null> {
  return (await activityAllowed(access.actorId)) ? null : failure("rate_limited");
}
