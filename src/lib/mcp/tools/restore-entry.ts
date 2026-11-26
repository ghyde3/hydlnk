import { z } from "zod";
import { restoreEntry } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import type { ToolDefinition } from "../types";
import { WRITE_IDEMPOTENT } from "./common";
import {
  NOT_LIVE_UNTIL_PUBLISH,
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

export const restoreEntryTool: ToolDefinition<typeof input> = {
  name: "restore_entry",
  title: "Restore a post from the trash",
  description: `Brings a trashed post back as a draft, within 30 days of trashing it. It does not publish it again, even if it was live before. ${NOT_LIVE_UNTIL_PUBLISH} Find trashed posts with list_entries and status trashed. ifRev is required: the rev of the trashed post. Returns the new rev. Errors: not_found (not in the trash, or gone for good), conflict.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "entry",
  entryTypes: ["post"],
  entryTrash: "yes",
  async handler(args, call) {
    const entry = call.entry!;
    requireRev(call, args.ifRev);
    const out = await restoreEntry({
      actor: mcpActor(call),
      entryId: entry.id,
      expectedRev: args.ifRev,
    });
    if (!out.ok) throw await refusal(call, out);
    return {
      sentence: `Restored the post as a draft. ${NOT_LIVE_UNTIL_PUBLISH}`,
      data: { id: entry.id, pageId: entry.siteId, rev: out.rev, status: "draft" },
      exact: true,
    };
  },
};
