import { z } from "zod";
import { LIMITS } from "@/lib/document";
import { handleAddress } from "@/lib/pages/plans";
import { MCP_SCOPES } from "../constants";
import {
  alsoSetInTheApp,
  blockPhrase,
  blockView,
  profileView,
  publishIssues,
  publishStatusOf,
  readDraft,
  themeView,
} from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import { loadThemeTokens, PageReadError } from "../page-access";
import type { ToolDefinition } from "../types";
import { READ_ONLY, pageIdField } from "./common";

const input = z.strictObject({
  pageId: pageIdField,
  blockId: z
    .string()
    .max(40)
    .optional()
    .describe("Return only this block, in full. Leave it out to get the whole page."),
});

export const getPage: ToolDefinition<typeof input> = {
  name: "get_page",
  title: "Get a page",
  description:
    "Reads the draft of one page, which can differ from what is live. Returns page (id, rev, publishStatus, hasUnpublishedChanges, publishedAt), profile, theme (including how the page looks now), blocks in order, limits, publishIssues (what Publish would refuse, in plain words) and alsoSetInTheApp (settings no tool can change). Each block has an id, a type, visible and the same fields add_block takes. This is the only way to learn block ids and image ids. Pass blockId to read one block in full. Pass rev as ifRev to later writes. Errors: not_found, block_not_found.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "one",
  needsDraft: true,
  async handler(args, call) {
    const page = call.page!;
    const draft = readDraft(page.draft);
    if (!draft) throw new ToolFailure("server_error", MESSAGES.draftUnreadable);

    let theme;
    try {
      theme = await loadThemeTokens(call.admin, call.userId, draft.theme.ref);
    } catch (error) {
      if (error instanceof PageReadError)
        throw new ToolFailure("server_error", MESSAGES.serverError);
      throw error;
    }
    const publishStatus = publishStatusOf({
      draft,
      published: page.published,
      publishedAt: page.publishedAt,
      themeTokens: theme?.tokens ?? null,
    });
    const header = {
      id: page.id,
      name: page.name,
      handle: page.handle,
      address: handleAddress(page.handle),
      publishStatus,
      hasUnpublishedChanges: publishStatus !== "published",
      publishedAt: page.publishedAt,
      rev: draft.rev,
    };

    if (args.blockId !== undefined) {
      const block = draft.blocks.find((item) => item.id === args.blockId);
      if (!block) {
        throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
      }
      return {
        sentence: `Here is ${blockPhrase(block.type)}.`,
        data: { page: { id: page.id, rev: draft.rev }, block: blockView(block) },
      };
    }

    const blocks = draft.blocks.map(blockView);
    const words =
      publishStatus === "published"
        ? "The draft matches the live page."
        : publishStatus === "not-published"
          ? "The page isn’t published yet."
          : "The draft has changes that aren’t live.";
    return {
      sentence: `Read the draft of ${handleAddress(page.handle)}: ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}. ${words}`,
      data: {
        page: header,
        profile: profileView(draft.profile),
        theme: themeView(draft.theme, theme),
        blocks,
        limits: { blocks: { used: blocks.length, max: LIMITS.blocks } },
        publishIssues: publishIssues(page.draft),
        alsoSetInTheApp: alsoSetInTheApp(draft),
      },
    };
  },
};
