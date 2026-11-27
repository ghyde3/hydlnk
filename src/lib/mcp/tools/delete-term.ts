import { z } from "zod";
import { deleteTerm } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import { MESSAGES } from "../errors";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, pageIdField } from "./common";
import { mcpActor, refusal } from "./content-common";

const input = z.strictObject({
  pageId: pageIdField,
  termId: z
    .string()
    .max(64)
    .meta({ format: "uuid" })
    .describe("The category's or tag's id from list_terms."),
});

export const deleteTermTool: ToolDefinition<typeof input> = {
  name: "delete_term",
  title: "Delete a category or tag",
  description:
    "Deletes a category or tag for good. This changes the live site at once, with no publish step: the term's page is gone, live posts stop showing it, and categories under a deleted category become top-level. So it needs the publish permission: only call it when the person has asked. The posts themselves are kept. It cannot be undone from here. At most 60 an hour. Errors: not_found, insufficient_scope.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  changesLive: true,
  async handler(args, call) {
    const siteId = call.page!.id;
    const out = await deleteTerm({
      actor: mcpActor(call),
      siteId,
      termId: args.termId.toLowerCase(),
    });
    if (!out.ok) throw await refusal(call, out, { notFoundMessage: MESSAGES.term_not_found });
    return {
      sentence: "Deleted the term. It is off the live site now.",
      data: { pageId: siteId, deleted: true, termId: out.id },
      exact: true,
    };
  },
};
