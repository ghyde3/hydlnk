import { z } from "zod";
import { listTerms } from "@/lib/content";
import { MCP_SCOPES } from "../constants";
import { MESSAGES } from "../errors";
import type { ToolDefinition } from "../types";
import { READ_ONLY, pageIdField } from "./common";
import { UNTRUSTED_CONTENT, mcpActor, refusal, typeField } from "./content-common";

const input = z.strictObject({ pageId: pageIdField, type: typeField });

export const listTermsTool: ToolDefinition<typeof input> = {
  name: "list_terms",
  title: "List categories and tags",
  description: `Lists the categories, then the tags, of a site's blog: id, name, slug, and for a category under another one its parentId. Pass the ids as categories and tags to create_entry and update_entry, or as termId to list_entries. A blog holds up to 500 categories and tags in all. ${UNTRUSTED_CONTENT} Errors: not_found.`,
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "one",
  async handler(args, call) {
    const siteId = call.page!.id;
    const found = await listTerms({ actor: mcpActor(call), siteId, typeKey: args.type });
    if (!found.ok) throw await refusal(call, found, { notFoundMessage: MESSAGES.not_found });
    const view = (kind: "category" | "tag") =>
      found.terms
        .filter((term) => term.taxonomy === kind)
        .map((term) => ({
          id: term.id,
          name: term.name,
          slug: term.slug,
          ...(term.parentId ? { parentId: term.parentId } : {}),
        }));
    const categories = view("category");
    const tags = view("tag");
    return {
      sentence: `${categories.length} ${categories.length === 1 ? "category" : "categories"} and ${tags.length} ${tags.length === 1 ? "tag" : "tags"}.`,
      data: { pageId: siteId, type: args.type, categories, tags },
      exact: true,
    };
  },
};
