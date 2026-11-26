import { z } from "zod";
import { createEntry } from "@/lib/content";
import { suggestSlug } from "@/lib/posts/slug";
import { charCount, contentHash } from "../body-range";
import { MCP_SCOPES } from "../constants";
import { MESSAGES } from "../errors";
import { bodyOf } from "../post-view";
import { preparePostDraft } from "../post-write";
import type { ToolDefinition } from "../types";
import { WRITE_NOT_IDEMPOTENT, pageIdField } from "./common";
import {
  NOT_LIVE_UNTIL_PUBLISH,
  mcpActor,
  postFieldInputs,
  refusal,
  titleInput,
  typeField,
} from "./content-common";

const input = z.strictObject({
  pageId: pageIdField,
  type: typeField,
  title: titleInput,
  ...postFieldInputs,
});

export const createEntryTool: ToolDefinition<typeof input> = {
  name: "create_entry",
  title: "Create a post",
  description: `Creates a draft post on a site's blog from a title, and optionally slug (made from the title when left out), body (Markdown), excerpt, featuredImageId, ogImageId, seoTitle, seoDescription, noindex, categories and tags. ${NOT_LIVE_UNTIL_PUBLISH} Not idempotent: calling it twice makes two posts. The plan limits the posts a site holds, the trash included: at the limit the answer is plan_required. Returns id and rev: pass rev as ifRev to update_entry or publish_entry. Errors: type_disabled (turn the blog on with update_content_type), invalid_input (naming the field: a bad slug, a body over 512 KiB, a link or image that is not allowed, an unknown category or tag), blocked_link, image_not_found, plan_required, too_large, not_found.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_NOT_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const siteId = call.page!.id;
    const { pageId: _pageId, type, ...fields } = args;
    void _pageId;
    const draft = await preparePostDraft(
      call,
      siteId,
      {},
      {
        ...fields,
        body: fields.body ?? "",
      },
    );
    if (fields.slug === undefined) draft.slug = suggestSlug(String(draft.title ?? ""));
    const created = await createEntry({
      actor: mcpActor(call),
      siteId,
      typeKey: type,
      draft,
    });
    if (!created.ok) throw await refusal(call, created, { notFoundMessage: MESSAGES.not_found });
    const body = bodyOf(draft);
    return {
      sentence: `Created a draft post. ${NOT_LIVE_UNTIL_PUBLISH}`,
      data: {
        id: created.id,
        pageId: siteId,
        rev: created.rev,
        status: "draft",
        slug: draft.slug,
        bodyChars: charCount(body),
        contentHash: contentHash(body),
      },
      exact: true,
    };
  },
};
