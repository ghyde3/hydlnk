import { z } from "zod";
import { createTerm } from "@/lib/content";
import { termSlug } from "@/lib/posts/slug";
import { MCP_SCOPES } from "../constants";
import { cleanLine } from "../doc-view";
import { MESSAGES } from "../errors";
import type { ToolDefinition } from "../types";
import { WRITE_NOT_IDEMPOTENT, pageIdField } from "./common";
import { mcpActor, refusal, typeField } from "./content-common";

export const TERM_SLUG_TAKEN = "Another category or tag of this kind already uses that slug.";

const input = z.strictObject({
  pageId: pageIdField,
  type: typeField,
  taxonomy: z.enum(["category", "tag"]).describe("category or tag."),
  name: z
    .string()
    .max(80, { error: "Use 80 characters or fewer." })
    .describe("The name people see, 1 to 80 characters."),
  slug: z
    .string()
    .max(80)
    .optional()
    .describe(
      "The term's part of its address: lower-case letters, digits and hyphens. Leave it out to get one made from the name.",
    ),
  parentId: z
    .string()
    .max(64)
    .meta({ format: "uuid" })
    .optional()
    .describe(
      "For a category only: the id of a top-level category to put it under. One level deep.",
    ),
});

export const createTermTool: ToolDefinition<typeof input> = {
  name: "create_term",
  title: "Add a category or tag",
  description:
    "Adds a category or a tag to a site's blog. A category can sit under one top-level category (parentId); tags are flat. A new term is on no post yet and shows nowhere on the public site until a post that uses it is published: set a post's terms with update_entry. Not idempotent. A blog holds up to 500 categories and tags in all: at the limit the answer is limit_reached. Renaming and deleting change live pages at once, so rename_term and delete_term need the publish permission. Returns the term's id, name and slug. Errors: invalid_input (a name or slug that is not valid, or a slug already used), limit_reached, type_disabled, not_found.",
  scope: MCP_SCOPES.write,
  annotations: WRITE_NOT_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const siteId = call.page!.id;
    const name = cleanLine(args.name).trim();
    const made = await createTerm({
      actor: mcpActor(call),
      siteId,
      typeKey: args.type,
      taxonomy: args.taxonomy,
      name,
      slug: args.slug === undefined ? termSlug(name) : args.slug.trim(),
      ...(args.parentId !== undefined ? { parentId: args.parentId.toLowerCase() } : {}),
    });
    if (!made.ok) {
      throw await refusal(call, made, {
        notFoundMessage: MESSAGES.not_found,
        slugTakenMessage: TERM_SLUG_TAKEN,
      });
    }
    return {
      sentence: `Added the ${made.taxonomy}. Its name is in term.name.`,
      data: {
        pageId: siteId,
        term: {
          id: made.id,
          taxonomy: made.taxonomy,
          name: made.name,
          slug: made.slug,
          ...(made.parentId ? { parentId: made.parentId } : {}),
        },
      },
      exact: true,
    };
  },
};
