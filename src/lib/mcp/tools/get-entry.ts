import { z } from "zod";
import { listTypes, postDraftIssues } from "@/lib/content";
import { postHref } from "@/lib/blog/types";
import { storageUrl } from "@/lib/media/url";
import { tenantOrigin } from "@/lib/publish/urls";
import { MCP_BODY_RANGE_CHARS, MCP_SCOPES } from "../constants";
import { postView } from "../post-view";
import type { ToolCall, ToolDefinition } from "../types";
import { READ_ONLY } from "./common";
import {
  UNTRUSTED_CONTENT,
  entryIdField,
  entryPageIdField,
  lengthField,
  mcpActor,
  offsetField,
} from "./content-common";

const input = z.strictObject({
  entryId: entryIdField,
  pageId: entryPageIdField,
  offset: offsetField,
  length: lengthField,
});

/** Where a live post is, or null: the blog must be on and the post live. Built from the live slug only. */
export async function liveUrlOf(call: ToolCall): Promise<string | null> {
  const entry = call.entry!;
  if (entry.status !== "published" || entry.liveSlug === null) return null;
  const types = await listTypes({ actor: mcpActor(call), siteId: entry.siteId });
  if (!types.ok) return null;
  const type = types.types.find((item) => item.typeId === entry.typeId);
  if (!type || !type.enabled || type.archivePath === null) return null;
  const href = postHref(type.archivePath, entry.liveSlug);
  return href === null ? null : `${tenantOrigin(call.page!.handle)}${href}`;
}

export const getEntryTool: ToolDefinition<typeof input> = {
  name: "get_entry",
  title: "Get a post",
  description: `Reads one post's draft, which can differ from what is live: id, rev, status, hasUnpublishedChanges, title, slug, excerpt, featuredImageId, ogImageId, seoTitle, seoDescription, noindex, categories, tags, dates, liveUrl when it is live, publishIssues (most of what publish_entry would refuse) and imageUrlPrefix. The body is exact Markdown, never shortened, in ranges: body holds ${MCP_BODY_RANGE_CHARS} characters from offset by default, bodyChars is the whole length, and nextOffset is where to go on (null at the end). contentHash is the SHA-256 of the whole body in UTF-8, to check the joined ranges. A trashed post reads with status trashed. Pass rev as ifRev to writes. ${UNTRUSTED_CONTENT} Errors: not_found.`,
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "entry",
  entryTypes: ["post"],
  entryTrash: "any",
  allowDisabledType: true,
  needsDraft: true,
  async handler(args, call) {
    const entry = call.entry!;
    const view = postView(
      entry,
      { offset: args.offset ?? 0, length: args.length ?? MCP_BODY_RANGE_CHARS },
      {
        imageUrlPrefix: storageUrl(`${entry.ownerId}/`),
        liveUrl: await liveUrlOf(call),
        draftIssues:
          entry.status === "trashed"
            ? []
            : postDraftIssues({ ownerId: entry.ownerId, draft: entry.draft }),
      },
    );
    const more =
      view.nextOffset === null ? "" : " There is more of the body: pass nextOffset as offset.";
    return {
      sentence: `Read the draft of the post (${entry.status}).${more}`,
      data: view,
      exact: true,
    };
  },
};
