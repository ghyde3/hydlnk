import { z } from "zod";
import { listRevisions } from "@/lib/content";
import { MCP_LIST_REVISIONS_MAX, MCP_SCOPES } from "../constants";
import type { ToolCall, ToolDefinition } from "../types";
import { READ_ONLY, subPageIdField } from "./common";
import { entryPageIdField, mcpActor, optionalEntryIdField, refusal } from "./content-common";

const input = z.strictObject({
  entryId: optionalEntryIdField,
  pageId: entryPageIdField,
  subPageId: subPageIdField,
});

/** How a result names the entry: a post by its id, a page by its site and sub-page. Never Home's entry id. */
export function entryNameOf(call: ToolCall): Record<string, unknown> {
  const entry = call.entry!;
  if (entry.typeKey === "post") return { type: "post", id: entry.id, pageId: entry.siteId };
  const isHome = call.page?.homeEntryId === entry.id;
  return { type: "page", pageId: entry.siteId, ...(isHome ? {} : { subPageId: entry.id }) };
}

export const listRevisionsTool: ToolDefinition<typeof input> = {
  name: "list_revisions",
  title: "List the saved versions of a post or page",
  description:
    "Lists the saved versions of one post or one page, newest first: revision (its number), createdAt, source (editor, mcp or system) and wasPublished (it was made live at that point). It never returns what a version holds. For a post pass entryId; for a page pass pageId, with subPageId for a page other than Home. rev is the entry's current rev: pass it as ifRev to restore_revision, with the revision to bring back. The plan decides how many versions are kept. Errors: not_found.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "entry",
  entryTypes: ["post", "page"],
  allowDisabledType: true,
  async handler(_args, call) {
    const entry = call.entry!;
    const found = await listRevisions({ actor: mcpActor(call), entryId: entry.id });
    if (!found.ok) throw await refusal(call, found);
    const revisions = found.revisions.slice(0, MCP_LIST_REVISIONS_MAX).map((item) => ({
      revision: item.rev,
      createdAt: item.createdAt,
      source: item.source,
      wasPublished: item.wasPublished,
    }));
    return {
      sentence: `${revisions.length} saved ${revisions.length === 1 ? "version" : "versions"}.`,
      data: {
        ...entryNameOf(call),
        rev: entry.rev,
        revisions,
        ...(found.revisions.length > revisions.length ? { more: true } : {}),
      },
      exact: true,
    };
  },
};
