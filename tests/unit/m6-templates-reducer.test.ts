import { describe, expect, it } from "vitest";
import {
  collectPublishErrors,
  draftDocSchema,
  emptyDraft,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { canRedo, canUndo } from "@/lib/editor/history";
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from "@/lib/editor/state";
import { TEMPLATES, templateById } from "@/lib/templates";
import { blocks as fixtureBlocks, fullDraft } from "./fixtures/page-document";

/**
 * M6-40 in the editor reducer: `template/apply` is one edit and one undo step, replaces blocks,
 * theme, page-level overrides and (when empty) the bio, and nothing else; its toast belongs to the
 * draft it made, so any other change takes it away and Undo can only ever undo the template.
 */

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);

const apply = (id: string): EditorAction => ({ type: "template/apply", templateId: id });

const page = (): DraftDoc => ({
  ...fullDraft,
  rev: 4,
  profile: { ...fullDraft.profile, bio: "My own bio" },
  theme: { ref: "00000000-0000-4000-8000-000000000001", overrides: { accent: "#C46A4F" } },
  blocks: [fixtureBlocks.link, fixtureBlocks.header, fixtureBlocks.text] as Block[],
});

const withoutRev = (draft: DraftDoc) => {
  const copy: Partial<DraftDoc> = { ...draft };
  delete copy.rev;
  return copy;
};

describe("M6-40 template/apply", () => {
  it("replaces the blocks, theme and overrides in one edit, keeps name, photo and a written bio", () => {
    const state = run(initialEditorState(page()), apply("musician"));
    const musician = templateById("musician")!;
    expect(state.draft.blocks).toHaveLength(musician.blocks.length);
    expect(state.draft.theme).toEqual({ ref: musician.theme.id, overrides: {} });
    expect(state.draft.profile).toEqual(page().profile);
    expect(state.draft.rev).toBe(4);
    expect(draftDocSchema.safeParse(state.draft).success).toBe(true);
  });

  it("sets the sample bio only when the bio is empty", () => {
    const empty = run(initialEditorState(emptyDraft("mara")), apply("coach"));
    expect(empty.draft.profile.bio).toBe("Clear steps, honest feedback, real results.");
    expect(empty.draft.profile.name).toBe("mara");
  });

  it("is one undo step: Undo restores the earlier draft exactly, Redo brings the template back", () => {
    const before = initialEditorState(page());
    const applied = run(before, apply("shop"));
    expect(canUndo(applied.history)).toBe(true);
    expect(applied.history.past).toHaveLength(1);

    const undone = run(applied, { type: "history/undo" });
    expect(withoutRev(undone.draft)).toEqual(withoutRev(before.draft));
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);

    const redone = run(undone, { type: "history/redo" });
    expect(withoutRev(redone.draft)).toEqual(withoutRev(applied.draft));
  });

  it("applying twice makes two steps, and the second block list shares no id with the first", () => {
    const once = run(initialEditorState(page()), apply("artist"));
    const twice = run(once, apply("artist"));
    expect(twice.history.past).toHaveLength(2);
    const ids = (draft: DraftDoc) =>
      draft.blocks.flatMap((block) => [
        block.id,
        ...(block.type === "social" ? block.icons.map((icon) => icon.id) : []),
        ...(block.type === "grid" ? block.cells.map((cell) => cell.id) : []),
      ]);
    const first = new Set(ids(once.draft));
    expect(ids(twice.draft).filter((id) => first.has(id))).toEqual([]);
  });

  it("closes the open row, drops a Block deleted toast, and drops publish errors for blocks that are gone", () => {
    let state = initialEditorState(page());
    state = run(
      state,
      { type: "expand", id: fixtureBlocks.link.id },
      { type: "block/delete", id: fixtureBlocks.text.id },
      {
        type: "publish/errors",
        errors: collectPublishErrors({
          ...state.draft,
          blocks: [{ ...fixtureBlocks.link, url: "" } as Block],
        }),
      },
    );
    expect(state.expandedId).not.toBeNull();
    expect(state.deleted).not.toBeNull();
    state = run(state, apply("streamer"));
    expect(state.expandedId).toBeNull();
    expect(state.deleted).toBeNull();
    expect(
      state.publishErrors.every((error) =>
        state.draft.blocks.some((block) => block.id === error.blockId),
      ),
    ).toBe(true);
  });

  it("an id that is not in the catalog changes nothing (the same state object comes back)", () => {
    const state = initialEditorState(page());
    expect(editorReducer(state, apply("nope"))).toBe(state);
    expect(editorReducer(state, apply("__proto__"))).toBe(state);
  });

  it("every template applies, to an empty page and to a full one, within 50 blocks", () => {
    const full = {
      ...emptyDraft("x"),
      blocks: Array.from({ length: 50 }, (_, i): Block => ({
        id: `Div${String(i).padStart(7, "0")}`,
        type: "divider",
        visible: true,
      })),
    };
    for (const template of TEMPLATES) {
      for (const start of [emptyDraft("x"), full]) {
        const state = run(initialEditorState(start), apply(template.id));
        expect(state.draft.blocks).toHaveLength(template.blocks.length);
        expect(state.draft.blocks.length).toBeLessThanOrEqual(50);
      }
    }
  });
});

describe("M6-40 the template toast", () => {
  it("is set by an apply, with the template's name and the draft the apply made", () => {
    const state = run(initialEditorState(page()), apply("musician"));
    expect(state.templateToast).toMatchObject({ name: "Musician" });
    expect(state.templateToast!.draft).toBe(state.draft);
  });

  it("a second apply restarts it (a new token)", () => {
    const one = run(initialEditorState(page()), apply("musician"));
    const two = run(one, apply("coach"));
    expect(two.templateToast!.name).toBe("Coach");
    expect(two.templateToast!.token).not.toBe(one.templateToast!.token);
  });

  it("any other change to the draft takes it away: an edit, Undo, Redo", () => {
    const applied = run(initialEditorState(page()), apply("musician"));
    const edited = run(applied, { type: "profile/name", value: "Someone else" });
    expect(edited.templateToast).toBeNull();

    const undone = run(applied, { type: "history/undo" });
    expect(undone.templateToast).toBeNull();
    const redone = run(undone, { type: "history/redo" });
    expect(redone.templateToast).toBeNull();

    const blockEdit = run(applied, {
      type: "block/toggle-visible",
      id: applied.draft.blocks[0]!.id,
    });
    expect(blockEdit.templateToast).toBeNull();
  });

  it("screen-only actions leave it (opening a row, focus)", () => {
    const applied = run(initialEditorState(page()), apply("musician"));
    const opened = run(applied, { type: "block/toggle-expanded", id: applied.draft.blocks[1]!.id });
    expect(opened.templateToast).toBe(applied.templateToast);
  });

  it("dismiss removes it only for its own token", () => {
    const applied = run(initialEditorState(page()), apply("musician"));
    const stale = run(applied, {
      type: "template/dismiss",
      token: applied.templateToast!.token + 1,
    });
    expect(stale.templateToast).not.toBeNull();
    const gone = run(applied, { type: "template/dismiss", token: applied.templateToast!.token });
    expect(gone.templateToast).toBeNull();
    expect(gone.draft).toBe(applied.draft);
  });

  it("an Undo guarded by the toast's draft is dropped once the draft has moved on", () => {
    const applied = run(initialEditorState(page()), apply("musician"));
    const guard = applied.templateToast!.draft;
    const edited = run(applied, { type: "profile/name", value: "Edited" });
    const stepped = run(edited, { type: "history/undo", expect: guard });
    expect(stepped).toBe(edited);
  });
});
