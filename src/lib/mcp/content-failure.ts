import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
import { blockedPublishMessage } from "@/lib/blocklist/messages";
import type { ContentFailure } from "@/lib/content";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import type { PlanId } from "@/lib/limits";
import { SITE_ACTIVITY_RATE_WINDOW_SECONDS } from "@/lib/team/activity-limit";
import { TERM_LIMIT_MESSAGE, postLimitMessage } from "@/lib/limits/messages";
import { MESSAGES, ToolFailure, rateLimitedMessage, type ToolIssue } from "./errors";
import { boundIssues } from "./result";

/**
 * A refusal of the content writer as a tool failure (M18, plan 3.6). One mapping for every content
 * tool, so a code means the same thing everywhere and nothing of the writer's own state leaks: a
 * `conflict` carries no rev (the client must read again before it writes again), and an unexpected
 * failure is `server_error` with our sentence, never the writer's text.
 */

export interface FailureContext {
  /** Where a slug problem is reported (`slug` by default). */
  slugPath?: string;
  /** The sentence for a slug that is taken, when the writer's does not fit (a term's slug). */
  slugTakenMessage?: string;
  /** The call was a publish: a content problem is `publish_refused`, not `invalid_input`. */
  publish?: boolean;
  /** The account's plan, for the sentence of a post limit. */
  plan?: PlanId;
  /** The sentence of a `conflict` (the entry sentence by default; a page names get_page). */
  conflictMessage?: string;
  /** The sentence of a `not_found` (the entry sentence by default). */
  notFoundMessage?: string;
}

function issuesOf(failure: ContentFailure): ToolIssue[] {
  return boundIssues(
    (failure.issues ?? []).map((issue) => ({
      path: String(issue.path),
      message: String(issue.message),
    })),
  );
}

export function contentFailure(failure: ContentFailure, where: FailureContext = {}): ToolFailure {
  switch (failure.error) {
    // `forbidden` is a member's refusal; a token reaches only its user's own sites (decide rule 2),
    // so it answers exactly like a missing id, as the Publish gate's mapping does. `access_lost`
    // only comes from a scheduled fire (never a tool), and reads the same.
    case "not_found":
    case "forbidden":
    case "access_lost":
      return new ToolFailure("not_found", where.notFoundMessage ?? MESSAGES.entry_not_found);
    // The writers' activity limit (team access: 30 recorded changes a minute per actor).
    case "rate_limited":
      return new ToolFailure("rate_limited", rateLimitedMessage(SITE_ACTIVITY_RATE_WINDOW_SECONDS), {
        retryAfterSeconds: SITE_ACTIVITY_RATE_WINDOW_SECONDS,
      });
    case "conflict":
      return new ToolFailure("conflict", where.conflictMessage ?? MESSAGES.entryConflict);
    case "account_suspended":
      return new ToolFailure("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
    case "type_disabled":
      return new ToolFailure("type_disabled", MESSAGES.blogOff);
    case "invalid": {
      const issues = issuesOf(failure);
      if (where.publish) {
        const first = issues
          .slice(0, 4)
          .map((issue) => issue.message)
          .join(" ");
        return new ToolFailure(
          "publish_refused",
          `Publishing stopped. ${first || failure.message}`.slice(0, 600),
          issues.length > 0 ? { issues } : {},
        );
      }
      return new ToolFailure(
        "invalid_input",
        failure.message.slice(0, 200),
        issues.length > 0 ? { issues } : {},
      );
    }
    case "blocked_link": {
      const hosts = (failure.hosts ?? []).slice(0, 20).map((host) => String(host).slice(0, 120));
      return new ToolFailure(
        "blocked_link",
        where.publish && hosts.length > 0 ? blockedPublishMessage(hosts) : MESSAGES.blocked_link,
        { details: { hosts } },
      );
    }
    case "entry_limit":
    case "page_limit":
      return new ToolFailure(
        "plan_required",
        failure.error === "entry_limit" && where.plan
          ? postLimitMessage(where.plan)
          : MESSAGES.postLimit,
      );
    case "term_limit":
      return new ToolFailure("limit_reached", TERM_LIMIT_MESSAGE);
    case "storage_full":
      return new ToolFailure("too_large", STORAGE_FULL_MESSAGE);
    case "too_large":
      return new ToolFailure("too_large", MESSAGES.entryTooLarge);
    case "slug_taken":
    case "slug_reserved": {
      const message =
        failure.error === "slug_taken" && where.slugTakenMessage
          ? where.slugTakenMessage
          : failure.message.slice(0, 200);
      // At Publish a slug another post already uses is one of Publish's refusals (M18-08 step 2).
      if (where.publish) {
        return new ToolFailure("publish_refused", `Publishing stopped. ${message}`.slice(0, 600), {
          issues: [{ path: where.slugPath ?? "slug", message }],
        });
      }
      return new ToolFailure("invalid_input", message, {
        issues: [{ path: where.slugPath ?? "slug", message }],
      });
    }
    case "path_taken": {
      const message = failure.message.slice(0, 200);
      return new ToolFailure("invalid_input", message, {
        issues: [{ path: "archivePath", message }],
      });
    }
    default:
      return new ToolFailure("server_error", MESSAGES.serverError);
  }
}
