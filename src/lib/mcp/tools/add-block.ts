import { z } from "zod";
import { BLOCK_TYPES, LIMITS, type Block, type BlockType } from "@/lib/document";
import { MCP_SCOPES } from "../constants";
import { commitDraft } from "../commit";
import { blockPhrase, blockView, buildBlock, imageIdsIn, validateBlock } from "../doc-view";
import { parseBlockFields } from "../block-fields";
import { MESSAGES, ToolFailure } from "../errors";
import { createImageResolver } from "../images";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_NOT_IDEMPOTENT, ifRevField, pageIdField } from "./common";

const input = z.strictObject({
  pageId: pageIdField,
  ifRev: ifRevField,
  // M11-07, M12-05: page_link, items and hours are excluded until MCP supports them (M12-05).
  type: z
    .enum(BLOCK_TYPES)
    .exclude(["page_link", "items", "hours"])
    .describe("The kind of block to add."),
  fields: z
    .looseObject({})
    .optional()
    .describe(
      "The block's content, using only the field names listed in this tool's description for that type. Images are imageIds from get_page. A social icon platform is one of instagram, tiktok, youtube, x, facebook, linkedin, github, threads, reddit, snapchat, pinterest, discord, twitch, spotify, email, website. A book store is amazon, apple or bookshop. An app store is appstore or googleplay. A divider needs no fields.",
    ),
  visible: z
    .boolean()
    .optional()
    .describe(
      "Whether the block shows on the page. Defaults to true. A hidden block can stay incomplete.",
    ),
  position: z
    .union([
      z.strictObject({
        index: z
          .number()
          .int()
          .min(0)
          .describe("0 puts it first. The number of blocks puts it last."),
      }),
      z.strictObject({
        afterBlockId: z.string().max(40).describe("Put the new block right after this block."),
      }),
    ])
    .optional()
    .describe("Where to put the block. Defaults to the end."),
});

export const addBlock: ToolDefinition<typeof input> = {
  name: "add_block",
  title: "Add a block",
  description: `Adds one block to the draft and returns its id. ${DRAFT_ONLY} Fields by type (limits are characters): link: label ${LIMITS.linkLabel}, url, icon, featured; card: title ${LIMITS.cardTitle}, caption ${LIMITS.cardCaption}, url, image; header: text ${LIMITS.headerText}; text: text ${LIMITS.text}; image: image, alt ${LIMITS.imageAlt}, url, shape; social: icons ${LIMITS.socialIconsMin}-${LIMITS.socialIconsMax} of {platform, url or address}; embed: url, caption ${LIMITS.embedCaption}; grid: cells ${LIMITS.gridCellsMin}-${LIMITS.gridCellsMax} of {title ${LIMITS.cellTitle}, subtitle ${LIMITS.cellSubtitle}, url}; divider; faq: items ${LIMITS.faqItemsMin}-${LIMITS.faqItemsMax} of {question ${LIMITS.faqQuestion}, answer ${LIMITS.faqAnswer}}; contact: name ${LIMITS.contactName}, phone, email, hours ${LIMITS.contactHours}; discount: code ${LIMITS.discountCode}, description ${LIMITS.discountDescription}, url; book: title ${LIMITS.bookTitle}, author ${LIMITS.bookAuthor}, cover, links 1-${LIMITS.bookLinks} of {store, url}; apps: links 1-${LIMITS.appLinks} of {store, url}; map: name ${LIMITS.mapName}, address ${LIMITS.mapAddress}. All types also take overrides. Max ${LIMITS.blocks} blocks. Errors: invalid_input, blocked_link, block_limit, image_not_found, conflict.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_NOT_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const type: BlockType = args.type;
    const parsed = parseBlockFields(type, args.fields ?? {}, "add");
    if (!parsed.ok) {
      throw new ToolFailure("invalid_input", parsed.issues[0]!.message, {
        issues: parsed.issues.slice(0, 10),
      });
    }
    const resolve = createImageResolver(call.admin, call.userId);
    const images = new Map();
    for (const id of imageIdsIn(type, parsed.fields)) images.set(id, await resolve(id));

    const visible = args.visible ?? true;
    const block: Block = buildBlock(type, parsed.fields, images, visible);
    // The document's own rules, so the AI learns about a problem now and not at Publish.
    validateBlock(block, { visible });

    const result = await commitDraft(call, args.ifRev, (doc) => {
      if (doc.blocks.length >= LIMITS.blocks) {
        throw new ToolFailure("block_limit", MESSAGES.block_limit);
      }
      let index = doc.blocks.length;
      const position = args.position;
      if (position && "index" in position) {
        if (position.index > doc.blocks.length) {
          throw new ToolFailure(
            "invalid_input",
            `position.index must be 0 to ${doc.blocks.length}.`,
            {
              issues: [{ path: "position.index", message: `Use 0 to ${doc.blocks.length}.` }],
            },
          );
        }
        index = position.index;
      } else if (position) {
        const after = doc.blocks.findIndex((item) => item.id === position.afterBlockId);
        if (after === -1) {
          throw new ToolFailure("invalid_input", MESSAGES.block_not_found, {
            issues: [{ path: "position.afterBlockId", message: MESSAGES.block_not_found }],
          });
        }
        index = after + 1;
      }
      const blocks = [...doc.blocks.slice(0, index), block, ...doc.blocks.slice(index)];
      return { kind: "write", doc: { ...doc, blocks }, value: { index } };
    });

    return {
      sentence: `Added ${blockPhrase(type)} at position ${result.value.index + 1}.`,
      data: {
        blockId: block.id,
        index: result.value.index,
        rev: result.rev,
        block: blockView(block),
      },
    };
  },
};
