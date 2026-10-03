import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, draftDocSchema, type Block } from "@/lib/document";
import { canRedo, canUndo } from "@/lib/editor/history";
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from "@/lib/editor/state";
import { setBorderWidth, setColor, setRadius } from "@/lib/themes";
import { blocks, fullDraft } from "./fixtures/page-document";

/**
 * M6-46 on the editor state: a style change is one block update and one undo step; reordering keeps
 * it; deleting a block and pressing Undo (the toast's) restores it with it; duplicating copies it;
 * the draft stays valid whatever the controls write.
 */

const COLOR = "#C46A4F";
const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);
const stateOf = (...docBlocks: Block[]) => initialEditorState({ ...fullDraft, blocks: docBlocks });
const of = (type: (typeof BLOCK_TYPES)[number]): Block => ({ ...blocks[type] }) as Block;
const overridesOf = (state: EditorState, id: string) =>
  (state.draft.blocks.find((b) => b.id === id) as { overrides?: unknown } | undefined)?.overrides;

const styled = (type: (typeof BLOCK_TYPES)[number]): Block => {
  let block = setColor(of(type), COLOR);
  block = setRadius(block, 20);
  block = setBorderWidth(block, 2);
  return block;
};

describe("M6-46 a style is one block update and one undo step", () => {
  it.each(BLOCK_TYPES.map((t) => [t]))("%s: update, undo, redo", (type) => {
    const start = stateOf(of(type));
    const after = run(start, { type: "block/update", block: styled(type) });
    expect(overridesOf(after, blocks[type].id)).toBeDefined();
    expect(canUndo(after.history)).toBe(true);
    expect(draftDocSchema.safeParse(after.draft).success).toBe(true);

    const undone = run(after, { type: "history/undo" });
    expect(undone.draft.blocks[0]).not.toHaveProperty("overrides");
    expect(undone.draft.blocks[0]).toEqual(of(type));
    expect(canRedo(undone.history)).toBe(true);

    const redone = run(undone, { type: "history/redo" });
    expect(redone.draft.blocks[0]).toEqual(styled(type));
  });

  it("removing the last setting leaves no overrides property, and undo brings the setting back", () => {
    const start = stateOf(styled("image"));
    const cleared = run(start, {
      type: "block/update",
      block: setBorderWidth(setRadius(setColor(styled("image"), null), null), null),
    });
    expect(cleared.draft.blocks[0]).not.toHaveProperty("overrides");
    const back = run(cleared, { type: "history/undo" });
    expect(back.draft.blocks[0]).toEqual(styled("image"));
  });
});

describe("M6-46 a style travels with its block", () => {
  it("reordering keeps it", () => {
    const state = stateOf(styled("header"), of("divider"), of("text"));
    const moved = run(state, { type: "block/move", id: blocks.header.id, delta: 1 });
    expect(moved.draft.blocks.map((b) => b.id)).toEqual([
      blocks.divider.id,
      blocks.header.id,
      blocks.text.id,
    ]);
    expect(overridesOf(moved, blocks.header.id)).toEqual(
      (styled("header") as { overrides: unknown }).overrides,
    );
    const dragged = run(moved, {
      type: "block/reorder",
      activeId: blocks.header.id,
      overId: blocks.text.id,
    });
    expect(overridesOf(dragged, blocks.header.id)).toEqual(
      (styled("header") as { overrides: unknown }).overrides,
    );
  });

  it("deleting a block and pressing Undo restores it with its style", () => {
    for (const type of BLOCK_TYPES) {
      const state = stateOf(of("divider"), styled(type === "divider" ? "text" : type), of("link"));
      const id = blocks[type === "divider" ? "text" : type].id;
      const deleted = run(state, { type: "block/delete", id });
      expect(
        deleted.draft.blocks.some((b) => b.id === id),
        type,
      ).toBe(false);
      const restored = run(deleted, { type: "block/undo-delete" });
      const block = restored.draft.blocks.find((b) => b.id === id);
      expect(block, type).toEqual(state.draft.blocks.find((b) => b.id === id));
      expect(block, type).toHaveProperty("overrides");
      expect(restored.draft.blocks.indexOf(block!), type).toBe(1);
    }
  });

  it("history undo of a delete also brings the style back", () => {
    const state = stateOf(styled("grid"), of("divider"));
    const deleted = run(state, { type: "block/delete", id: blocks.grid.id });
    const undone = run(deleted, { type: "history/undo" });
    expect(undone.draft.blocks[0]).toEqual(styled("grid"));
  });

  it("duplicating copies the style, and the copy is independent of the original", () => {
    const state = stateOf(styled("embed"));
    const doubled = run(state, { type: "duplicate", id: blocks.embed.id });
    const [original, copy] = doubled.draft.blocks as [Block, Block];
    expect(copy.id).not.toBe(original.id);
    expect((copy as { overrides: unknown }).overrides).toEqual(
      (original as { overrides: unknown }).overrides,
    );
    const changed = run(doubled, {
      type: "block/update",
      block: setRadius(copy, 4),
    });
    expect(overridesOf(changed, original.id)).toEqual(
      (original as { overrides: unknown }).overrides,
    );
    expect((changed.draft.blocks[1] as { overrides: { radius: number } }).overrides.radius).toBe(4);
  });

  it("toggling visibility and editing the block's content keep the style", () => {
    const state = stateOf(styled("header"));
    const hidden = run(state, { type: "block/toggle-visible", id: blocks.header.id });
    expect(overridesOf(hidden, blocks.header.id)).toEqual(
      (styled("header") as { overrides: unknown }).overrides,
    );
    const edited = run(hidden, {
      type: "block/update",
      block: { ...(hidden.draft.blocks[0] as Block), text: "Changed" } as Block,
    });
    expect(overridesOf(edited, blocks.header.id)).toEqual(
      (styled("header") as { overrides: unknown }).overrides,
    );
  });
});
