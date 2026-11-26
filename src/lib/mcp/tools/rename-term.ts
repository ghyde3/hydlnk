import { z } from "zod";
import { renameTerm } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import { cleanLine } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolDefinition } from "../types";
import { DESTRUCTIVE_IDEMPOTENT, pageIdField } from "./common";
import { mcpActor, refusal } from "./content-common";
import { TERM_SLUG_TAKEN } from "./create-term";

const input = z.strictObject({
  pageId: pageIdField,
  termId: z
    .string()
    .max(64)
    .meta({ format: "uuid" })
    .describe("The category's or tag's id from list_terms."),
  name: z
    .string()
    .max(80, { error: "Use 80 characters or fewer." })
    .optional()
    .describe("The new name, 1 to 80 characters."),
  slug: z
    .string()
    .max(80)
    .optional()
    .describe(
      "The new slug: lower-case letters, digits and hyphens. It changes the term's address.",
    ),
});

export const renameTermTool: ToolDefinition<typeof input> = {
  name: "rename_term",
  title: "Rename a category or tag",
  description:
    "Changes the name or the slug of a category or tag. This changes the live site at once, with no publish step: the name on every live post and term page, and with a new slug the address of the term's page (the old address stops working). So it needs the publish permission: only call it when the person has asked. Send name, slug or both. At most 60 an hour. Returns the term. Errors: not_found, invalid_input (a name or slug that is not valid, or a slug already used), insufficient_scope.",
  scope: MCP_SCOPES.publish,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  changesLive: true,
  async handler(args, call) {
    if (args.name === undefined && args.slug === undefined) {
      throw new ToolFailure("invalid_input", MESSAGES.nothingToChange);
    }
    const siteId = call.page!.id;
    const out = await renameTerm({
      actor: mcpActor(call),
      siteId,
      termId: args.termId.toLowerCase(),
      ...(args.name !== undefined ? { name: cleanLine(args.name).trim() } : {}),
      ...(args.slug !== undefined ? { slug: args.slug.trim() } : {}),
    });
    if (!out.ok) {
      throw await refusal(call, out, {
        notFoundMessage: MESSAGES.term_not_found,
        slugTakenMessage: TERM_SLUG_TAKEN,
      });
    }
    return {
      sentence: `Renamed the ${out.taxonomy}. It is “${out.name}” on the live site now.`,
      data: {
        pageId: siteId,
        term: { id: out.id, taxonomy: out.taxonomy, name: out.name, slug: out.slug },
      },
      exact: true,
    };
  },
};
