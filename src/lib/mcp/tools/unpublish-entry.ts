import { z } from "zod";
import { unpublishEntry } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT } from "./common";
import {
  entryIdField,
  entryPageIdField,
  entryRevField,
  mcpActor,
  refusal,
  requireRev,
} from "./content-common";

const input = z.strictObject({
  entryId: entryIdField,
  pageId: entryPageIdField,
  ifRev: entryRevField,
});

export const unpublishEntryTool: ToolDefinition<typeof input> = {
  name: "unpublish_entry",
  title: "Take a post off the site",
  description:
    "Takes ONE live post off the public site at once and keeps its draft, so it can be published again later. Only call it when the person has asked. It works for posts only (a page is taken down in the app), and also after the blog was turned off. ifRev is required: the rev from get_entry. Nothing else of the site changes. At most 60 an hour. Returns the new rev. Errors: not_found, conflict, account_suspended, insufficient_scope.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "entry",
  entryTypes: ["post"],
  allowDisabledType: true,
  changesLive: true,
  async handler(args, call) {
    const entry = call.entry!;
    requireRev(call, args.ifRev);
    const out = await unpublishEntry({
      actor: mcpActor(call),
      entryId: entry.id,
      expectedRev: args.ifRev,
    });
    if (!out.ok) throw await refusal(call, out);
    return {
      sentence: "The post is off the public site. Its draft is kept.",
      data: { id: entry.id, pageId: entry.siteId, rev: out.rev, status: "draft", published: false },
      exact: true,
    };
  },
};
