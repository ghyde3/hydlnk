/**
 * The bodies of the schedule routes (Wave E, M20-07): what the editor sends (`scheduleChange`,
 * `cancelScheduledChange` in src/lib/posts/client.ts take these types) and what the routes accept
 * (src/lib/schedule/routes-core.ts parses with these schemas). Pure and client-safe. The time's own
 * rule (a canonical UTC minute, a minute to 366 days ahead) is the content writer's and the
 * database's; here it is only a bounded string.
 */
import { z } from "zod";

export const SCHEDULE_ACTIONS = ["publish", "unpublish"] as const;

const rev = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const action = z.enum(SCHEDULE_ACTIONS);

/** DELETE {rev, action}: cancel the pending row of that action at the rev the editor holds. */
export const cancelScheduleBody = z.object({ rev, action });

/** POST {rev, action, runAt}: schedule (or reschedule) at `runAt`, a UTC instant. */
export const scheduleBody = cancelScheduleBody.extend({ runAt: z.string().max(40) });

export type CancelScheduleRequest = z.infer<typeof cancelScheduleBody>;
export type ScheduleRequest = z.infer<typeof scheduleBody>;
