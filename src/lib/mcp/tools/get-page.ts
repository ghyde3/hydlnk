import { z } from "zod";
import { LIMITS } from "@/lib/document";
import { handleAddress } from "@/lib/pages/plans";
import { resolveNav } from "@/lib/document";
import { MCP_SCOPES } from "../constants";
import {
  alsoSetInTheApp,
  blockPhrase,
  blockView,
  profileView,
  publishIssues,
  homeStatusesOf,
  readDraft,
  readSubPageDraft,
  subPagePublishIssues,
  subPageStatusOf,
  themeView,
} from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import { loadThemeTokens, PageReadError } from "../page-access";
import type { ToolCall, ToolDefinition } from "../types";
import { READ_ONLY, pageIdField, subPageIdField } from "./common";

const input = z.strictObject({
  pageId: pageIdField,
  subPageId: subPageIdField,
  blockId: z
    .string()
    .max(40)
    .optional()
    .describe("Return only this block, in full. Leave it out to get the whole page."),
});

/** One page of the site other than Home: its own draft, rev and state; the profile and theme are Home's. */
async function readSubPage(
  args: { blockId?: string | undefined },
  subPage: NonNullable<ToolCall["subPage"]>,
  site: NonNullable<ToolCall["page"]>,
) {
  const draft = readSubPageDraft(subPage.draft);
  if (!draft) throw new ToolFailure("server_error", MESSAGES.draftUnreadable);
  const home = readDraft(site.draft);
  const inMenu = home ? resolveNav(home.nav).items.includes(subPage.id) : false;
  const publishStatus = subPageStatusOf({ draft, published: subPage.published });
  const header = {
    id: site.id,
    subPageId: subPage.id,
    address: handleAddress(site.handle),
    title: draft.title,
    description: draft.description,
    path: `/${draft.path}`,
    inMenu,
    live: subPage.livePath !== null,
    publishStatus,
    hasUnpublishedChanges: publishStatus !== "published",
    publishedAt: subPage.publishedAt,
    rev: subPage.rev,
  };
  if (args.blockId !== undefined) {
    const block = draft.blocks.find((item) => item.id === args.blockId);
    if (!block) throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
    return {
      sentence: `Here is ${blockPhrase(block.type)}.`,
      data: {
        page: { id: site.id, subPageId: subPage.id, rev: subPage.rev },
        block: blockView(block),
      },
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
    sentence: `Read the draft of the page “${draft.title}” at /${draft.path}: ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}. ${words}`,
    data: {
      page: header,
      blocks,
      limits: { blocks: { used: blocks.length, max: LIMITS.blocks } },
      publishIssues: subPagePublishIssues(subPage.draft),
    },
  };
}

export const getPage: ToolDefinition<typeof input> = {
  name: "get_page",
  title: "Get a page",
  description:
    "Reads one page's draft, which can differ from what is live. Pass subPageId for another page of the site: title, path, rev, inMenu, blocks, publishStatus, publishIssues; profile and theme stay on Home. Else returns page (id, rev, publishStatus, designStatus, hasUnpublishedChanges, publishedAt), profile, theme, blocks, limits, publishIssues (what Publish would refuse) and alsoSetInTheApp (settings no tool changes). publishStatus is this page's own; designStatus covers theme, menu and profile. A block has id, type, visible and add_block's fields. It is the only way to learn block ids and image ids. Pass blockId to read one block. Pass rev as ifRev to later writes (designRev for update_profile and set_theme). A page id from list_pages also works as pageId. Errors: not_found, block_not_found.",
  scope: MCP_SCOPES.read,
  annotations: READ_ONLY,
  input,
  page: "one",
  needsDraft: true,
  async handler(args, call) {
    const page = call.page!;
    if (call.subPage) return readSubPage(args, call.subPage, page);
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
    // Home's own state and the design's, apart (M15-10): Home's blocks against Home's live blocks,
    // and theme, menu and profile against the live design.
    const { publishStatus, designStatus } = homeStatusesOf({
      draft,
      published: page.published,
      publishedAt: page.publishedAt,
      themeTokens: theme?.tokens ?? null,
    });
    // Home's blocks are a page entry with a rev of its own: `rev` is the one the block tools take as
    // ifRev, and `designRev` the one update_profile, set_theme and the menu tools take. A site with no
    // Home entry has the one rev.
    const rev = page.homeRev ?? draft.rev;
    const header = {
      id: page.id,
      name: page.name,
      handle: page.handle,
      address: handleAddress(page.handle),
      publishStatus,
      designStatus,
      hasUnpublishedChanges: publishStatus !== "published" || designStatus !== "published",
      publishedAt: page.publishedAt,
      rev,
      ...(page.homeRev !== undefined ? { designRev: draft.rev } : {}),
    };

    if (args.blockId !== undefined) {
      const block = draft.blocks.find((item) => item.id === args.blockId);
      if (!block) {
        throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
      }
      return {
        sentence: `Here is ${blockPhrase(block.type)}.`,
        data: { page: { id: page.id, rev }, block: blockView(block) },
      };
    }

    const blocks = draft.blocks.map(blockView);
    const words =
      publishStatus === "not-published"
        ? "The page isn’t published yet."
        : publishStatus === "published" && designStatus === "published"
          ? "The draft matches the live page."
          : publishStatus === "published"
            ? "The page matches what is live. The design has changes that aren’t live."
            : designStatus === "published"
              ? "The draft has changes that aren’t live."
              : "The page and the design have changes that aren’t live.";
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
