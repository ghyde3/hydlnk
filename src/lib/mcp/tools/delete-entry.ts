import { z } from "zod";
import { trashEntry } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT } from "./common";
import {
  entryIdField,
  entryPageIdField,
  entryRevField,
  cacheStaleOf,
  mcpActor,
  refusal,
  requireItemPublishBudget,
  requirePublish,
  requireRev,
} from "./content-common";

const input = z.strictObject({
  entryId: entryIdField,
  pageId: entryPageIdField,
  ifRev: entryRevField,
});

export const deleteEntryTool: ToolDefinition<typeof input> = {
  name: "delete_entry",
  title: "Move a post to the trash",
  description:
    "Moves a post to the trash. A draft post is only put away. A live post is taken off the public site at once, so for a live post the connection must also be allowed to publish, else the answer is insufficient_scope and the post stays live: only do that when the person has asked. Trashing a live post counts toward the 60 an hour of publish_entry. The trash keeps the post for 30 days (restore_entry brings it back as a draft), and a trashed post still counts toward the plan's posts. Pages cannot be trashed here: they are deleted in the app. ifRev is required; a post that changed since you read it answers conflict. Returns the new rev. Errors: not_found, conflict, insufficient_scope.",
  scope: MCP_SCOPES.write,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "entry",
  entryTypes: ["post"],
  async handler(args, call) {
    const entry = call.entry!;
    requireRev(call, args.ifRev);
    // Trashing a live post takes its live copy down: that is a change to what visitors see.
    const wasLive = entry.status === "published";
    if (wasLive) {
      requirePublish(call);
      // It changes what visitors see, so it draws on the per-item publish bucket as well.
      await requireItemPublishBudget(call);
    }
    const out = await trashEntry({
      actor: mcpActor(call),
      entryId: entry.id,
      expectedRev: args.ifRev,
    });
    if (!out.ok) throw await refusal(call, out);
    const stale = cacheStaleOf(out);
    return {
      sentence:
        (wasLive
          ? "Moved the post to the trash. It is no longer on the public site."
          : "Moved the post to the trash.") + stale.sentence,
      data: {
        id: entry.id,
        pageId: entry.siteId,
        rev: out.rev,
        status: "trashed",
        wasLive,
        ...stale.data,
      },
      exact: true,
    };
  },
};
