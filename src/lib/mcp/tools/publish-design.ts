import { z } from "zod";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import { publishDesignCore } from "@/lib/publish/core";
import { invalidatePage } from "@/lib/publish/invalidate";
import { tenantOrigin } from "@/lib/publish/urls";
import { MCP_SCOPES } from "../constants";
import { readDraft } from "../doc-view";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, pageIdField } from "./common";
import { gateFailure } from "./publish-common";

const input = z.strictObject({
  pageId: pageIdField,
  // get_page prints designRev as a number; the gate compares its text. Both forms are taken. 0 is
  // a real designRev (a new site's design starts at rev 0 and can be live before it is edited);
  // null never is (get_page cannot read a design without a rev), so null is refused here rather
  // than reaching the gate, where it would match a design that has no rev.
  ifDesignRev: z
    .union([z.string().max(40), z.number().int().min(0)], {
      error: "ifDesignRev is required: designRev from get_page.",
    })
    .describe(
      "designRev from get_page (the page object of Home). If the design changed since, the call is refused with conflict and nothing is published.",
    ),
});

export const publishDesignTool: ToolDefinition<typeof input> = {
  name: "publish_design",
  title: "Publish the design",
  description:
    "Makes the site's design live at once: theme, menu and profile (and the banner and share card set in the app). No page and no post is published: their live copies stay as they are. Only call it when the person has asked to publish. ifDesignRev is required: designRev from get_page. The site must be live already: on a site that was never published the answer is publish_refused, and publish_page is the tool to call first. It runs Publish's checks on the design and changes nothing when one fails: publish_refused with what to fix, blocked_link, conflict or account_suspended. At most 60 an hour. Returns the new designRev and the live address. Errors also: not_found, insufficient_scope.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  changesLive: true,
  async handler(args, call) {
    const site = call.page!;
    const result = await publishDesignCore(
      {
        pageId: site.id,
        expectedRev: String(args.ifDesignRev),
        userId: call.userId,
      },
      { admin: call.admin },
    );
    if (!result.ok) throw gateFailure(result);
    // The cache is expired inside the handler (M10-31); only the media cleanup waits for the response.
    invalidatePage(site.id.toLowerCase());
    call.defer(() => cleanupMediaQuietly(call.userId, call.admin as never));
    // The design's rev after the publish, read the way get_page reads it.
    let designRev: unknown = args.ifDesignRev;
    try {
      const again = await call.deps.loadPage(call.userId, site.id, { withDraft: true });
      if (again.ok) designRev = readDraft(again.page.draft)?.rev ?? designRev;
    } catch {
      // The publish stands; the client reads the rev with get_page.
    }
    return {
      sentence: "Published the design. No page or post was published.",
      data: {
        published: true,
        pageId: site.id,
        designRev,
        publishedAt: result.publishedAt,
        url: tenantOrigin(site.handle),
      },
      exact: true,
    };
  },
};
