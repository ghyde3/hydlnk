import { z } from "zod";
import { MCP_SCOPES } from "../constants";
import { commitBlocks } from "../commit";
import { blockPhrase } from "../doc-view";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolDefinition } from "../types";
import {
  DESTRUCTIVE_IDEMPOTENT,
  DRAFT_ONLY,
  ifRevField,
  pageIdField,
  subPageIdField,
} from "./common";

const input = z.strictObject({
  pageId: pageIdField,
  subPageId: subPageIdField,
  ifRev: ifRevField,
  blockId: z.string().max(40).describe("The block to remove, from get_page."),
});

export const removeBlock: ToolDefinition<typeof input> = {
  name: "remove_block",
  title: "Remove a block",
  description: `Removes one block from the draft and nothing else. This cannot be undone from here, and the app's undo does not cover changes made by tools. ${DRAFT_ONLY} Its past clicks stay in the analytics. Pass subPageId for a block on another page of the site. Calling it again for the same id answers block_not_found. Returns how many blocks are left. Errors: block_not_found, conflict.`,
  scope: MCP_SCOPES.write,
  annotations: DESTRUCTIVE_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const result = await commitBlocks(call, args.ifRev, (doc) => {
      const index = doc.blocks.findIndex((item) => item.id === args.blockId);
      if (index === -1) throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
      const removed = doc.blocks[index]!;
      const blocks = doc.blocks.filter((_, position) => position !== index);
      return {
        kind: "write",
        doc: { ...doc, blocks },
        value: { type: removed.type, left: blocks.length },
      };
    });
    return {
      sentence: `Removed ${blockPhrase(result.value.type)}. ${result.value.left} ${result.value.left === 1 ? "block" : "blocks"} left.`,
      data: {
        removedBlockId: args.blockId,
        removedType: result.value.type,
        blocksLeft: result.value.left,
        rev: result.rev,
      },
    };
  },
};
