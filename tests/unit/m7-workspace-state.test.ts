import { describe, expect, it } from "vitest";
import { emptyDraft, type DraftDoc, type PublishError } from "@/lib/document";
import { initialEditorState, type EditorState } from "@/lib/editor/state";
import { failureTab } from "@/components/workspace/failure-tab";
import { workspaceReducer } from "@/components/workspace/workspace-reducer";
import { hiddenParts } from "@/components/editor/profile-hidden";
import { WORKSPACE_TABS } from "@/components/workspace/workspace-context";

/**
 * M7-02: the workspace's one reducer. The Design tab's controls and the saved-themes hook write the
 * draft with a plain function (`draft/edit`); those edits and the Edit tab's named actions share ONE
 * history, so one Undo walks back across tabs.
 */

const base = (): EditorState => initialEditorState(emptyDraft("zq-ws"));
const withRadius =
  (radius: number) =>
  (draft: DraftDoc): DraftDoc => ({
    ...draft,
    theme: { ...draft.theme, overrides: { ...draft.theme.overrides, radius } },
  });

describe("M7-02 workspaceReducer: draft/edit", () => {
  it("returns the same state object when the function returns the draft it was given", () => {
    const state = base();
    expect(workspaceReducer(state, { type: "draft/edit", update: (draft) => draft })).toBe(state);
  });

  it("records a real change as one undo step and keeps the editor's own actions in the same history", () => {
    let state = base();
    state = workspaceReducer(state, { type: "profile/name", value: "Mara", at: 1_000 });
    state = workspaceReducer(state, { type: "draft/edit", update: withRadius(20), at: 5_000 });
    state = workspaceReducer(state, { type: "share/title", value: "Hello", at: 9_000 });
    expect(state.history.past).toHaveLength(3);
    expect(state.draft.theme.overrides.radius).toBe(20);

    state = workspaceReducer(state, { type: "history/undo" });
    expect(state.draft.share).toBeUndefined();
    expect(state.draft.theme.overrides.radius).toBe(20);
    state = workspaceReducer(state, { type: "history/undo" });
    expect(state.draft.theme.overrides.radius).toBeUndefined();
    expect(state.draft.profile.name).toBe("Mara");
    state = workspaceReducer(state, { type: "history/undo" });
    expect(state.draft.profile.name).toBe(emptyDraft("zq-ws").profile.name);
    expect(state.history.past).toHaveLength(0);
    // And forward again.
    for (let i = 0; i < 3; i++) state = workspaceReducer(state, { type: "history/redo" });
    expect(state.draft.share?.title).toBe("Hello");
    expect(state.draft.theme.overrides.radius).toBe(20);
  });

  it("merges edits of one typing group within a second, and edits of one batch whatever their group", () => {
    let state = base();
    state = workspaceReducer(state, {
      type: "draft/edit",
      update: withRadius(4),
      group: "theme:blur",
      at: 1_000,
    });
    state = workspaceReducer(state, {
      type: "draft/edit",
      update: withRadius(12),
      group: "theme:blur",
      at: 1_400,
    });
    expect(state.history.past).toHaveLength(1);
    state = workspaceReducer(state, {
      type: "draft/edit",
      update: withRadius(20),
      group: "theme:blur",
      at: 3_000,
    });
    expect(state.history.past).toHaveLength(2);
    state = workspaceReducer(state, {
      type: "draft/edit",
      update: withRadius(0),
      batch: 7,
      at: 9_000,
    });
    state = workspaceReducer(state, {
      type: "draft/edit",
      update: (draft) => ({
        ...draft,
        theme: { ...draft.theme, overrides: { ...draft.theme.overrides, accent: "#112233" } },
      }),
      batch: 7,
      at: 9_001,
    });
    expect(state.history.past).toHaveLength(3);
  });

  it("drops the template toast when a new draft arrives, and reconciles publish errors", () => {
    let state = base();
    state = workspaceReducer(state, {
      type: "template/apply",
      templateId: "musician",
      style: "template",
    });
    expect(state.templateToast).not.toBeNull();
    state = workspaceReducer(state, { type: "draft/edit", update: withRadius(12) });
    expect(state.templateToast).toBeNull();
  });
});

describe("M7-02 where a refused Publish takes you", () => {
  const err = (field: string, blockId: string | null = null): PublishError => ({
    field,
    blockId,
    message: "x",
  });
  it("goes by the first error in the order profile, blocks, share, page", () => {
    expect(failureTab([err("share.title"), err("url", "b1")])).toBe("edit");
    expect(failureTab([err("share.title"), err("profile.name")])).toBe("edit");
    expect(failureTab([err("url", "b1")])).toBe("edit");
    expect(failureTab([err("share.title")])).toBe("share");
    expect(failureTab([err("share.image.focus.x")])).toBe("share");
    expect(failureTab([err("theme.overrides.bg")])).toBeNull();
    expect(failureTab([])).toBeNull();
  });

  it("has three tabs: Edit, Design and Share, on /editor, /design and /share", () => {
    expect(WORKSPACE_TABS.map((tab) => [tab.label, tab.href, tab.segment])).toEqual([
      ["Edit", "/editor", "editor"],
      ["Design", "/design", "design"],
      ["Share", "/share", "share"],
    ]);
  });
});

describe("M7-03 the parts a show switch has hidden", () => {
  const all = { showPhoto: true, showName: true, showBio: true };
  it("lists them in the order photo, name, bio", () => {
    expect(hiddenParts(all)).toEqual([]);
    expect(hiddenParts({ ...all, showName: false })).toEqual(["name"]);
    expect(hiddenParts({ showPhoto: false, showName: false, showBio: true })).toEqual([
      "photo",
      "name",
    ]);
    expect(hiddenParts({ showPhoto: false, showName: false, showBio: false })).toEqual([
      "photo",
      "name",
      "bio",
    ]);
    expect(hiddenParts({ ...all, showBio: false })).toEqual(["bio"]);
  });
});
