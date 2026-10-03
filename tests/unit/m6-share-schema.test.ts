import { describe, expect, it } from "vitest";
import {
  LIMITS,
  SHARE_IMAGE_MIN_WIDTH,
  SHARE_IMAGE_WIDTH_MESSAGE,
  collectImageRefs,
  collectPublishErrors,
  draftDocSchema,
  emptyDraft,
  isShareEmpty,
  publishDocSchema,
  publishFormsEqual,
  publishShare,
  publishedDocSchema,
  shareDescriptionOf,
  shareTitleOf,
  toPublishForm,
  type DraftDoc,
  type ImageRef,
  type Share,
} from "@/lib/document";
import { loadDraft } from "@/lib/editor/load";
import { editorReducer, initialEditorState, type EditorState } from "@/lib/editor/state";
import { blocks, fullDraft, OWNER_UID } from "./fixtures/page-document";

/**
 * M6-32 (the share fields of the document) and the editor's share actions (M6-33): the limits, the
 * draft and Publish schemas, the Publish form, the image references, how a stored draft loads, and
 * the reducer. Control characters are built with String.fromCharCode so no hidden character sits
 * in this file.
 */

const pic = (over: Partial<ImageRef> = {}): ImageRef => ({
  path: `${OWNER_UID}/img-0123456789ab.webp`,
  width: 1200,
  height: 630,
  ...over,
});
const LINE_BREAK = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);
const BIDI_ISOLATE = String.fromCharCode(0x2066);

const base = (): DraftDoc => ({ ...emptyDraft("mara"), blocks: [blocks.link] }) as DraftDoc;
const withShare = (share: unknown): DraftDoc => ({ ...base(), share }) as DraftDoc;
const errorsOf = (share: unknown) => collectPublishErrors(withShare(share));
const shareErrors = (share: unknown) =>
  errorsOf(share).filter((error) => error.field.startsWith("share"));

describe("M6-32 limits", () => {
  it("are 70 and 200", () => {
    expect(LIMITS.shareTitle).toBe(70);
    expect(LIMITS.shareDescription).toBe(200);
    expect(SHARE_IMAGE_MIN_WIDTH).toBe(600);
    expect(SHARE_IMAGE_WIDTH_MESSAGE).toBe("Use an image at least 600 pixels wide.");
  });
});

describe("M6-32 the draft", () => {
  it("is optional: a document with no share still parses and emptyDraft has none", () => {
    expect(draftDocSchema.safeParse(base()).success).toBe(true);
    expect("share" in emptyDraft("mara")).toBe(false);
    expect(draftDocSchema.safeParse(fullDraft).success).toBe(true);
  });

  it("takes any subset of title, description and image (null image included)", () => {
    for (const share of [
      {},
      { title: "T" },
      { description: "D" },
      { image: null },
      { image: pic() },
      { title: "", description: "", image: null },
      { title: "T", description: "D", image: pic() },
    ]) {
      expect(draftDocSchema.safeParse(withShare(share)).success, JSON.stringify(share)).toBe(true);
    }
  });

  it("strips unknown keys, at the share and inside it", () => {
    const parsed = draftDocSchema.parse({
      ...withShare({ title: "T", extra: "x", image: { ...pic(), evil: "<script>" } }),
      unknown: 1,
    });
    expect(parsed.share).toEqual({ title: "T", image: pic() });
    expect("unknown" in parsed).toBe(false);
  });

  it("counts code points: 70 emoji are fine, 71 are not; 200 and 201 likewise", () => {
    const ok = Array.from({ length: 70 }, () => "\u{1F600}").join("");
    expect(draftDocSchema.safeParse(withShare({ title: ok })).success).toBe(true);
    expect(draftDocSchema.safeParse(withShare({ title: `${ok}x` })).success).toBe(false);
    expect(draftDocSchema.safeParse(withShare({ description: "d".repeat(200) })).success).toBe(
      true,
    );
    expect(draftDocSchema.safeParse(withShare({ description: "d".repeat(201) })).success).toBe(
      false,
    );
  });

  it("rejects a non-string title and a malformed image reference", () => {
    expect(draftDocSchema.safeParse(withShare({ title: 5 })).success).toBe(false);
    expect(draftDocSchema.safeParse(withShare({ image: { path: "x" } })).success).toBe(false);
    expect(draftDocSchema.safeParse(withShare("nope")).success).toBe(false);
  });
});

describe("M6-32 the Publish gate's schema", () => {
  it("accepts a clean share card", () => {
    expect(
      publishDocSchema.safeParse(
        withShare({ title: "Hear it", description: "Out now", image: pic() }),
      ).success,
    ).toBe(true);
  });

  it("names too long a title and a description with the one-line sentences", () => {
    expect(shareErrors({ title: "x".repeat(71) })).toEqual([
      { blockId: null, field: "share.title", message: "Use 70 characters or fewer." },
    ]);
    expect(shareErrors({ description: "y".repeat(201) })).toEqual([
      { blockId: null, field: "share.description", message: "Use 200 characters or fewer." },
    ]);
    // A 10 000-character title is the same sentence, one error.
    expect(shareErrors({ title: "z".repeat(10_000) })).toEqual([
      { blockId: null, field: "share.title", message: "Use 70 characters or fewer." },
    ]);
  });

  it("refuses a line break, a control character or a bidi override at Publish, and only there", () => {
    const sentence = "Remove line breaks and hidden control characters.";
    for (const bad of [
      `two${LINE_BREAK}lines`,
      `nul${NUL}byte`,
      `rtl${BIDI_OVERRIDE}override`,
      `isolate${BIDI_ISOLATE}here`,
    ]) {
      expect(draftDocSchema.safeParse(withShare({ title: bad, description: bad })).success).toBe(
        true,
      );
      expect(shareErrors({ title: bad })).toEqual([
        { blockId: null, field: "share.title", message: sentence },
      ]);
      expect(shareErrors({ description: bad })).toEqual([
        { blockId: null, field: "share.description", message: sentence },
      ]);
    }
  });

  it("refuses an image under 600 pixels wide, with the share.image field", () => {
    expect(shareErrors({ image: pic({ width: 599 }) })).toEqual([
      { blockId: null, field: "share.image", message: "Use an image at least 600 pixels wide." },
    ]);
    expect(shareErrors({ image: pic({ width: 600 }) })).toEqual([]);
    // A draft may hold it: only Publish refuses.
    expect(draftDocSchema.safeParse(withShare({ image: pic({ width: 100 }) })).success).toBe(true);
  });

  it("refuses an image that is not a stored reference: a URL, a path with .., another shape", () => {
    for (const path of [
      "https://evil.example/x.png",
      `${OWNER_UID}/../${OWNER_UID}/img-0123456789ab.webp`,
      "../../etc/passwd",
      `${OWNER_UID}/img-0123456789ab.svg`,
      "",
    ]) {
      const found = shareErrors({ image: pic({ path }) });
      expect(found, path).toHaveLength(1);
      expect(found[0]!.field).toBe("share.image.path");
      expect(found[0]!.message).toBe("Not a valid image reference.");
    }
  });

  it("refuses a focus outside the picture with the M6-23 sentence", () => {
    const found = shareErrors({ image: { ...pic(), focus: { x: 5, y: 0.5 } } });
    expect(found.map((error) => error.message)).toEqual(["Choose a focus point inside the image."]);
    expect(found[0]!.field).toMatch(/^share\.image\.focus/);
  });

  it("reports a hidden-block-free document with a bad share as the only problem", () => {
    const all = errorsOf({ title: "x".repeat(80), image: pic({ width: 10 }) });
    expect(all.map((error) => error.field).sort()).toEqual(["share.image", "share.title"]);
  });
});

describe("M6-32 toPublishForm", () => {
  const form = (share: Share | undefined) => toPublishForm(withShare(share), null);

  it("drops share completely when all three are empty, and for an absent share", () => {
    for (const share of [
      undefined,
      {},
      { title: "", description: "", image: null },
      { title: "   ", description: "\t", image: null },
    ]) {
      expect("share" in form(share as Share | undefined), JSON.stringify(share)).toBe(false);
    }
    expect(isShareEmpty({ title: "", description: "", image: null })).toBe(true);
    expect(isShareEmpty({ title: " ", description: "", image: null })).toBe(false);
  });

  it("trims and omits empty fields", () => {
    expect(form({ title: "  Hear it  ", description: "", image: null }).share).toEqual({
      title: "Hear it",
    });
    expect(form({ title: "", description: " Out now ", image: null }).share).toEqual({
      description: "Out now",
    });
    expect(form({ title: "", description: "", image: pic() }).share).toEqual({ image: pic() });
    expect(form({ title: "T", description: "D", image: pic() }).share).toEqual({
      title: "T",
      description: "D",
      image: pic(),
    });
  });

  it("keeps the focus rounded to 3 decimals, and leaves out a centered one", () => {
    expect(form({ image: { ...pic(), focus: { x: 0.123456, y: 0.987654 } } }).share).toEqual({
      image: { ...pic(), focus: { x: 0.123, y: 0.988 } },
    });
    expect(form({ image: { ...pic(), focus: { x: 0.5, y: 0.5 } } }).share).toEqual({
      image: pic(),
    });
    expect(form({ image: { ...pic(), focus: { x: 0.5004, y: 0.4996 } } }).share).toEqual({
      image: pic(),
    });
    expect(form({ image: { ...pic(), focus: { x: 0, y: 1 } } }).share).toEqual({
      image: { ...pic(), focus: { x: 0, y: 1 } },
    });
  });

  it("copies nothing but the known keys of the image", () => {
    const hostile = { ...pic(), evil: "<script>", focus: { x: 0.2, y: 0.3, z: 9 } } as ImageRef;
    expect(form({ image: hostile }).share!.image).toEqual({
      ...pic(),
      focus: { x: 0.2, y: 0.3 },
    });
  });

  it("is canonical: equal drafts give deep-equal forms, and a parsed stored form equals it", () => {
    const a = form({
      title: "T ",
      description: " D",
      image: { ...pic(), focus: { x: 0.25, y: 0.5 } },
    });
    const b = form({
      title: "T",
      description: "D",
      image: { ...pic(), focus: { x: 0.2500001, y: 0.5 } },
    });
    expect(publishFormsEqual(a, b)).toBe(true);
    const parsed = publishedDocSchema.parse(JSON.parse(JSON.stringify(a)));
    expect(publishFormsEqual(a, parsed)).toBe(true);
    // And a form without share equals its parsed copy: no share key appears from nowhere.
    const none = form(undefined);
    expect(
      publishFormsEqual(none, publishedDocSchema.parse(JSON.parse(JSON.stringify(none)))),
    ).toBe(true);
  });

  it("publishShare is pure and total", () => {
    expect(publishShare(undefined)).toBeUndefined();
    expect(publishShare({ title: "x" })).toEqual({ title: "x" });
    const input: Share = { title: " x ", description: "", image: null };
    const copy = JSON.stringify(input);
    publishShare(input);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe("M6-32 the published document", () => {
  const published = (share: unknown) => ({
    ...JSON.parse(JSON.stringify(toPublishForm(base(), null))),
    ...(share === undefined ? {} : { share }),
  });

  it("parses with and without share, strips unknown keys, and refuses a narrow image", () => {
    expect(publishedDocSchema.safeParse(published(undefined)).success).toBe(true);
    expect(publishedDocSchema.safeParse(published({ title: "T" })).success).toBe(true);
    expect(publishedDocSchema.parse(published({ title: "T", extra: 1 })).share).toEqual({
      title: "T",
    });
    expect(publishedDocSchema.safeParse(published({ image: pic({ width: 100 }) })).success).toBe(
      false,
    );
    expect(publishedDocSchema.safeParse(published({ title: "x".repeat(71) })).success).toBe(false);
    expect(
      publishedDocSchema.safeParse(
        published({ image: { ...pic(), path: "https://evil.example/x.png" } }),
      ).success,
    ).toBe(false);
  });
});

describe("M6-32 image references", () => {
  it("collectImageRefs lists the share image last, and only when set", () => {
    const draft = {
      ...fullDraft,
      share: { title: "T", description: "", image: pic() },
    } as DraftDoc;
    const refs = collectImageRefs(draft);
    expect(refs[refs.length - 1]).toEqual(pic());
    expect(collectImageRefs({ ...draft, share: { image: null } } as DraftDoc)).toEqual(
      collectImageRefs(fullDraft),
    );
    expect(collectImageRefs(fullDraft)).toEqual(
      collectImageRefs({ ...fullDraft, share: undefined }),
    );
  });
});

describe("M6-32 the title and the description of the preview", () => {
  it("fall back to the display name and the bio, trimmed", () => {
    expect(shareTitleOf(undefined, "Mara")).toBe("Mara");
    expect(shareTitleOf({ title: "  " }, "Mara")).toBe("Mara");
    expect(shareTitleOf({ title: " Hi " }, "Mara")).toBe("Hi");
    expect(shareDescriptionOf(undefined, "Bio")).toBe("Bio");
    expect(shareDescriptionOf({ description: "" }, "Bio")).toBe("Bio");
    expect(shareDescriptionOf({ description: " Words " }, "Bio")).toBe("Words");
  });
});

// The editor ----------------------------------------------------------------------------------

describe("M6-33 how a stored draft loads", () => {
  const stored = (share: unknown) => ({ ...base(), rev: 4, share });

  it("keeps a valid share as stored, raw strings included", () => {
    const loaded = loadDraft(stored({ title: "  Raw  ", description: "D", image: pic() }), "mara");
    expect(loaded.repaired).toBe(false);
    expect(loaded.draft.share).toEqual({ title: "  Raw  ", description: "D", image: pic() });
  });

  it("has no share key when there is none", () => {
    const loaded = loadDraft(base(), "mara");
    expect("share" in loaded.draft).toBe(false);
  });

  it("repairs an over-long title and an unreadable image instead of losing the document", () => {
    const loaded = loadDraft(
      stored({
        title: "t".repeat(500),
        description: `a${LINE_BREAK}b`,
        image: { path: "https://x" },
      }),
      "mara",
    );
    expect(loaded.repaired).toBe(true);
    expect(loaded.draft.share).toEqual({ title: "t".repeat(70), description: "a b", image: null });
    expect(loaded.draft.blocks).toHaveLength(1);
  });

  it("drops a share that has nothing readable in it", () => {
    for (const share of ["x", 5, null, { title: 5, description: false, image: 3 }]) {
      const loaded = loadDraft(stored(share), "mara");
      expect("share" in loaded.draft, JSON.stringify(share)).toBe(false);
    }
  });
});

describe("M6-33 the share actions", () => {
  const start = (share?: unknown): EditorState =>
    initialEditorState(share ? withShare(share) : base());
  const run = (state: EditorState, action: Parameters<typeof editorReducer>[1]) =>
    editorReducer(state, action);

  it("cut the title and the description at their limits, on one line", () => {
    let state = run(start(), { type: "share/title", value: "x".repeat(90) });
    expect(state.draft.share?.title).toBe("x".repeat(70));
    state = run(state, { type: "share/title", value: `one${LINE_BREAK}two` });
    expect(state.draft.share?.title).toBe("one two");
    state = run(state, { type: "share/description", value: "d".repeat(300) });
    expect(state.draft.share?.description).toBe("d".repeat(200));
    expect(state.draft.share).toEqual({
      title: "one two",
      description: "d".repeat(200),
      image: null,
    });
  });

  it("keep every raw character typed: no trim until Publish", () => {
    const state = run(start(), { type: "share/title", value: "  spaced  " });
    expect(state.draft.share?.title).toBe("  spaced  ");
  });

  it("remove the share key when all three fields are empty, and bring it back on the next edit", () => {
    let state = run(start(), { type: "share/title", value: "T" });
    state = run(state, { type: "share/description", value: "D" });
    state = run(state, { type: "share/image", value: pic() });
    expect(state.draft.share).toBeDefined();
    state = run(state, { type: "share/title", value: "" });
    state = run(state, { type: "share/description", value: "" });
    expect(state.draft.share).toBeDefined();
    state = run(state, { type: "share/image", value: null });
    expect("share" in state.draft).toBe(false);
    state = run(state, { type: "share/title", value: "again" });
    expect(state.draft.share).toEqual({ title: "again", description: "", image: null });
  });

  it("change nothing, and return the same state object, for a no-op", () => {
    const state = start();
    expect(run(state, { type: "share/title", value: "" })).toBe(state);
    expect(run(state, { type: "share/description", value: "" })).toBe(state);
    expect(run(state, { type: "share/image", value: null })).toBe(state);
    expect(run(state, { type: "share/focus", value: { x: 0.1, y: 0.1 } })).toBe(state);
    const filled = run(state, { type: "share/title", value: "T" });
    expect(run(filled, { type: "share/title", value: "T" })).toBe(filled);
  });

  it("set the image from an upload with no focus, and a new image resets the focus", () => {
    let state = run(start(), { type: "share/image", value: pic() });
    state = run(state, { type: "share/focus", value: { x: 0.123456, y: 0.9 } });
    expect(state.draft.share?.image).toEqual({ ...pic(), focus: { x: 0.123, y: 0.9 } });
    state = run(state, {
      type: "share/image",
      value: pic({ path: `${OWNER_UID}/img-ffffffffffff.webp` }),
    });
    expect(state.draft.share?.image).toEqual(pic({ path: `${OWNER_UID}/img-ffffffffffff.webp` }));
    expect("focus" in state.draft.share!.image!).toBe(false);
  });

  it("Center removes the focus key; a focus needs an image", () => {
    let state = run(start(), { type: "share/image", value: pic() });
    state = run(state, { type: "share/focus", value: { x: 0, y: 1 } });
    expect(state.draft.share?.image?.focus).toEqual({ x: 0, y: 1 });
    state = run(state, { type: "share/focus", value: null });
    expect("focus" in state.draft.share!.image!).toBe(false);
    expect(
      run(start(), { type: "share/focus", value: { x: 0.3, y: 0.3 } }).draft.share,
    ).toBeUndefined();
  });

  it("are undoable steps, and typing in one field is one step", () => {
    let state = start();
    const at = 1_000;
    state = run(state, { type: "share/title", value: "H", at });
    state = run(state, { type: "share/title", value: "He", at: at + 100 });
    state = run(state, { type: "share/title", value: "Hel", at: at + 200 });
    expect(state.history.past).toHaveLength(1);
    state = run(state, { type: "history/undo" });
    expect("share" in state.draft).toBe(false);
    state = run(state, { type: "history/redo" });
    expect(state.draft.share?.title).toBe("Hel");
  });

  it("keep the rest of the document as it was", () => {
    const before = start();
    const after = run(before, { type: "share/title", value: "T" });
    expect(after.draft.profile).toBe(before.draft.profile);
    expect(after.draft.blocks).toBe(before.draft.blocks);
    expect(after.draft.theme).toBe(before.draft.theme);
  });

  it("a Publish error on a share field asks for focus there; a block or the name comes first", () => {
    const state = start({ title: "T" });
    const error = (field: string, blockId: string | null = null) => ({
      blockId,
      field,
      message: "x",
    });
    expect(
      run(state, { type: "publish/errors", errors: [error("share.title")] }).focus,
    ).toMatchObject({
      kind: "share-field",
      field: "title",
    });
    expect(
      run(state, { type: "publish/errors", errors: [error("share.description")] }).focus,
    ).toMatchObject({ kind: "share-field", field: "description" });
    for (const field of ["share.image", "share.image.path", "share.image.focus.x"]) {
      expect(
        run(state, { type: "publish/errors", errors: [error(field)] }).focus,
        field,
      ).toMatchObject({
        kind: "share-field",
        field: "image",
      });
    }
    expect(
      run(state, { type: "publish/errors", errors: [error("share.title"), error("profile.name")] })
        .focus,
    ).toMatchObject({ kind: "profile-name" });
    expect(
      run(state, {
        type: "publish/errors",
        errors: [error("share.title"), error("label", blocks.link.id)],
      }).focus,
    ).toMatchObject({ kind: "invalid-input", blockId: blocks.link.id });
    // A block's own field called share.title never steals the focus.
    expect(
      run(state, { type: "publish/errors", errors: [error("share.title", blocks.link.id)] }).focus,
    ).not.toMatchObject({ kind: "share-field" });
  });

  it("a Publish error goes away as soon as the draft no longer has the problem", () => {
    let state = start({ title: "x".repeat(70) });
    // Build a state that holds a bad title directly, as a stale error would be.
    state = {
      ...state,
      draft: { ...state.draft, share: { title: "x".repeat(80), description: "", image: null } },
      publishErrors: [
        { blockId: null, field: "share.title", message: "Use 70 characters or fewer." },
      ],
    };
    state = run(state, { type: "share/title", value: "short" });
    expect(state.publishErrors).toEqual([]);
  });
});
