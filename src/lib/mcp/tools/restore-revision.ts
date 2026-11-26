import { z } from "zod";
import { restoreRevision } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import { MESSAGES } from "../errors";
import type { ToolDefinition } from "../types";
import { WRITE_IDEMPOTENT, subPageIdField } from "./common";
import {
  entryPageIdField,
  entryRevField,
  mcpActor,
  optionalEntryIdField,
  refusal,
} from "./content-common";
import { entryNameOf } from "./list-revisions";

const REVISION_NOT_FOUND = "We couldn’t find that version. Call list_revisions.";

const input = z.strictObject({
  entryId: optionalEntryIdField,
  pageId: entryPageIdField,
  subPageId: subPageIdField,
  revision: z
    .number()
    .int()
    .min(0)
    .describe("The number of the version to bring back, from list_revisions."),
  ifRev: entryRevField,
});

export const restoreRevisionTool: ToolDefinition<typeof input> = {
  name: "restore_revision",
  title: "Bring back a saved version",
  description:
    "Saves an earlier version of one post or one page as its draft. Changes the draft only: nothing is published, and the live copy stays as it is until publish_entry (or publish_page). The draft it replaces is kept as a version of its own, so this can be undone the same way. For a post pass entryId; for a page pass pageId, with subPageId for a page other than Home. revision is a number from list_revisions; ifRev is required: the entry's current rev (list_revisions, get_entry or get_page). Returns the new rev; unchanged true when the draft already was that version. Errors: not_found (no such version), conflict, invalid_input, blocked_link, type_disabled.",
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "entry",
  entryTypes: ["post", "page"],
  async handler(args, call) {
    const entry = call.entry!;
    const out = await restoreRevision({
      actor: mcpActor(call),
      entryId: entry.id,
      rev: args.revision,
      expectedRev: args.ifRev,
    });
    if (!out.ok) {
      throw await refusal(call, out, {
        notFoundMessage: REVISION_NOT_FOUND,
        // A page is read again with get_page, a post with get_entry.
        ...(entry.typeKey === "page" ? { conflictMessage: MESSAGES.conflict } : {}),
      });
    }
    return {
      sentence: out.unchanged
        ? "Nothing changed: the draft already is that version."
        : "Brought that version back as the draft. Nothing was published.",
      data: { ...entryNameOf(call), rev: out.rev, unchanged: out.unchanged },
      exact: true,
    };
  },
};
