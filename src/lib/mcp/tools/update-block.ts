import { z } from "zod";
import { publishFormsEqual, type Block, type BlockType } from "@/lib/document";
import { MCP_SCOPES } from "../constants";
import { commitDraft } from "../commit";
import { blockPhrase, blockView, imageIdsIn, patchBlock, validateBlock } from "../doc-view";
import { parseBlockFields } from "../block-fields";
import { MESSAGES, ToolFailure } from "../errors";
import { createImageResolver } from "../images";
import type { ToolDefinition } from "../types";
import { DRAFT_ONLY, WRITE_IDEMPOTENT, ifRevField, pageIdField } from "./common";

const input = z
  .strictObject({
    pageId: pageIdField,
    ifRev: ifRevField,
    blockId: z.string().max(40).describe("The block's id from get_page."),
    fields: z
      .looseObject({})
      .optional()
      .describe(
        "Only the fields to change, with the names add_block takes for this block's type. A field you leave out stays as it is. null clears an optional image or link field. A list (icons, cells, items, links) replaces the list: send each item's own id to keep it, so its click history stays. overrides merge key by key and null removes one.",
      ),
    visible: z.boolean().optional().describe("Show or hide the block on the page."),
  })
  .refine((value) => value.fields !== undefined || value.visible !== undefined, {
    error: MESSAGES.nothingToChange,
  });

function findBlock(blocks: unknown, blockId: string): Block | undefined {
  if (!Array.isArray(blocks)) return undefined;
  return (blocks as Block[]).find(
    (item) => item && typeof item === "object" && item.id === blockId,
  );
}

export const updateBlock: ToolDefinition<typeof input> = {
  name: "update_block",
  title: "Update a block",
  description: `Changes fields of one block and leaves everything else as it is. The type cannot change. ${DRAFT_ONLY} Send only the fields to change, with the names add_block takes for that type; null clears an optional field. A list field replaces the list, and each item you send with its own id keeps its id, so its click history stays; an item you drop loses its click counts. Changing a text block's text clears its formatting. Sending the same values twice changes nothing. Showing a block that is incomplete is refused. Errors: block_not_found, invalid_input, blocked_link, image_not_found, conflict.`,
  scope: MCP_SCOPES.write,
  annotations: WRITE_IDEMPOTENT,
  input,
  page: "one",
  needsDraft: true,
  async handler(args, call) {
    // The block's type decides which fields it takes, so find it in the draft first.
    const current = findBlock(
      (call.page?.draft as { blocks?: unknown } | undefined)?.blocks,
      args.blockId,
    );
    if (!current) throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
    const type = current.type as BlockType;

    const parsed = parseBlockFields(type, args.fields ?? {}, "update");
    if (!parsed.ok) {
      throw new ToolFailure("invalid_input", parsed.issues[0]!.message, {
        issues: parsed.issues.slice(0, 10),
      });
    }
    const resolve = createImageResolver(call.admin, call.userId);
    const images = new Map();
    for (const id of imageIdsIn(type, parsed.fields)) images.set(id, await resolve(id));

    const touched = Object.keys(parsed.fields);
    const result = await commitDraft(call, args.ifRev, (doc) => {
      const index = doc.blocks.findIndex((item) => item.id === args.blockId);
      if (index === -1) throw new ToolFailure("block_not_found", MESSAGES.block_not_found);
      const before = doc.blocks[index]!;
      const patched = patchBlock(before, parsed.fields, images, args.visible);
      const next = patched.block;
      if (publishFormsEqual(next, before)) {
        return { kind: "unchanged", value: { block: before, formattingCleared: false } };
      }
      const visible = (next as { visible?: boolean }).visible !== false;
      const showing = args.visible === true && (before as { visible?: boolean }).visible === false;
      validateBlock(next, { visible, only: showing ? null : touched });
      const blocks = [...doc.blocks];
      blocks[index] = next;
      return {
        kind: "write",
        doc: { ...doc, blocks },
        value: { block: next, formattingCleared: patched.formattingCleared },
      };
    });

    const note = result.value.formattingCleared
      ? " The text’s formatting was cleared because its text changed."
      : "";
    return {
      sentence: result.unchanged
        ? `Nothing changed. The block already looked like that.`
        : `Updated ${blockPhrase(type)}.${note}`,
      data: {
        blockId: args.blockId,
        rev: result.rev,
        block: blockView(result.value.block),
        unchanged: result.unchanged,
        ...(result.value.formattingCleared ? { formattingCleared: true } : {}),
      },
    };
  },
};
