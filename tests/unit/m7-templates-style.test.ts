import { describe, expect, it } from "vitest";
import { draftDocSchema, emptyDraft, type Block, type DraftDoc } from "@/lib/document";
import { canRedo, canUndo } from "@/lib/editor/history";
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from "@/lib/editor/state";
import {
  TEMPLATES,
  applyTemplate,
  defaultTemplateStyle,
  isTemplateStyle,
  templateById,
  type TemplateStyle,
} from "@/lib/templates";
import { blocks as fixtureBlocks, fullDraft } from "./fixtures/page-document";

/**
 * M7-08, the choice an apply asks: which style is selected by default, what each style changes
 * (the blocks always; the theme only for "the template's style") and what neither ever touches, and
 * the reducer's `template/apply` action with its `style`.
 */

const run = (state: EditorState, ...actions: EditorAction[]) =>
  actions.reduce(editorReducer, state);
const apply = (id: string, style: TemplateStyle): EditorAction => ({
  type: "template/apply",
  templateId: id,
  style,
});
const withoutRev = (draft: DraftDoc) => {
  const copy: Partial<DraftDoc> = { ...draft };
  delete copy.rev;
  return copy;
};

const THEME = "00000000-0000-4000-8000-000000000001";
const dividers = (count: number): Block[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `Div${String(i).padStart(7, "0")}`,
    type: "divider",
    visible: true,
  }));

/** The six shapes of page the choice has to handle, each with the default it should open on. */
const SHAPES: { name: string; draft: DraftDoc; style: TemplateStyle }[] = [
  { name: "an empty page", draft: emptyDraft("mara"), style: "template" },
  {
    name: "blocks and no style of its own",
    draft: { ...emptyDraft("mara"), blocks: [fixtureBlocks.link, fixtureBlocks.text] as Block[] },
    style: "template",
  },
  {
    name: "a theme applied, no overrides",
    draft: { ...emptyDraft("mara"), theme: { ref: THEME, overrides: {} } },
    style: "keep",
  },
  {
    name: "page-level overrides only",
    draft: { ...emptyDraft("mara"), theme: { ref: null, overrides: { accent: "#C46A4F" } } },
    style: "keep",
  },
  {
    name: "a theme and overrides, with blocks",
    draft: {
      ...fullDraft,
      theme: { ref: THEME, overrides: { accent: "#C46A4F", radius: 16 } },
    },
    style: "keep",
  },
  {
    name: "50 blocks, a theme, a background image, a share card and a photo",
    draft: {
      ...fullDraft,
      share: { title: "Mara", description: "Portraits", image: null },
      theme: {
        ref: THEME,
        overrides: {
          bgType: "image",
          bgImage: "http://127.0.0.1:54321/storage/v1/object/public/page-media/u/bg.jpg",
        },
      },
      blocks: dividers(50),
    },
    style: "keep",
  },
];

describe("M7-08 defaultTemplateStyle", () => {
  it.each(SHAPES)("$name opens on $style", ({ draft, style }) => {
    expect(defaultTemplateStyle(draft)).toBe(style);
  });

  it("is the template's style only when there is no theme and no page-level override", () => {
    const base = emptyDraft("x");
    expect(defaultTemplateStyle(base)).toBe("template");
    expect(defaultTemplateStyle({ ...base, theme: { ref: THEME, overrides: {} } })).toBe("keep");
    expect(defaultTemplateStyle({ ...base, theme: { ref: null, overrides: { radius: 0 } } })).toBe(
      "keep",
    );
    expect(defaultTemplateStyle({ ...base, theme: { ref: THEME, overrides: { radius: 0 } } })).toBe(
      "keep",
    );
  });

  it("does not look at blocks, the name, the bio or the share card", () => {
    const base = emptyDraft("x");
    expect(
      defaultTemplateStyle({
        ...base,
        profile: { ...base.profile, name: "Someone", bio: "A bio" },
        share: { title: "t" },
        blocks: dividers(50),
      }),
    ).toBe("template");
  });
});

describe("M7-08 isTemplateStyle", () => {
  it("accepts the two styles and nothing else", () => {
    expect(isTemplateStyle("template")).toBe(true);
    expect(isTemplateStyle("keep")).toBe(true);
    for (const value of [undefined, null, "", "Template", "keep ", "both", 1, true, {}, []]) {
      expect(isTemplateStyle(value)).toBe(false);
    }
  });
});

describe("M7-08 applyTemplate with a style", () => {
  it.each(SHAPES)(
    "$name: both styles replace the blocks and nothing about the person",
    ({ draft }) => {
      for (const template of TEMPLATES) {
        for (const style of ["template", "keep"] as const) {
          const next = applyTemplate(draft, template, style);
          expect(next.blocks).toHaveLength(template.blocks.length);
          expect(next.blocks.length).toBeLessThanOrEqual(50);
          expect(next.blocks.every((block) => block.visible === true)).toBe(true);
          // The name, the photo and every photo option, the share card and `rev` are never touched.
          expect(next.profile.name).toBe(draft.profile.name);
          expect(next.profile.photo).toEqual(draft.profile.photo);
          expect({ ...next.profile, bio: "" }).toEqual({ ...draft.profile, bio: "" });
          expect(next.share).toEqual(draft.share);
          expect(next.rev).toBe(draft.rev);
          // The sample bio is written only when the bio is empty.
          expect(next.profile.bio).toBe(
            draft.profile.bio.trim() === "" ? template.bio : draft.profile.bio,
          );
        }
      }
    },
  );

  it.each(SHAPES)(
    "$name: the template's style sets the theme reference and clears the overrides",
    ({ draft }) => {
      for (const template of TEMPLATES) {
        expect(applyTemplate(draft, template, "template").theme).toEqual({
          ref: template.theme.id,
          overrides: {},
        });
        // No style argument is the template's style (M6-40).
        expect(applyTemplate(draft, template).theme).toEqual({
          ref: template.theme.id,
          overrides: {},
        });
      }
    },
  );

  it.each(SHAPES)(
    "$name: keep my style leaves the theme reference and the overrides deep-equal",
    ({ draft }) => {
      for (const template of TEMPLATES) {
        expect(applyTemplate(draft, template, "keep").theme).toEqual(draft.theme);
      }
    },
  );

  it("the result is a valid draft for both styles when the page had no image in its style", () => {
    const draft = SHAPES[4]!.draft;
    for (const style of ["template", "keep"] as const) {
      const next = applyTemplate(draft, templateById("shop")!, style);
      expect(draftDocSchema.safeParse(next).success).toBe(true);
    }
  });
});

describe("M7-08 the reducer's template/apply action", () => {
  it("any other or missing style returns the same state object", () => {
    const state = initialEditorState(SHAPES[4]!.draft);
    const bad = [undefined, null, "", "Template", "keep my style", "both", 1, {}, []];
    for (const style of bad) {
      const action = {
        type: "template/apply",
        templateId: "musician",
        style,
      } as unknown as EditorAction;
      expect(editorReducer(state, action)).toBe(state);
    }
    const missing = { type: "template/apply", templateId: "musician" } as unknown as EditorAction;
    expect(editorReducer(state, missing)).toBe(state);
    // An unknown template stays a no-op for either style.
    expect(editorReducer(state, apply("nope", "template"))).toBe(state);
    expect(editorReducer(state, apply("nope", "keep"))).toBe(state);
  });

  it.each(SHAPES)(
    "$name: the template's style gives the template's theme, keep gives the page's own",
    ({ draft }) => {
      const template = templateById("coach")!;
      const before = initialEditorState(draft);
      const styled = run(before, apply("coach", "template"));
      expect(styled.draft.theme).toEqual({ ref: template.theme.id, overrides: {} });
      expect(styled.draft.blocks).toHaveLength(template.blocks.length);
      const kept = run(before, apply("coach", "keep"));
      expect(kept.draft.theme).toEqual(draft.theme);
      expect(kept.draft.blocks).toHaveLength(template.blocks.length);
      // The same blocks either way: only the style differs.
      expect(kept.draft.blocks.map((block) => block.type)).toEqual(
        styled.draft.blocks.map((block) => block.type),
      );
    },
  );

  it.each(["template", "keep"] as const)(
    "%s: one undo step, and Undo restores the draft deep-equal, theme and overrides included, Redo applies it again",
    (style) => {
      for (const { draft } of SHAPES) {
        const before = initialEditorState(draft);
        const applied = run(before, apply("streamer", style));
        expect(applied.history.past).toHaveLength(1);
        expect(canUndo(applied.history)).toBe(true);

        const undone = run(applied, { type: "history/undo" });
        expect(withoutRev(undone.draft)).toEqual(withoutRev(before.draft));
        expect(undone.draft.theme).toEqual(draft.theme);
        expect(canUndo(undone.history)).toBe(false);
        expect(canRedo(undone.history)).toBe(true);

        const redone = run(undone, { type: "history/redo" });
        expect(withoutRev(redone.draft)).toEqual(withoutRev(applied.draft));
      }
    },
  );

  it("keeps the toast: the template's name and the draft the apply made, for both styles", () => {
    for (const style of ["template", "keep"] as const) {
      const state = run(initialEditorState(SHAPES[4]!.draft), apply("musician", style));
      expect(state.templateToast).toMatchObject({ name: "Musician" });
      expect(state.templateToast!.draft).toBe(state.draft);
    }
  });

  it("never pushes a page past 50 blocks: it replaces them, for both styles", () => {
    for (const style of ["template", "keep"] as const) {
      for (const template of TEMPLATES) {
        const state = run(initialEditorState(SHAPES[5]!.draft), apply(template.id, style));
        expect(state.draft.blocks).toHaveLength(template.blocks.length);
      }
    }
  });
});
