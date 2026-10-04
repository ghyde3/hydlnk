import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  BLOCK_TYPES,
  LIMITS,
  blockDefaults,
  draftDocSchema,
  newBlockId,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { collectIds, duplicateBlock } from "@/lib/editor/duplicate";
import { canRedo, canUndo } from "@/lib/editor/history";
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from "@/lib/editor/state";
import { blocks, fullDraft } from "./fixtures/page-document";

/** M6-04 (insert anywhere), M6-05 (duplicate), M6-06 (every change is one history step). */

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);

const base = (...docBlocks: Block[]): EditorState =>
  initialEditorState({ ...fullDraft, blocks: docBlocks });

const idsOf = (state: EditorState) => state.draft.blocks.map((block) => block.id);

const three = () => [blocks.link, blocks.header, blocks.text] as Block[];

/** Every id in a block: the block's own, then its icons' or cells'. */
const allIds = (block: Block): string[] => [
  block.id,
  ...(block.type === "social" ? block.icons.map((icon) => icon.id) : []),
  ...(block.type === "grid" ? block.cells.map((cell) => cell.id) : []),
  ...(block.type === "faq" ? block.items.map((item) => item.id) : []),
  ...(block.type === "book" || block.type === "apps" ? block.links.map((link) => link.id) : []),
  ...(block.type === "map" ? [block.googleId, block.appleId] : []),
];

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("M6-04 insert a block at a position", () => {
  it("inserts at the index, expanded, with a request to focus its first input", () => {
    const state = base(...three());
    const next = run(state, { type: "block/add", blockType: "header", index: 2 });
    expect(next.draft.blocks).toHaveLength(4);
    const added = next.draft.blocks[2]!;
    expect(added.type).toBe("header");
    expect(added).toMatchObject({ text: "New section", visible: true });
    expect(added.id).toMatch(BLOCK_ID_PATTERN);
    // Every other block keeps its id, content and relative order.
    expect(next.draft.blocks.filter((b) => b.id !== added.id)).toEqual(state.draft.blocks);
    expect(next.expandedId).toBe(added.id);
    expect(next.focus).toMatchObject({ kind: "first-input", blockId: added.id });
    expect(next.announcement).toBe("Header added at position 3 of 4.");
    expect(next.announceSeq).toBe(state.announceSeq + 1);
  });

  it("a divider asks for focus on the row; position 1 is the top and N+1 the end", () => {
    const state = base(...three());
    const top = run(state, { type: "block/add", blockType: "divider", index: 0 });
    expect(top.draft.blocks[0]!.type).toBe("divider");
    expect(top.focus).toMatchObject({ kind: "row", blockId: top.draft.blocks[0]!.id });
    const end = run(state, { type: "block/add", blockType: "text", index: 3 });
    expect(end.draft.blocks[3]!.type).toBe("text");
  });

  it("clamps the index: -1 gives 0, 99 gives the end", () => {
    const state = base(...three());
    expect(
      run(state, { type: "block/add", blockType: "link", index: -1 }).draft.blocks[0]!.type,
    ).toBe("link");
    const atEnd = run(state, { type: "block/add", blockType: "embed", index: 99 });
    expect(atEnd.draft.blocks[3]!.type).toBe("embed");
    expect(atEnd.draft.blocks.slice(0, 3)).toEqual(state.draft.blocks);
    expect(
      run(state, { type: "block/add", blockType: "embed", index: Number.NaN }).draft.blocks[3]!
        .type,
    ).toBe("embed");
  });

  it("without an index it appends exactly as in M2-10 (and says nothing)", () => {
    const state = base(...three());
    const next = run(state, { type: "block/add", blockType: "grid" });
    expect(next.draft.blocks[3]!.type).toBe("grid");
    expect(next.announcement).toBe(state.announcement);
    expect(next.announceSeq).toBe(state.announceSeq);
  });

  it("at 50 blocks an insert returns the same state object", () => {
    const fifty = Array.from({ length: LIMITS.blocks }, () => blockDefaults.divider());
    const state = base(...fifty);
    expect(run(state, { type: "block/add", blockType: "link", index: 10 })).toBe(state);
    expect(run(state, { type: "block/add", blockType: "link" })).toBe(state);
    expect(run(state, { type: "insert", index: 0, block: blockDefaults.text() })).toBe(state);
    // 49 is not the limit.
    const forty9 = base(...fifty.slice(1));
    expect(
      run(forty9, { type: "block/add", blockType: "link", index: 10 }).draft.blocks,
    ).toHaveLength(50);
  });

  it("an insert of a block whose id is on the page already is refused", () => {
    const state = base(...three());
    const clash = { ...blockDefaults.text(), id: blocks.header.id };
    expect(run(state, { type: "insert", index: 0, block: clash })).toBe(state);
    const iconClash = { ...blockDefaults.text(), id: "icon-instagram" };
    const withSocial = base(blocks.social as Block);
    expect(run(withSocial, { type: "insert", index: 0, block: iconClash })).toBe(withSocial);
  });

  it("1000 inserts produce 1000 distinct ids that match the id pattern", () => {
    let state = base();
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      if (state.draft.blocks.length >= LIMITS.blocks) {
        state = run(state, { type: "block/delete", id: state.draft.blocks[0]!.id });
      }
      const type = BLOCK_TYPES[i % BLOCK_TYPES.length]!;
      const before = state;
      state = run(state, { type: "block/add", blockType: type, index: i % 7 });
      expect(state).not.toBe(before);
      const added = state.draft.blocks.find((b) => b.id === state.expandedId)!;
      for (const id of allIds(added)) {
        expect(id).toMatch(BLOCK_ID_PATTERN);
        expect(seen.has(id), `duplicate id ${id}`).toBe(false);
        seen.add(id);
      }
    }
    expect(draftDocSchema.safeParse(state.draft).success).toBe(true);
  });

  it("is one step in the undo history", () => {
    const state = base(...three());
    const added = run(state, { type: "block/add", blockType: "header", index: 1 });
    expect(added.history.past).toHaveLength(1);
    const undone = run(added, { type: "history/undo" });
    expect(idsOf(undone)).toEqual(idsOf(state));
    expect(undone.expandedId).toBeNull();
    expect(idsOf(run(undone, { type: "history/redo" }))).toEqual(idsOf(added));
    // Two inserts right after each other are two steps (adding never merges).
    const twice = run(
      state,
      { type: "block/add", blockType: "header", index: 1, at: 0 },
      { type: "block/add", blockType: "header", index: 1, at: 5 },
    );
    expect(twice.history.past).toHaveLength(2);
  });
});

describe("M6-05 duplicate a block", () => {
  it.each(BLOCK_TYPES)("a %s copy deep-equals the original except for ids", (type) => {
    const original = deepFreeze(JSON.parse(JSON.stringify(blocks[type])) as Block);
    const state = base(blockDefaults.embed(), original, blockDefaults.grid());
    const next = run(state, { type: "duplicate", id: original.id });
    expect(next.draft.blocks).toHaveLength(4);
    // Directly after the original; the original object is untouched (and was frozen).
    expect(next.draft.blocks[1]).toBe(original);
    const copy = next.draft.blocks[2]!;
    const strip = (block: Block): unknown => {
      const clone = JSON.parse(JSON.stringify(block));
      clone.id = "x";
      if (clone.icons) for (const icon of clone.icons) icon.id = "x";
      if (clone.cells) for (const cell of clone.cells) cell.id = "x";
      if (type === "faq") for (const item of clone.items) item.id = "x";
      if (type === "book" || type === "apps") for (const link of clone.links) link.id = "x";
      if (type === "map") {
        clone.googleId = "x";
        clone.appleId = "x";
      }
      return clone;
    };
    expect(strip(copy)).toEqual(strip(original));
    expect(copy).not.toBe(original);
    // New ids everywhere, all matching the pattern, none shared with the page.
    const copyIds = allIds(copy);
    const rest = new Set(next.draft.blocks.filter((b) => b !== copy).flatMap(allIds));
    for (const id of copyIds) {
      expect(id).toMatch(BLOCK_ID_PATTERN);
      expect(rest.has(id)).toBe(false);
    }
    expect(new Set(copyIds).size).toBe(copyIds.length);
    // The copy is open and focused, the original is closed, and the page says so.
    expect(next.expandedId).toBe(copy.id);
    expect(next.focus).toMatchObject(
      type === "divider"
        ? { kind: "row", blockId: copy.id }
        : { kind: "first-input", blockId: copy.id },
    );
    expect(next.announcement).toBe("Block duplicated.");
    expect(draftDocSchema.safeParse(next.draft).success).toBe(true);
  });

  it("duplicating twice yields three disjoint id sets", () => {
    const state = base(blocks.social as Block, blocks.grid as Block);
    let next = run(state, { type: "duplicate", id: blocks.social.id });
    next = run(next, { type: "duplicate", id: blocks.social.id });
    const social = next.draft.blocks.filter((b) => b.type === "social");
    expect(social).toHaveLength(3);
    const sets = social.map((b) => new Set(allIds(b)));
    const union = new Set(sets.flatMap((set) => [...set]));
    expect(union.size).toBe(sets.reduce((sum, set) => sum + set.size, 0));
    expect(draftDocSchema.safeParse(next.draft).success).toBe(true);
    expect(collectIds(next.draft).size).toBe(next.draft.blocks.flatMap(allIds).length);
  });

  it("is one undo step, and undo and redo bring it back", () => {
    const state = base(...three());
    const next = run(state, { type: "duplicate", id: blocks.header.id });
    expect(next.history.past).toHaveLength(1);
    const undone = run(next, { type: "history/undo" });
    expect(idsOf(undone)).toEqual(idsOf(state));
    expect(undone.draft).toEqual(state.draft);
    expect(idsOf(run(undone, { type: "history/redo" }))).toEqual(idsOf(next));
  });

  it("points a copy of a card or image at the same file", () => {
    const state = base(blocks.card as Block);
    const next = run(state, { type: "duplicate", id: blocks.card.id });
    const [first, second] = next.draft.blocks as [typeof blocks.card, typeof blocks.card];
    expect(second.image.path).toBe(first.image.path);
    expect(second.image).toEqual(first.image);
  });

  it("at 50 blocks duplicating returns the same state object", () => {
    const fifty = Array.from({ length: LIMITS.blocks }, () => blockDefaults.link());
    const state = base(...fifty);
    expect(run(state, { type: "duplicate", id: fifty[3]!.id })).toBe(state);
    expect(
      run(base(...fifty.slice(1)), { type: "duplicate", id: fifty[3]!.id }).draft.blocks,
    ).toHaveLength(50);
  });

  it("an unknown id changes nothing", () => {
    const state = base(...three());
    expect(run(state, { type: "duplicate", id: "does-not-exist" })).toBe(state);
  });

  it("a hidden block gives a hidden copy; an incomplete block duplicates fine", () => {
    const hidden = { ...blockDefaults.link(), visible: false } as Block;
    const incomplete = blockDefaults.link(); // an empty URL
    const state = base(hidden, incomplete);
    const next = run(
      state,
      { type: "duplicate", id: hidden.id },
      { type: "duplicate", id: incomplete.id },
    );
    expect(next.draft.blocks.filter((b) => b.visible === false)).toHaveLength(2);
    expect(next.draft.blocks).toHaveLength(4);
  });

  it("does not copy the publish errors of the original onto the copy", () => {
    const original = blockDefaults.link();
    const state: EditorState = {
      ...base(original),
      publishErrors: [{ blockId: original.id, field: "url", message: "Enter a link." }],
    };
    const next = run(state, { type: "duplicate", id: original.id });
    const copy = next.draft.blocks[1]!;
    expect(next.publishErrors.some((error) => error.blockId === copy.id)).toBe(false);
    expect(next.publishErrors.filter((error) => error.blockId === original.id)).toHaveLength(1);
  });

  it("duplicateBlock never mutates the original and never reuses a taken id", () => {
    const original = deepFreeze(JSON.parse(JSON.stringify(blocks.grid)) as Block);
    const taken = collectIds({ blocks: [original] });
    const copy = duplicateBlock(original, taken);
    expect(copy.id).not.toBe(original.id);
    expect(taken.has(copy.id)).toBe(true);
    expect(newBlockId()).toMatch(BLOCK_ID_PATTERN);
  });
});

describe("expand (the contract for tapping the preview)", () => {
  it("opens one row and closes the others, and asks for focus", () => {
    const state = run(base(...three()), { type: "block/toggle-expanded", id: blocks.link.id });
    const next = run(state, { type: "expand", id: blocks.header.id });
    expect(next.expandedId).toBe(blocks.header.id);
    expect(next.focus).toMatchObject({ kind: "first-input", blockId: blocks.header.id });
    // It never closes a row.
    expect(run(next, { type: "expand", id: blocks.header.id }).expandedId).toBe(blocks.header.id);
  });

  it("a divider asks for the row, an item asks for its own first field, an unknown id does nothing", () => {
    const state = base(blocks.divider as Block, blocks.social as Block);
    expect(run(state, { type: "expand", id: blocks.divider.id }).focus).toMatchObject({
      kind: "row",
    });
    expect(
      run(state, { type: "expand", id: blocks.social.id, itemId: "icon-threads-1" }).focus,
    ).toMatchObject({ kind: "first-input", itemId: "icon-threads-1" });
    expect(run(state, { type: "expand", id: "nope" })).toBe(state);
  });

  it("is not a history step", () => {
    const state = run(base(...three()), { type: "expand", id: blocks.text.id });
    expect(state.history.past).toHaveLength(0);
  });
});

describe("M6-06 every dispatched change is one history step", () => {
  const start = () => initialEditorState(fullDraft);

  it("no-op actions add nothing", () => {
    const state = start();
    const noops: EditorAction[] = [
      { type: "profile/name", value: fullDraft.profile.name },
      { type: "profile/bio", value: fullDraft.profile.bio },
      { type: "profile/photo", value: fullDraft.profile.photo },
      { type: "block/move", id: fullDraft.blocks[0]!.id, delta: -1 },
      { type: "block/toggle-expanded", id: fullDraft.blocks[0]!.id },
      { type: "publish/clear-errors" },
      { type: "block/delete", id: "nope" },
    ];
    for (const action of noops) {
      const next = run(state, action);
      expect(next.history.past, action.type).toHaveLength(0);
    }
    expect(canUndo(run(state, { type: "history/undo" }).history)).toBe(false);
    expect(run(state, { type: "history/undo" })).toBe(state);
    expect(run(state, { type: "history/redo" })).toBe(state);
  });

  it("typing in the name field coalesces: one step, one Undo", () => {
    let state = start();
    let value = fullDraft.profile.name;
    for (let i = 0; i < 11; i++) {
      value += "x";
      state = run(state, { type: "profile/name", value, at: 1000 + i * 100 });
    }
    expect(state.history.past).toHaveLength(1);
    state = run(state, { type: "history/undo" });
    expect(state.draft.profile.name).toBe(fullDraft.profile.name);
    expect(canUndo(state.history)).toBe(false);
    expect(canRedo(state.history)).toBe(true);
  });

  it("a pause, or another field, is a new step", () => {
    let state = start();
    state = run(state, { type: "profile/name", value: "A", at: 0 });
    state = run(state, { type: "profile/name", value: "AB", at: 1500 });
    state = run(state, { type: "profile/bio", value: "x", at: 1600 });
    expect(state.history.past).toHaveLength(3);
  });

  it("typing in one block field coalesces; another field of the block does not", () => {
    let state = base(blocks.link as Block);
    const link = blocks.link as Extract<Block, { type: "link" }>;
    for (let i = 1; i <= 5; i++) {
      state = run(state, {
        type: "block/update",
        block: { ...link, label: `${link.label}${"!".repeat(i)}` },
        at: i * 50,
      });
    }
    expect(state.history.past).toHaveLength(1);
    state = run(state, {
      type: "block/update",
      block: { ...(state.draft.blocks[0] as typeof link), url: "https://other.test" },
      at: 400,
    });
    expect(state.history.past).toHaveLength(2);
  });

  it("add, delete, move, reorder, visibility and set-image never merge", () => {
    let state = base(...three());
    const actions: EditorAction[] = [
      { type: "block/add", blockType: "divider" },
      { type: "block/toggle-visible", id: blocks.link.id },
      { type: "block/toggle-visible", id: blocks.link.id },
      { type: "block/move", id: blocks.header.id, delta: 1 },
      { type: "block/reorder", activeId: blocks.header.id, overId: blocks.link.id },
      { type: "block/delete", id: blocks.text.id },
    ];
    actions.forEach((action, i) => {
      state = run(state, { ...action, at: i } as EditorAction);
    });
    expect(state.history.past).toHaveLength(actions.length);
  });

  it("undo restores the draft; the open row stays open only while its block exists", () => {
    let state = base(...three());
    state = run(state, { type: "block/add", blockType: "text" });
    const addedId = state.expandedId!;
    // The new row is open: undoing its add leaves nothing open.
    state = run(state, { type: "history/undo" });
    expect(state.expandedId).toBeNull();
    expect(state.draft.blocks.some((b) => b.id === addedId)).toBe(false);
    // Redo brings the block back, closed (it was never opened by the step).
    state = run(state, { type: "history/redo" });
    expect(state.draft.blocks.some((b) => b.id === addedId)).toBe(true);
    // A row that still exists stays open across an undo of something else.
    state = run(state, { type: "block/toggle-expanded", id: blocks.link.id });
    state = run(state, { type: "profile/name", value: "Zed" });
    state = run(state, { type: "history/undo" });
    expect(state.expandedId).toBe(blocks.link.id);
  });

  it("the toast Undo and a history Undo coexist: each restore is one step", () => {
    let state = base(...three());
    state = run(state, { type: "block/delete", id: blocks.header.id });
    expect(state.deleted?.block.id).toBe(blocks.header.id);
    state = run(state, { type: "block/undo-delete" });
    expect(idsOf(state)).toEqual([blocks.link.id, blocks.header.id, blocks.text.id]);
    expect(state.history.past).toHaveLength(2);
    // History Undo right after the toast's Undo removes the restored block again...
    state = run(state, { type: "history/undo" });
    expect(idsOf(state)).toEqual([blocks.link.id, blocks.text.id]);
    // ...and Redo brings it back.
    state = run(state, { type: "history/redo" });
    expect(idsOf(state)).toEqual([blocks.link.id, blocks.header.id, blocks.text.id]);
  });

  it("a history step that brings a deleted block back drops its stale toast", () => {
    let state = base(...three());
    state = run(state, { type: "block/delete", id: blocks.header.id });
    state = run(state, { type: "history/undo" });
    expect(idsOf(state)).toContain(blocks.header.id);
    expect(state.deleted).toBeNull();
  });

  it("a step decided for another draft is dropped", () => {
    let state = start();
    const seen = state.draft;
    state = run(state, { type: "profile/name", value: "Changed" });
    expect(run(state, { type: "history/undo", expect: seen })).toBe(state);
    expect(run(state, { type: "history/undo", expect: state.draft }).draft.profile.name).toBe(
      fullDraft.profile.name,
    );
  });

  it("publish errors are reconciled with the restored draft and are not history themselves", () => {
    const original = blockDefaults.link();
    let state = base(original);
    state = run(state, {
      type: "publish/errors",
      errors: [{ blockId: original.id, field: "url", message: "Enter a link." }],
    });
    expect(state.history.past).toHaveLength(0);
    state = run(state, {
      type: "block/update",
      block: { ...(original as Extract<Block, { type: "link" }>), url: "https://ok.test" },
    });
    expect(state.publishErrors).toHaveLength(0);
    state = run(state, { type: "history/undo" });
    // The URL is empty again: the stored error does not come back by itself, and nothing crashes.
    expect(state.publishErrors).toHaveLength(0);
    expect(state.history.present).toBe(state.draft);
  });

  it("the history always holds the draft on screen as its present", () => {
    let state = start();
    const actions: EditorAction[] = [
      { type: "profile/name", value: "N" },
      { type: "block/add", blockType: "link", index: 0 },
      { type: "duplicate", id: fullDraft.blocks[0]!.id },
      { type: "history/undo" },
      { type: "history/undo" },
      { type: "history/redo" },
      { type: "block/delete", id: fullDraft.blocks[1]!.id },
      { type: "block/undo-delete" },
    ];
    for (const action of actions) {
      state = run(state, action);
      expect(state.history.present).toBe(state.draft);
    }
  });

  it("every action of the table is undone and redone exactly (the draft deep-equals each side)", () => {
    const link = fullDraft.blocks.find((b) => b.type === "link")!;
    const table: [string, EditorAction][] = [
      ["name", { type: "profile/name", value: "Renamed" }],
      ["bio", { type: "profile/bio", value: "A new bio" }],
      ["remove photo", { type: "profile/photo", value: null }],
      ["add", { type: "block/add", blockType: "header" }],
      ["insert", { type: "block/add", blockType: "text", index: 1 }],
      ["duplicate", { type: "duplicate", id: link.id }],
      ["delete", { type: "block/delete", id: link.id }],
      ["move", { type: "block/move", id: fullDraft.blocks[1]!.id, delta: 1 }],
      [
        "reorder",
        {
          type: "block/reorder",
          activeId: fullDraft.blocks[0]!.id,
          overId: fullDraft.blocks[3]!.id,
        },
      ],
      ["visibility", { type: "block/toggle-visible", id: link.id }],
      [
        "label",
        {
          type: "block/update",
          block: { ...(link as Extract<Block, { type: "link" }>), label: "Edited" },
        },
      ],
      [
        "block color",
        {
          type: "block/update",
          block: {
            ...(link as Extract<Block, { type: "link" }>),
            overrides: {
              ...(link as Extract<Block, { type: "link" }>).overrides,
              accent: "#123456",
            },
          },
        },
      ],
    ];
    for (const [label, action] of table) {
      const before = start();
      const after = run(before, action);
      expect(after.draft, `${label} changes the draft`).not.toBe(before.draft);
      const undone = run(after, { type: "history/undo" });
      expect(undone.draft, `undo ${label}`).toEqual(before.draft);
      const redone = run(undone, { type: "history/redo" });
      expect(redone.draft, `redo ${label}`).toEqual(after.draft);
    }
  });

  it("every restored draft is a valid draft", () => {
    let state = start();
    state = run(state, { type: "block/add", blockType: "social", index: 0 });
    state = run(state, { type: "duplicate", id: state.draft.blocks[0]!.id });
    while (canUndo(state.history)) {
      state = run(state, { type: "history/undo" });
      expect(draftDocSchema.safeParse(state.draft).success).toBe(true);
    }
    expect(state.draft).toEqual(fullDraft as DraftDoc);
  });
});
