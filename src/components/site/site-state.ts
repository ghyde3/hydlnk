import { emptyDraft, type Block, type DraftDoc, type SubPageDraft } from "@/lib/document";
import { initialEditorState, type EditorState } from "@/lib/editor/state";
import { workspaceReducer, type WorkspaceAction } from "@/components/workspace/workspace-reducer";

/**
 * The client state of the open site's sub-pages (M11-08): per page its settings (path, title,
 * description) and a block editor. The block editor is the Home editor, not a copy: a sub-page's
 * blocks live in a `DraftDoc` shell (`blocksShell`) and go through the same `workspaceReducer`, so
 * every block action, the open row, the undo history and the focus requests work as they do on Home.
 * Only the `blocks` of the shell mean anything; the rest of a sub-page document (theme, profile,
 * menu) belongs to the site. Pure, so it is unit-tested without React.
 */

export interface SubPageSettings {
  path: string;
  title: string;
  description: string;
}

export interface SiteState {
  /** Sub-page ids in creation order. */
  ids: string[];
  settings: Record<string, SubPageSettings>;
  editors: Record<string, EditorState>;
}

export type SiteAction =
  | { type: "settings"; id: string; patch: Partial<SubPageSettings> }
  | { type: "editor"; id: string; action: WorkspaceAction }
  | { type: "add"; id: string; draft: SubPageDraft }
  | { type: "remove"; id: string };

/** A `DraftDoc` whose blocks are a sub-page's, for the block editor's reducer. */
export function blocksShell(blocks: readonly Block[]): DraftDoc {
  return { ...emptyDraft("page"), blocks: [...blocks] };
}

const settingsOf = (draft: SubPageDraft): SubPageSettings => ({
  path: draft.path,
  title: draft.title,
  description: draft.description,
});

export function initSiteState(pages: readonly { id: string; draft: SubPageDraft }[]): SiteState {
  const state: SiteState = { ids: [], settings: {}, editors: {} };
  for (const page of pages) {
    state.ids.push(page.id);
    state.settings[page.id] = settingsOf(page.draft);
    state.editors[page.id] = initialEditorState(blocksShell(page.draft.blocks));
  }
  return state;
}

export function siteReducer(state: SiteState, action: SiteAction): SiteState {
  switch (action.type) {
    case "settings": {
      const current = state.settings[action.id];
      if (!current) return state;
      const next = { ...current, ...action.patch };
      if (
        next.path === current.path &&
        next.title === current.title &&
        next.description === current.description
      ) {
        return state;
      }
      return { ...state, settings: { ...state.settings, [action.id]: next } };
    }
    case "editor": {
      const current = state.editors[action.id];
      if (!current) return state;
      const next = workspaceReducer(current, action.action);
      return next === current
        ? state
        : { ...state, editors: { ...state.editors, [action.id]: next } };
    }
    case "add": {
      if (state.ids.includes(action.id)) return state;
      return {
        ids: [...state.ids, action.id],
        settings: { ...state.settings, [action.id]: settingsOf(action.draft) },
        editors: {
          ...state.editors,
          [action.id]: initialEditorState(blocksShell(action.draft.blocks)),
        },
      };
    }
    case "remove": {
      if (!state.ids.includes(action.id)) return state;
      const { [action.id]: _settings, ...settings } = state.settings;
      const { [action.id]: _editor, ...editors } = state.editors;
      void _settings;
      void _editor;
      return { ids: state.ids.filter((id) => id !== action.id), settings, editors };
    }
  }
}

/** The document of one sub-page as it is stored: its settings and the blocks the editor holds. */
export function docOf(state: SiteState, id: string): SubPageDraft | null {
  const settings = state.settings[id];
  const editor = state.editors[id];
  if (!settings || !editor) return null;
  return { ...settings, blocks: editor.draft.blocks };
}
