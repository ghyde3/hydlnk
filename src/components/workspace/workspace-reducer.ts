import type { DraftDoc } from "@/lib/document";
import { recordEdit } from "@/lib/editor/history";
import {
  editorReducer,
  reconcileErrors,
  type EditorAction,
  type EditorState,
} from "@/lib/editor/state";

/**
 * The workspace's one reducer (M7-02): the editor's reducer plus one generic action, `draft/edit`,
 * for the edits the Design tab (and the saved-themes hook) make with a plain `(draft) => draft`
 * function instead of a named action. Both kinds land in the SAME history, so one Undo steps back
 * across tabs.
 *
 * `draft/edit` follows the rules of every other edit in `editorReducer`:
 *   - a function that returns the draft it was given changes nothing (the same state object comes
 *     back, so the autosave does not write on a no-op);
 *   - a real change is recorded as one undo step, merged with the previous one when it carries the
 *     same typing `group` less than a second later (one slider drag, one hex field) or the same
 *     `batch` (several writes made by one gesture in one tick, like an accent swatch);
 *   - publish errors that no longer hold are dropped, and the "Applied the ... template" toast is
 *     taken away by any new draft.
 */
export type DraftEditAction = {
  type: "draft/edit";
  update: (draft: DraftDoc) => DraftDoc;
  group?: string | undefined;
  batch?: number | undefined;
  at?: number | undefined;
};

export type WorkspaceAction = EditorAction | DraftEditAction;

export function workspaceReducer(state: EditorState, action: WorkspaceAction): EditorState {
  if (action.type !== "draft/edit") return editorReducer(state, action);
  const draft = action.update(state.draft);
  if (draft === state.draft) return state;
  const next: EditorState = {
    ...state,
    draft,
    publishErrors: reconcileErrors(state.publishErrors, draft),
    history: recordEdit(state.history, draft, {
      group: action.group,
      at: action.at ?? Date.now(),
      batch: action.batch,
    }),
  };
  return next.templateToast !== null && next.templateToast.draft !== draft
    ? { ...next, templateToast: null }
    : next;
}
