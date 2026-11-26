import { z } from "zod";
import { publishEntry } from "@/lib/content";
import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";
import { publishSitePageCore } from "@/lib/publish/core";
import { invalidatePage } from "@/lib/publish/invalidate";
import { tenantOrigin } from "@/lib/publish/urls";
import { MCP_SCOPES } from "../constants";
import { MESSAGES } from "../errors";
import type { OwnedEntry, ToolCall, ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, subPageIdField } from "./common";
import {
  entryPageIdField,
  entryRevField,
  mcpActor,
  optionalEntryIdField,
  refusal,
  requireRev,
} from "./content-common";
import { liveUrlOf } from "./get-entry";
import { gateFailure } from "./publish-common";

const input = z.strictObject({
  entryId: optionalEntryIdField,
  pageId: entryPageIdField,
  subPageId: subPageIdField,
  ifRev: entryRevField,
});

/** One page through the Publish gate: Home's entry or a sub-page's, and nothing else of the site. */
async function publishOnePage(call: ToolCall, entry: OwnedEntry, ifRev: number) {
  const site = call.page!;
  const result = await publishSitePageCore(
    {
      pageId: site.id,
      entryId: entry.id,
      expectedRev: ifRev,
      userId: call.userId,
      source: "mcp",
    },
    { admin: call.admin },
  );
  if (!result.ok) throw gateFailure(result, { notFound: MESSAGES.entry_not_found });
  // The cache is expired inside the handler (M10-31); only the media cleanup waits for the response.
  invalidatePage(site.id.toLowerCase());
  call.defer(() => cleanupMediaQuietly(call.userId, call.admin as never));
  // Home's entry id is never printed: Home is named by its site.
  const isHome = site.homeEntryId === entry.id;
  return {
    sentence: "Published that page. Nothing else of the site changed.",
    data: {
      published: true,
      type: "page",
      pageId: site.id,
      ...(isHome ? {} : { subPageId: entry.id }),
      rev: result.rev,
      publishedAt: result.publishedAt,
      url: tenantOrigin(site.handle),
    },
    exact: true as const,
  };
}

export const publishEntryTool: ToolDefinition<typeof input> = {
  name: "publish_entry",
  title: "Publish one post or page",
  description:
    "Makes ONE post or ONE page live at once, replacing what visitors see of it, and nothing else: the design, every other page and every other post stay as they are. Only call it when the person has asked to publish. For a post pass entryId; for a page pass pageId, with subPageId for a page other than Home. ifRev is required: the rev you last read (get_entry for a post, get_page for a page). It runs Publish's checks and changes nothing when one fails: publish_refused with what to fix (a missing title, a bad slug, an image that is not an upload, or a site that is not live yet: call publish_page first), blocked_link, conflict, account_suspended or type_disabled. At most 60 an hour. Returns the new rev and the live address. Errors also: not_found, insufficient_scope.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "entry",
  entryTypes: ["post", "page"],
  changesLive: true,
  async handler(args, call) {
    const entry = call.entry!;
    // A page goes through the Publish gate and never through the writer's publish of a post.
    if (entry.typeKey === "page") return publishOnePage(call, entry, args.ifRev);

    requireRev(call, args.ifRev);
    const out = await publishEntry({
      actor: mcpActor(call),
      entryId: entry.id,
      expectedRev: args.ifRev,
    });
    if (!out.ok) throw await refusal(call, out, { publish: true });
    // The live address is read after the publish: the slug that is live now.
    let url: string | null = null;
    const now = await call.deps.loadEntry(call.userId, entry.id, {
      types: ["post"],
      trashed: "no",
      allowDisabledType: true,
      withDraft: false,
    });
    if (now.ok) url = await liveUrlOf({ ...call, entry: now.entry });
    return {
      sentence: url
        ? `Published the post. It is live at ${url}.`
        : "Published the post. Nothing else of the site changed.",
      data: {
        published: true,
        type: "post",
        id: entry.id,
        pageId: entry.siteId,
        rev: out.rev,
        publishedAt: out.publishedAt,
        ...(url ? { url } : {}),
      },
      exact: true,
    };
  },
};
