import { z } from "zod";
import { listEntries } from "@/lib/content";
import { LIST_SORTS, LIST_STATUSES } from "@/lib/content/schemas";
import { contentHash } from "../body-range";
import { MCP_LIST_ENTRIES_MAX, MCP_SCOPES } from "../constants";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolDefinition } from "../types";
import { READ_ONLY, pageIdField } from "./common";
import { UNTRUSTED_CONTENT, mcpActor, refusal, typeField } from "./content-common";

const DEFAULT_LIMIT = 20;
const BAD_CURSOR = "That cursor is not from this list. Call list_entries again without it.";

const input = z.strictObject({
  pageId: pageIdField,
  type: typeField,
  status: z
    .enum(LIST_STATUSES)
    .optional()
    .describe(
      "Only drafts, only live posts, or only the trash. Leave it out for drafts and live posts.",
    ),
  termId: z
    .string()
    .max(64)
    .meta({ format: "uuid" })
    .optional()
    .describe("Only posts whose live copy is in this category or tag (an id from list_terms)."),
  q: z
    .string()
    .max(200, { error: "Use 200 characters or fewer." })
    .optional()
    .describe("Only posts whose title contains this text."),
  sort: z.enum(LIST_SORTS).optional().describe("published_at (the default), updated_at or title."),
  order: z
    .enum(["asc", "desc"])
    .optional()
    .describe("asc or desc. Titles default to asc, dates to desc."),
  cursor: z
    .string()
    .max(4100)
    .optional()
    .describe(
      "nextCursor from the call before, with the same filters and sort, to get the next posts.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_LIST_ENTRIES_MAX)
    .optional()
    .describe(
      `How many posts to return: ${DEFAULT_LIMIT} by default, at most ${MCP_LIST_ENTRIES_MAX}.`,
    ),
});

/**
 * A cursor is bound to the list it came from: the site, the type and the sort. One from another
 * list is refused, so a position in one site's posts is never applied to another's.
 */
const listKey = (parts: readonly string[]) => contentHash(parts.join("\n")).slice(0, 16);

export const listEntriesTool: ToolDefinition<typeof input> = {
  name: "list_entries",
  title: "List posts",
  description: `Lists a site's posts, a page at a time: id, rev, status (draft, published or trashed), title, slug, publishedAt, createdAt, updatedAt and hasUnpublishedChanges (a live post whose draft differs from what is live). It never returns a body: read one post with get_entry. Filter by status, termId or q (text in the title), sort by published_at, updated_at or title, and pass nextCursor as cursor for more. Posts of a blog that is off are still listed. ${UNTRUSTED_CONTENT} Errors: not_found, invalid_input.`,
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "one",
  async handler(args, call) {
    const siteId = call.page!.id;
    const sort = args.sort ?? "published_at";
    const order = args.order ?? (sort === "title" ? "asc" : "desc");
    const key = listKey([siteId, args.type, sort, order]);
    let cursor: string | undefined;
    if (args.cursor !== undefined) {
      const [prefix, rest] = args.cursor.split(".");
      if (prefix !== key || rest === undefined || rest === "") {
        throw new ToolFailure("invalid_input", BAD_CURSOR, {
          issues: [{ path: "cursor", message: BAD_CURSOR }],
        });
      }
      cursor = rest;
    }
    const found = await listEntries({
      actor: mcpActor(call),
      siteId,
      typeKey: args.type,
      sort,
      order,
      limit: args.limit ?? DEFAULT_LIMIT,
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.termId !== undefined ? { termId: args.termId } : {}),
      ...(args.q !== undefined && args.q !== "" ? { q: args.q } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (!found.ok) {
      if (found.error === "invalid") {
        // The writer names one thing at a time: an unknown term, or a cursor it cannot read.
        const path = /cursor/i.test(found.message) ? "cursor" : "termId";
        const message = path === "cursor" ? BAD_CURSOR : "That is not a category or tag id.";
        throw new ToolFailure("invalid_input", message, { issues: [{ path, message }] });
      }
      throw await refusal(call, found, { notFoundMessage: MESSAGES.not_found });
    }
    const entries = found.items.map((item) => ({
      id: item.id,
      rev: item.rev,
      status: item.status,
      title: item.title ?? "",
      slug: item.slug ?? "",
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}),
      hasUnpublishedChanges: item.hasUnpublishedChanges,
    }));
    const nextCursor = found.nextCursor === null ? null : `${key}.${found.nextCursor}`;
    return {
      sentence: `${entries.length} ${entries.length === 1 ? "post" : "posts"}${nextCursor ? ", and there are more" : ""}.`,
      data: { pageId: siteId, type: args.type, entries, nextCursor },
      exact: true,
    };
  },
};
