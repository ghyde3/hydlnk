import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  LIMITS,
  collectPublishErrors,
  draftDocSchema,
  newBlockId,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import {
  clampBio,
  clampName,
  editorReducer,
  errorKey,
  initialEditorState,
  reconcileErrors,
  type EditorAction,
  type EditorState,
} from "@/lib/editor/state";
import { blocks, fullDraft } from "./fixtures/page-document";

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);

const base = (...docBlocks: Block[]): EditorState =>
  initialEditorState({ ...fullDraft, blocks: docBlocks });

const ids = (state: EditorState) => state.draft.blocks.map((b) => b.id);

describe("profile (M2-07)", () => {
  it("clamps by code points: an emoji counts as 1", () => {
    const state = initialEditorState(fullDraft);
    const bio = run(state, { type: "profile/bio", value: "😀".repeat(200) });
    expect(Array.from(bio.draft.profile.bio)).toHaveLength(LIMITS.bio);
    const name = run(state, { type: "profile/name", value: "a".repeat(80) });
    expect(name.draft.profile.name).toHaveLength(LIMITS.displayName);
  });

  it("keeps what was typed: no trimming in the state", () => {
    const state = run(initialEditorState(fullDraft), { type: "profile/name", value: "  Mara " });
    expect(state.draft.profile.name).toBe("  Mara ");
  });

  it("keeps the name and the bio on one line", () => {
    expect(clampName("a\nb")).toBe("a b");
    expect(clampBio("one\r\ntwo")).toBe("one two");
  });

  it("returns the same state when nothing changes, so no autosave is scheduled", () => {
    const state = initialEditorState(fullDraft);
    expect(editorReducer(state, { type: "profile/name", value: fullDraft.profile.name })).toBe(
      state,
    );
    expect(editorReducer(state, { type: "profile/bio", value: fullDraft.profile.bio })).toBe(state);
    expect(editorReducer(state, { type: "profile/photo", value: fullDraft.profile.photo })).toBe(
      state,
    );
  });

  it("sets and clears the photo", () => {
    const photo = {
      path: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/abcdefgh.jpg",
      width: 4,
      height: 4,
    };
    const set = run(
      initialEditorState({ ...fullDraft, profile: { ...fullDraft.profile, photo: null } }),
      {
        type: "profile/photo",
        value: photo,
      },
    );
    expect(set.draft.profile.photo).toEqual(photo);
    expect(run(set, { type: "profile/photo", value: null }).draft.profile.photo).toBeNull();
  });
});

describe("add a block (M2-10)", () => {
  it.each(BLOCK_TYPES)("adds a %s at the end, expanded, with a request to focus it", (type) => {
    const state = run(base(blocks.link), { type: "block/add", blockType: type });
    expect(state.draft.blocks).toHaveLength(2);
    const added = state.draft.blocks[1]!;
    expect(added.type).toBe(type);
    expect(added.visible).toBe(true);
    expect(state.expandedId).toBe(added.id);
    expect(state.focus).toMatchObject({
      kind: type === "divider" ? "row" : "first-input",
      blockId: added.id,
    });
    expect(draftDocSchema.safeParse(state.draft).success).toBe(true);
  });

  it("uses the documented defaults", () => {
    const state = run(
      base(),
      ...BLOCK_TYPES.map((blockType): EditorAction => ({ type: "block/add", blockType })),
    );
    const byType = Object.fromEntries(state.draft.blocks.map((b) => [b.type, b]));
    expect(byType.link).toMatchObject({ label: "New link", url: "" });
    expect(byType.card).toMatchObject({ title: "New card", caption: "", url: "", image: null });
    expect(byType.header).toMatchObject({ text: "New section" });
    expect(byType.text).toMatchObject({ text: "New text block" });
    expect(byType.image).toMatchObject({ image: null, alt: "" });
    expect(byType.embed).toMatchObject({ url: "", caption: "Video or music" });
    expect(byType.social).toMatchObject({ icons: [{ platform: "instagram", url: "" }] });
    expect((byType.grid as { cells: unknown[] }).cells).toHaveLength(2);
    expect(byType.divider).toMatchObject({ type: "divider" });
    expect(byType.faq).toMatchObject({ items: [{ question: "", answer: "" }] });
    expect(byType.contact).toMatchObject({ name: "", phone: "", email: "", hours: "" });
    expect(byType.discount).toMatchObject({ code: "", description: "", url: "" });
    expect(new Set(ids(state)).size).toBe(BLOCK_TYPES.length);
  });

  it("does nothing at the 50-block limit", () => {
    const fifty = Array.from({ length: LIMITS.blocks }, () => ({
      ...blocks.divider,
      id: newBlockId(),
    }));
    const state = base(...fifty);
    expect(editorReducer(state, { type: "block/add", blockType: "link" })).toBe(state);
  });
});

describe("visibility (M2-12)", () => {
  it("toggles visible and back, keeping the position", () => {
    const state = base(blocks.link, blocks.header, blocks.text);
    const hidden = run(state, { type: "block/toggle-visible", id: blocks.header.id });
    expect(hidden.draft.blocks[1]).toMatchObject({ id: blocks.header.id, visible: false });
    const shown = run(hidden, { type: "block/toggle-visible", id: blocks.header.id });
    expect(shown.draft.blocks[1]).toMatchObject({ visible: true });
    expect(ids(shown)).toEqual(ids(state));
  });
});

describe("delete and undo (M2-13)", () => {
  it("removes the block, closes its panel and keeps it for undo with its index", () => {
    const state = run(base(blocks.link, blocks.header, blocks.text), {
      type: "block/toggle-expanded",
      id: blocks.header.id,
    });
    const deleted = run(state, { type: "block/delete", id: blocks.header.id });
    expect(ids(deleted)).toEqual([blocks.link.id, blocks.text.id]);
    expect(deleted.expandedId).toBeNull();
    expect(deleted.deleted).toMatchObject({ index: 1, block: blocks.header });
  });

  it("undo puts the same block back at the same index", () => {
    const original = base(blocks.link, blocks.header, blocks.text);
    const restored = run(
      original,
      { type: "block/delete", id: blocks.header.id },
      { type: "block/undo-delete" },
    );
    expect(restored.draft.blocks).toEqual(original.draft.blocks);
    expect(restored.deleted).toBeNull();
  });

  it("undo of the last block restores it at the end; deleting the only block leaves none", () => {
    const only = run(base(blocks.link), { type: "block/delete", id: blocks.link.id });
    expect(only.draft.blocks).toEqual([]);
    expect(run(only, { type: "block/undo-delete" }).draft.blocks).toEqual([blocks.link]);
  });

  it("after the timeout the toast token no longer restores anything", () => {
    const deleted = run(base(blocks.link, blocks.header), {
      type: "block/delete",
      id: blocks.link.id,
    });
    const token = deleted.deleted!.token;
    const expired = run(deleted, { type: "toast/dismiss", token });
    expect(expired.deleted).toBeNull();
    expect(run(expired, { type: "block/undo-delete" })).toBe(expired);
  });

  it("a stale dismiss does not close the toast of a newer delete", () => {
    const first = run(base(blocks.link, blocks.header, blocks.text), {
      type: "block/delete",
      id: blocks.link.id,
    });
    const second = run(first, { type: "block/delete", id: blocks.header.id });
    expect(run(second, { type: "toast/dismiss", token: first.deleted!.token })).toBe(second);
  });
});

describe("reorder (M2-14)", () => {
  const five = () =>
    base(
      ...["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd", "eeeeeeee"].map((id) => ({
        ...blocks.divider,
        id,
      })),
    );

  it("drag: moves the first of five below the third; ids unchanged; the open row stays open", () => {
    const state = run(five(), { type: "block/toggle-expanded", id: "aaaaaaaa" });
    const moved = run(state, { type: "block/reorder", activeId: "aaaaaaaa", overId: "cccccccc" });
    expect(ids(moved)).toEqual(["bbbbbbbb", "cccccccc", "aaaaaaaa", "dddddddd", "eeeeeeee"]);
    expect(moved.expandedId).toBe("aaaaaaaa");
  });

  it("Move up and Move down shift one place and announce the position", () => {
    const down = run(five(), { type: "block/move", id: "aaaaaaaa", delta: 1 });
    expect(ids(down).slice(0, 2)).toEqual(["bbbbbbbb", "aaaaaaaa"]);
    expect(down.announcement).toBe("Moved to position 2 of 5");
    const up = run(down, { type: "block/move", id: "aaaaaaaa", delta: -1 });
    expect(up.announcement).toBe("Moved to position 1 of 5");
    expect(up.announceSeq).toBe(2);
  });

  it("cannot move the first block up or the last block down", () => {
    const state = five();
    expect(editorReducer(state, { type: "block/move", id: "aaaaaaaa", delta: -1 })).toBe(state);
    expect(editorReducer(state, { type: "block/move", id: "eeeeeeee", delta: 1 })).toBe(state);
  });

  it("dropping on itself changes nothing", () => {
    const state = five();
    expect(
      editorReducer(state, { type: "block/reorder", activeId: "aaaaaaaa", overId: "aaaaaaaa" }),
    ).toBe(state);
  });
});

describe("publish errors (M2-24)", () => {
  const broken = (): DraftDoc => ({
    ...fullDraft,
    blocks: [
      { ...blocks.link, id: "link-broken-1", url: "" },
      blocks.header,
      { ...blocks.embed, id: "embed-broken1", url: "https://example.com/video" },
      { ...blocks.image, id: "image-broken1", alt: "" },
    ],
  });

  it("opens and focuses the first failing block (in page order)", () => {
    const draft = broken();
    const errors = collectPublishErrors(draft);
    const state = run(initialEditorState(draft), { type: "publish/errors", errors });
    expect(state.expandedId).toBe("link-broken-1");
    expect(state.focus).toMatchObject({ kind: "invalid-input", blockId: "link-broken-1" });
    expect(new Set(state.publishErrors.map((e) => e.blockId))).toEqual(
      new Set(["link-broken-1", "embed-broken1", "image-broken1"]),
    );
  });

  it("a name error focuses the Display name field when no block failed", () => {
    const draft: DraftDoc = { ...fullDraft, profile: { ...fullDraft.profile, name: "" } };
    const state = run(initialEditorState(draft), {
      type: "publish/errors",
      errors: collectPublishErrors(draft),
    });
    expect(state.focus).toMatchObject({ kind: "profile-name" });
  });

  it("fixing a field clears its error as soon as it validates and leaves the others", () => {
    const draft = broken();
    let state = run(initialEditorState(draft), {
      type: "publish/errors",
      errors: collectPublishErrors(draft),
    });
    const fixed = { ...draft.blocks[0]!, url: "https://example.com" } as Block;
    state = run(state, { type: "block/update", block: fixed });
    expect(state.publishErrors.map((e) => e.blockId)).not.toContain("link-broken-1");
    expect(state.publishErrors.map((e) => e.blockId)).toContain("embed-broken1");
  });

  it("does not add errors for fields the user has not been told about", () => {
    const draft = broken();
    const only = collectPublishErrors(draft).filter((e) => e.blockId === "link-broken-1");
    let state = run(initialEditorState(draft), { type: "publish/errors", errors: only });
    // Break something else: the list of shown errors stays what Publish returned.
    state = run(state, { type: "block/update", block: { ...blocks.header, text: "" } });
    expect(state.publishErrors.map((e) => e.blockId)).toEqual(["link-broken-1"]);
  });

  it("deleting a failing block drops its error", () => {
    const draft = broken();
    let state = run(initialEditorState(draft), {
      type: "publish/errors",
      errors: collectPublishErrors(draft),
    });
    state = run(state, { type: "block/delete", id: "link-broken-1" });
    expect(state.publishErrors.map((e) => e.blockId)).not.toContain("link-broken-1");
  });

  it("reconcileErrors returns the same list when nothing changed", () => {
    const draft = broken();
    const errors = collectPublishErrors(draft);
    expect(reconcileErrors(errors, draft)).toBe(errors);
    expect(reconcileErrors([], draft)).toEqual([]);
  });

  it("errorKey identifies block, item and field", () => {
    expect(errorKey({ blockId: "a", itemId: "b", field: "url", message: "x" })).toBe("a|b|url");
    expect(errorKey({ blockId: null, field: "profile.name", message: "x" })).toBe("||profile.name");
  });
});

describe("block/set-image (an upload finished)", () => {
  const photo = {
    path: "00000000-0000-4000-8000-000000000001/abcdefgh.png",
    width: 10,
    height: 10,
  };

  it("sets the image on the block as it is now, keeping text typed while the file was uploading", () => {
    const image = { ...blocks.image, alt: "old alt", image: null } as Block;
    let state = initialEditorState({ ...fullDraft, blocks: [image] });
    // The user types the alt text while the upload is in flight ...
    state = run(state, {
      type: "block/update",
      block: { ...image, alt: "typed meanwhile" } as Block,
    });
    // ... and the upload lands afterwards.
    state = run(state, { type: "block/set-image", id: image.id, image: photo });
    expect(state.draft.blocks[0]).toMatchObject({ alt: "typed meanwhile", image: photo });
  });

  it("works for card blocks, removes with null, and ignores other types and unknown ids", () => {
    const card = { ...blocks.card, title: "T", image: null } as Block;
    const base = initialEditorState({ ...fullDraft, blocks: [card, blocks.header] });
    const set = run(base, { type: "block/set-image", id: card.id, image: photo });
    expect(set.draft.blocks[0]).toMatchObject({ title: "T", image: photo });
    const removed = run(set, { type: "block/set-image", id: card.id, image: null });
    expect(removed.draft.blocks[0]).toMatchObject({ image: null });
    expect(run(base, { type: "block/set-image", id: blocks.header.id, image: photo })).toBe(base);
    expect(run(base, { type: "block/set-image", id: "nope", image: photo })).toBe(base);
  });

  it("M6-21 sets a link's thumbnail as its icon, replacing a built-in one, and null removes the icon key", () => {
    const withIcon = { ...blocks.link, icon: { type: "builtin", name: "star" } } as Block;
    let state = initialEditorState({ ...fullDraft, blocks: [withIcon] });
    // Typed while the file was on its way: kept.
    state = run(state, {
      type: "block/update",
      block: { ...withIcon, label: "typed meanwhile" } as Block,
    });
    state = run(state, { type: "block/set-image", id: withIcon.id, image: photo });
    expect(state.draft.blocks[0]).toMatchObject({
      label: "typed meanwhile",
      icon: { type: "image", image: photo },
    });
    // Never both kinds: the built-in name is gone.
    expect((state.draft.blocks[0] as { icon: object }).icon).toEqual({
      type: "image",
      image: photo,
    });
    // Removing clears the key; a link that never had an icon is a new draft only if it changed.
    state = run(state, { type: "block/set-image", id: withIcon.id, image: null });
    expect("icon" in state.draft.blocks[0]!).toBe(false);
    expect(state.draft.blocks[0]).toMatchObject({ label: "typed meanwhile" });
    // It is one undo step each: undo brings the thumbnail back.
    expect(state.history.past.length).toBeGreaterThan(1);
  });
});
