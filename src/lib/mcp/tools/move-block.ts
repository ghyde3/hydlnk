import { z } from "zod";
import { MCP_SCOPES } from "../constants";
import { commitDraft } from "../commit";
import { MESSAGES, ToolFailure } from "../errors";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_IDEMPOTENT, ifRevField, pageIdField } from "./common";

const input = z
  .strictObject({
    pageId: pageIdField,
    ifRev: ifRevField,
    blockId: z.string().max(40).describe("The block to move, from get_page."),
    toIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("The block's new place in the list, counting from 0, where the block ends up."),
    afterBlockId: z
      .string()
      .max(40)
      .optional()
      .describe("Put the block right after this other block."),
    position: z
      .enum(["first", "last"])
      .optional()
      .describe("Move the block to the top or the bottom."),
  })
  .refine(
    (value) =>
      [value.toIndex, value.afterBlockId, value.position].filter((item) => item !== undefined)
        .length === 1,
    { error: "Send exactly one of toIndex, afterBlockId and position." },
  );

export const moveBlock: ToolDefinition<typeof input> = {
  name: "move_block",
  title: "Move a block",
  description: `Moves one block to a new place in the page's order. Send exactly one of toIndex (0 is first), afterBlockId, or position (first or last). Only the order changes. ${DRAFT_ONLY} Returns the new order as block ids and types. Moving a block to where it already is changes nothing. Errors: block_not_found, invalid_input, conflict.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "one",
  async handler(args, call) {
    const result = await commitDraft(call, args.ifRev, (doc) => {
      const from = doc.blocks.findIndex((item) => item.id === args.blockId);
      if (from === -1) throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
      const order = (blocks: typeof doc.blocks) =>
        blocks.map((item) => ({ id: item.id, type: item.type }));
      const rest = doc.blocks.filter((_, index) => index !== from);
      let to: number;
      if (args.position === "first") to = 0;
      else if (args.position === "last") to = doc.blocks.length - 1;
      else if (args.toIndex !== undefined) {
        if (args.toIndex > doc.blocks.length - 1) {
          throw new ToolFailure("invalid_input", `toIndex must be 0 to ${doc.blocks.length - 1}.`, {
            issues: [{ path: "toIndex", message: `Use 0 to ${doc.blocks.length - 1}.` }],
          });
        }
        to = args.toIndex;
      } else {
        if (args.afterBlockId === args.blockId) {
          throw new ToolFailure("invalid_input", "A block can’t go after itself.", {
            issues: [{ path: "afterBlockId", message: "A block can’t go after itself." }],
          });
        }
        const target = rest.findIndex((item) => item.id === args.afterBlockId);
        if (target === -1) {
          throw new ToolFailure("invalid_input", MESSAGES.block_not_found, {
            issues: [{ path: "afterBlockId", message: MESSAGES.block_not_found }],
          });
        }
        to = target + 1;
      }
      if (to === from) return { kind: "unchanged", value: { order: order(doc.blocks) } };
      const moved = doc.blocks[from]!;
      const blocks = [...rest.slice(0, to), moved, ...rest.slice(to)];
      return { kind: "write", doc: { ...doc, blocks }, value: { order: order(blocks) } };
    });
    return {
      sentence: result.unchanged
        ? "Nothing changed. The block was already there."
        : "Moved the block.",
      data: { rev: result.rev, order: result.value.order, unchanged: result.unchanged },
    };
  },
};
