import { z } from "zod";
import { clientEnv } from "@/lib/env/client";
import { invalidatePage } from "@/lib/publish/invalidate";
import { publishPageCore } from "@/lib/publish/core";
import { tenantOrigin } from "@/lib/publish/urls";
import { customOrigin } from "@/lib/routing/urls";
import { deferMediaCleanup } from "../commit";
import { MCP_SCOPES } from "../constants";
import { listPageDomains } from "../page-access";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, pageIdField } from "./common";
import { gateFailure } from "./publish-common";

const input = z.strictObject({ pageId: pageIdField });

export const publishPage: ToolDefinition<typeof input> = {
  name: "publish_page",
  title: "Publish a page",
  description:
    "Makes the saved draft live on the public page at once, replacing what visitors see. Only call it when the person has asked to publish. It publishes all changes: the design (theme, menu, profile) and every page of the site that changed since the last publish, including pages never published; pages that did not change keep their publish date. A menu item or page link that points at a page that is not live is hidden on the live site, never an error. It runs Publish's checks on every page and changes nothing when one fails: publish_refused with what to fix (naming the page), blocked_link, account_suspended or conflict. It publishes saved drafts only. Posts are published with publish_entry. Publishing again with no changes works. At most 10 publishes an hour. Returns the live address.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  publishesSite: true,
  async handler(_args, call) {
    const page = call.page!;
    const result = await publishPageCore(
      { pageId: page.id, userId: call.userId, source: "mcp" },
      { admin: call.admin },
    );
    if (!result.ok) throw gateFailure(result);

    // What the Server Action does, in the form a route handler may use: `updateTag` works in Server
    // Actions only, so the cache is expired with `revalidateTag(..., { expire: 0 })`.
    invalidatePage(page.id.toLowerCase());
    deferMediaCleanup(call, page.id);

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
