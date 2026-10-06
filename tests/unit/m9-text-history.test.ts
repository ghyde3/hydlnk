import { describe, expect, it } from "vitest";
import type { Block, DraftDoc } from "@/lib/document";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commitSession,
  createHistory,
  recordEdit,
  recordSessionEdit,
  redo,
  undo,
} from "@/lib/editor/history";
import { editorReducer, initialEditorState, type EditorAction } from "@/lib/editor/state";
import { workspaceReducer } from "@/components/workspace/workspace-reducer";
import { draftWith, noirTokens } from "./fixtures/page-document";

/**
 * M9-12: an editing session of the text editor is ONE step of the workspace history. While the
 * editor has the focus its live edits move the draft but add no step; the session becomes one step,
 * back to the block as it was when it began, when it ends; undo, redo and every other edit end an
 * open session first.
 */

const TEXT_ID = "text-hist-0001";
const OTHER_ID = "text-hist-0002";

const text = (id: string, value: string, marks?: unknown[]): Block =>
  ({ id, type: "text", visible: true, text: value, ...(marks ? { marks } : {}) }) as unknown as Block;

const draftOf = (...blocks: Block[]): DraftDoc => draftWith(...blocks) as DraftDoc;
const blockText = (draft: DraftDoc, id = TEXT_ID) =>
  (draft.blocks.find((block) => block.id === id) as { text: string }).text;
const withText = (draft: DraftDoc, value: string, id = TEXT_ID): DraftDoc => ({
  ...draft,
  blocks: draft.blocks.map((block) => (block.id === id ? text(id, value) : block)),
});

const start = () => draftOf(text(TEXT_ID, "Hello"), text(OTHER_ID, "Other"));

describe("M9-12 the history engine: sessions", () => {
  it("live edits move the present but add no step: Undo stays as it was while typing", () => {
    let history = createHistory(start());
    for (const value of ["Hello w", "Hello wo", "Hello wor", "Hello worl", "Hello world"]) {
      history = recordSessionEdit(history, withText(history.present, value), "s1");
    }
    expect(blockText(history.present)).toBe("Hello world");
    expect(history.past).toHaveLength(0);
    expect(canUndo(history)).toBe(false);
    expect(history.session?.id).toBe("s1");
  });

  it("committing makes exactly one step, back to the draft the session began with", () => {
    const base = start();
    let history = createHistory(base);
    history = recordSessionEdit(history, withText(base, "Hello w"), "s1");
    history = recordSessionEdit(history, withText(base, "Hello world"), "s1");
    history = commitSession(history);
    expect(history.session).toBeUndefined();
    expect(history.past).toEqual([base]);
    expect(blockText(history.present)).toBe("Hello world");
    expect(canUndo(history)).toBe(true);
    const back = undo(history);
    expect(blockText(back.present)).toBe("Hello");
    expect(blockText(redo(back).present)).toBe("Hello world");
  });

  it("a session that ends where it began is no step at all", () => {
    const base = start();
    let history = createHistory(base);
    history = recordSessionEdit(history, withText(base, "Hello!"), "s1");
    history = recordSessionEdit(history, withText(base, "Hello"), "s1");
    history = commitSession(history);
    expect(history.past).toHaveLength(0);
    expect(history.session).toBeUndefined();
    expect(canUndo(history)).toBe(false);
  });

  it("committing with no session, and recording the present again, change nothing", () => {
    const history = createHistory(start());
    expect(commitSession(history)).toBe(history);
    expect(recordSessionEdit(history, history.present, "s1")).toBe(history);
  });

  it("the first live edit clears redo, like any new edit", () => {
    const base = start();
    let history = recordEdit(createHistory(base), withText(base, "Hello again"), { at: 0 });
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = recordSessionEdit(history, withText(history.present, "Hello there"), "s1");
    expect(canRedo(history)).toBe(false);
  });

  it("undo and redo end an open session first, so nothing is lost and no stale present is kept", () => {
    const base = start();
    let history = createHistory(base);
    history = recordSessionEdit(history, withText(base, "Hello world"), "s1");
    const undone = undo(history);
    expect(blockText(undone.present)).toBe("Hello");
    expect(undone.session).toBeUndefined();
    expect(blockText(undone.future[0]!)).toBe("Hello world");
    expect(blockText(redo(undone).present)).toBe("Hello world");
  });

  it("another edit ends the session as one step and is a step of its own", () => {
    const base = start();
    let history = createHistory(base);
    history = recordSessionEdit(history, withText(base, "Hello world"), "s1");
    const other = withText(history.present, "Changed", OTHER_ID);
    history = recordEdit(history, other, { at: 1000 });
    expect(history.session).toBeUndefined();
    expect(history.past).toHaveLength(2);
    expect(blockText(history.past[0]!)).toBe("Hello");
    expect(blockText(history.past[1]!)).toBe("Hello world");
  });

  it("a new session after a committed one is a separate step, and a new id commits the old one", () => {
    const base = start();
    let history = createHistory(base);
    history = recordSessionEdit(history, withText(base, "One"), "s1");
    history = recordSessionEdit(history, withText(history.present, "Two"), "s2");
    expect(history.past).toHaveLength(1);
    history = commitSession(history);
    expect(history.past).toHaveLength(2);
    expect(blockText(history.past[1]!)).toBe("One");
  });

  it("the history keeps at most HISTORY_LIMIT steps, sessions included", () => {
    let history = createHistory(start());
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      history = recordSessionEdit(history, withText(history.present, `v${i}`), `s${i}`);
      history = commitSession(history);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("M9-12 the reducer: block/session-update and block/session-end", () => {
  const act = (state = initialEditorState(start()), ...actions: EditorAction[]) =>
    actions.reduce(editorReducer, state);
  const update = (value: string, session = "s1"): EditorAction => ({
    type: "block/session-update",
    block: text(TEXT_ID, value),
    session,
  });

  it("typing in one session writes the draft, adds no step, and the end makes one", () => {
    let state = act(undefined, update("Hello w"), update("Hello wo"), update("Hello world"));
    expect(blockText(state.draft)).toBe("Hello world");
    expect(canUndo(state.history)).toBe(false);
    state = act(state, { type: "block/session-end" });
    expect(canUndo(state.history)).toBe(true);
    expect(state.history.past).toHaveLength(1);
    expect(blockText(state.draft)).toBe("Hello world");
    state = act(state, { type: "history/undo" });
    expect(blockText(state.draft)).toBe("Hello");
    state = act(state, { type: "history/redo" });
    expect(blockText(state.draft)).toBe("Hello world");
  });

  it("a session end with no session, and a session update that changes nothing, return the same state", () => {
    const state = initialEditorState(start());
    expect(editorReducer(state, { type: "block/session-end" })).toBe(state);
    expect(
      editorReducer(state, { type: "block/session-update", block: state.draft.blocks[0]!, session: "s" }),
    ).toBe(state);
    // The same content in a new object is a session that ends where it began: no step.
    const same = editorReducer(state, update("Hello"));
    expect(editorReducer(same, { type: "block/session-end" }).history.past).toHaveLength(0);
    expect(editorReducer(state, { type: "block/session-update", block: text("nope-nope-1", "x"), session: "s" })).toBe(state);
  });

  it("an undo while a session is open (a workspace Undo with no blur) ends it first", () => {
    let state = act(undefined, update("Hello world"));
    state = act(state, { type: "history/undo" });
    expect(blockText(state.draft)).toBe("Hello");
    expect(state.history.session).toBeUndefined();
    expect(canRedo(state.history)).toBe(true);
  });

  it("any other edit ends the session as its own step first", () => {
    let state = act(undefined, update("Hello world"));
    state = act(state, { type: "block/toggle-visible", id: OTHER_ID });
    expect(state.history.past).toHaveLength(2);
    expect(state.history.session).toBeUndefined();
    state = act(state, { type: "history/undo" });
    expect(blockText(state.draft)).toBe("Hello world");
    state = act(state, { type: "history/undo" });
    expect(blockText(state.draft)).toBe("Hello");
  });

  it("the Design tab's draft edits end a session as well", () => {
    let state = act(undefined, update("Hello world"));
    state = workspaceReducer(state, {
      type: "draft/edit",
      update: (draft) => ({ ...draft, profile: { ...draft.profile, name: "Renamed" } }),
    });
    expect(state.history.past).toHaveLength(2);
    expect(state.history.session).toBeUndefined();
    void noirTokens;
  });

  it("block/update (a toolbar change, not a live edit) keeps its own coalescing as before", () => {
    let state = act(undefined, { type: "block/update", block: text(TEXT_ID, "Hello 1"), at: 0 });
    state = act(state, { type: "block/update", block: text(TEXT_ID, "Hello 12"), at: 100 });
    expect(state.history.past).toHaveLength(1);
  });
});
