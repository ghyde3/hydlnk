import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
import { blockedHostsOf } from "@/lib/blocklist/check";
import { blockedPublishMessage } from "@/lib/blocklist/messages";
import { STORAGE_FULL_MESSAGE } from "@/lib/editor/messages";
import type { PublishError } from "@/lib/document";
import { MESSAGES, ToolFailure, rateLimitedMessage, type ToolIssue } from "../errors";

/**
 * A refusal of the Publish gate (`src/lib/publish/core.ts`) as a tool failure. One mapping for
 * `publish_page`, `publish_entry` on a page and `publish_design`, so the gate's reasons read the
 * same from each of them. Nothing here publishes.
 */

/** What the gate says on a site that was never published; the tools name the tool that fixes it. */
const SITE_NOT_LIVE = "This site isn’t live yet.";
export const SITE_NOT_LIVE_TOOL_MESSAGE =
  "This site isn’t live yet. Call publish_page first: it publishes all changes of the site.";

interface GateRefusal {
  ok: false;
  errors: PublishError[];
  reason?: string | undefined;
}

export function gateFailure(
  result: GateRefusal,
  words: { conflict?: string; notFound?: string } = {},
): ToolFailure {
  // Read as a plain string: the gate's reasons grow (M15-10 added `conflict`), the tool's codes do not.
  const reason: string | undefined = result.reason;
  switch (reason) {
    case "invalid": {
      const errors = result.errors.slice(0, 20).map((error) => ({
        ...error,
        message: (error.message.startsWith(SITE_NOT_LIVE)
          ? SITE_NOT_LIVE_TOOL_MESSAGE
          : error.message
        ).slice(0, 200),
      }));
      // One sentence per kind of problem, with how many places it is in; the list has the places.
      const counts = new Map<string, number>();
      for (const error of errors) counts.set(error.message, (counts.get(error.message) ?? 0) + 1);
      const kinds = [...counts.entries()];
      const first = kinds
        .slice(0, 4)
        .map(([message, count]) => (count > 1 ? `${message} (${count} places)` : message))
        .join(" ");
      const issues: ToolIssue[] = errors.map((error) => ({
        path: error.blockId ? `${error.blockId}:${error.field}` : error.field,
        message: error.message,
      }));
      return new ToolFailure(
        "publish_refused",
        `Publishing stopped. ${first}${kinds.length > 4 ? ` And ${kinds.length - 4} more kinds of problem.` : ""}`,
        { issues },
      );
    }
    case "blocked_link": {
      const hosts = blockedHostsOf(result.errors);
      return new ToolFailure("blocked_link", blockedPublishMessage(hosts, result.errors.length), {
        details: { hosts },
      });
    }
    case "account_suspended":
      return new ToolFailure("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
    // A draft that changed under the gate.
    case "conflict":
      return new ToolFailure("conflict", words.conflict ?? MESSAGES.conflict);
    case "rate_limited":
      return new ToolFailure("rate_limited", rateLimitedMessage(60), { retryAfterSeconds: 60 });
    case "storage_full":
      return new ToolFailure("too_large", STORAGE_FULL_MESSAGE);
    case "not_found":
    case "forbidden":
    case "access_lost":
    case "unauthorized":
      return new ToolFailure("not_found", words.notFound ?? MESSAGES.not_found);
    default:
      return new ToolFailure("server_error", MESSAGES.serverError);
  }
}
