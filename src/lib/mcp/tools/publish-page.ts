import { z } from "zod";
import { ACCOUNT_SUSPENDED_MESSAGE } from "@/lib/admin/suspension";
import { blockedHostsOf } from "@/lib/blocklist/check";
import { blockedPublishMessage } from "@/lib/blocklist/messages";
import { clientEnv } from "@/lib/env/client";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import { invalidatePage } from "@/lib/publish/invalidate";
import { publishPageCore } from "@/lib/publish/core";
import { tenantOrigin } from "@/lib/publish/urls";
import { customOrigin } from "@/lib/routing/urls";
import { MCP_SCOPES } from "../constants";
import { MESSAGES, ToolFailure, type ToolIssue } from "../errors";
import { listPageDomains } from "../page-access";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, pageIdField } from "./common";

const input = z.strictObject({ pageId: pageIdField });

export const publishPage: ToolDefinition<typeof input> = {
  name: "publish_page",
  title: "Publish a page",
  description:
    "Makes the saved draft live on the public page at once, replacing what visitors see. Only call it when the person has asked to publish. It publishes all changes: the design (theme, menu, profile) and every page of the site that changed since the last publish, including pages never published; pages that did not change keep their publish date. A menu item or page link that points at a page that is not live is hidden on the live site, never an error. It runs the Publish button's checks on every page and changes nothing when one fails: publish_refused with a list of what to fix (naming the page), blocked_link, account_suspended or conflict. It publishes saved drafts, not unsaved typing in the editor. Publishing again with no changes works. At most 10 publishes an hour. Returns the live address.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  async handler(_args, call) {
    const page = call.page!;
    const result = await publishPageCore(
      { pageId: page.id, userId: call.userId },
      { admin: call.admin },
    );
    if (!result.ok) {
      // Read as a plain string: the gate's reasons grow (M15-10 added `conflict`), the tool's codes do not.
      const reason: string | undefined = result.reason;
      switch (reason) {
        case "invalid": {
          const issues: ToolIssue[] = result.errors.slice(0, 20).map((error) => ({
            path: error.blockId ? `blocks.${error.blockId}.${error.field}` : error.field,
            message: error.message.slice(0, 200),
          }));
          // One sentence per kind of problem, with how many places it is in; the list has the places.
          const counts = new Map<string, number>();
          for (const issue of issues)
            counts.set(issue.message, (counts.get(issue.message) ?? 0) + 1);
          const kinds = [...counts.entries()];
          const first = kinds
            .slice(0, 4)
            .map(([message, count]) => (count > 1 ? `${message} (${count} places)` : message))
            .join(" ");
          throw new ToolFailure(
            "publish_refused",
            `Publishing stopped. ${first}${kinds.length > 4 ? ` And ${kinds.length - 4} more kinds of problem.` : ""}`,
            {
              issues: result.errors.slice(0, 20).map((error) => ({
                path: error.blockId ? `${error.blockId}:${error.field}` : error.field,
                message: error.message.slice(0, 200),
              })),
            },
          );
        }
        case "blocked_link": {
          const hosts = blockedHostsOf(result.errors);
          throw new ToolFailure(
            "blocked_link",
            blockedPublishMessage(hosts, result.errors.length),
            { details: { hosts } },
          );
        }
        case "account_suspended":
          throw new ToolFailure("account_suspended", ACCOUNT_SUSPENDED_MESSAGE);
        // A draft that changed under the gate. This tool sends no expected revs, so the gate has
        // nothing to compare today; the code is mapped all the same, never left to `server_error`.
        case "conflict":
          throw new ToolFailure("conflict", MESSAGES.conflict);
        case "forbidden":
        case "unauthorized":
          throw new ToolFailure("not_found", MESSAGES.not_found);
        default:
          throw new ToolFailure("server_error", MESSAGES.serverError);
      }
    }

    // What the Server Action does, in the form a route handler may use: `updateTag` works in Server
    // Actions only, so the cache is expired with `revalidateTag(..., { expire: 0 })`.
    invalidatePage(page.id.toLowerCase());
    call.defer(() => cleanupMediaQuietly(call.userId, call.admin as never));

    const url = tenantOrigin(page.handle);
    let custom: string[] = [];
    try {
      custom = (await listPageDomains(call.admin, [page.id]))
        .filter((domain) => domain.status === "verified")
        .map((domain) => customOrigin(domain.hostname, clientEnv.NEXT_PUBLIC_ROOT_DOMAIN));
    } catch {
      custom = [];
    }
    return {
      sentence: `Published. Your page is live at ${url}.${custom.length > 0 ? ` It is also at ${custom.join(", ")}.` : ""}`,
      data: {
        published: true,
        publishedAt: result.publishedAt,
        url,
        ...(custom.length > 0 ? { customDomainUrls: custom } : {}),
      },
    };
  },
};
