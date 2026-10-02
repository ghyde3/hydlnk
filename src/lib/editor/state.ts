import {
  LIMITS,
  blockDefaults,
  collectPublishErrors,
  singleLine,
  truncateToCodePoints,
  type Block,
  type BlockType,
  type DraftDoc,
  type ImageRef,
  type PublishError,
} from "@/lib/document";

/**
 * The editor's client state (M2-06 .. M2-14, M2-24) as one pure reducer: the draft being edited
 * plus the screen state that follows it (which row is open, the delete-undo toast, the publish
 * errors, a request to move focus). The draft keeps RAW strings: the schemas trim on parse, but an
 * input must show exactly what was typed, so parsed output is never fed back into it.
 *
 * Every action that changes nothing returns the same state object, so the screen can schedule an
 * autosave on "the draft is a new object" without writing on a no-op.
 */

export interface DeletedBlock {
  block: Block;
  index: number;
  /** Changes with every delete, so a second delete restarts the toast. */
  token: number;
}

/** Where focus should go after the next render; `nonce` makes a repeat request count again. */
export type FocusRequest =
  | { kind: "first-input"; blockId: string; nonce: number }
  | { kind: "row"; blockId: string; nonce: number }
  | { kind: "row-button"; blockId: string; nonce: number }
  | { kind: "invalid-input"; blockId: string; nonce: number }
  | { kind: "profile-name"; nonce: number };

export interface EditorState {
  draft: DraftDoc;
  /** The one open edit panel, by block id (so a reorder keeps it open). */
  expandedId: string | null;
  deleted: DeletedBlock | null;
  /** Text for the "Moved to position N of M" live region; `announceSeq` re-announces a repeat. */
  announcement: string;
  announceSeq: number;
  publishErrors: PublishError[];
  focus: FocusRequest | null;
  seq: number;
}

export type EditorAction =
  | { type: "profile/name"; value: string }
  | { type: "profile/bio"; value: string }
  | { type: "profile/photo"; value: ImageRef | null }
  | { type: "block/add"; blockType: BlockType }
  | { type: "block/update"; block: Block }
  /** An upload finished: set the image of a card or image block on top of the block as it is now. */
  | { type: "block/set-image"; id: string; image: ImageRef | null }
  | { type: "block/toggle-visible"; id: string }
  | { type: "block/toggle-expanded"; id: string }
  | { type: "block/delete"; id: string }
  | { type: "block/undo-delete" }
  | { type: "toast/dismiss"; token: number }
  | { type: "block/move"; id: string; delta: -1 | 1 }
  | { type: "block/reorder"; activeId: string; overId: string }
  | { type: "focus/handled"; nonce: number }
  | { type: "publish/errors"; errors: PublishError[] }
  | { type: "publish/clear-errors" };

export function initialEditorState(draft: DraftDoc): EditorState {
  return {
    draft,
    expandedId: null,
    deleted: null,
    announcement: "",
    announceSeq: 0,
    publishErrors: [],
    focus: null,
    seq: 0,
  };
}

// Helpers ---------------------------------------------------------------------------------------

/** Display name and labels stay on one line and within their code-point limit (pasting included). */
export function clampText(value: string, max: number): string {
  return truncateToCodePoints(singleLine(value), max);
}

/** Bio: one line, 160 code points. */
export function clampBio(value: string): string {
  return clampText(value, LIMITS.bio);
}

export function clampName(value: string): string {
  return clampText(value, LIMITS.displayName);
}

export function errorKey(error: PublishError): string {
  return `${error.blockId ?? ""}|${error.itemId ?? ""}|${error.field}`;
}

/**
 * Keeps the publish errors that still hold for `draft` (with their current wording) and drops the
 * ones that now validate: a fixed field clears its error, a new problem does not appear until the
 * next Publish. Returns `previous` itself when nothing changed.
 */
export function reconcileErrors(previous: PublishError[], draft: DraftDoc): PublishError[] {
  if (previous.length === 0) return previous;
  const current = new Map(collectPublishErrors(draft).map((error) => [errorKey(error), error]));
  const next: PublishError[] = [];
  for (const error of previous) {
    const still = current.get(errorKey(error));
    if (still) next.push(still);
  }
  const same =
    next.length === previous.length &&
    next.every((error, index) => error.message === previous[index]!.message);
  return same ? previous : next;
}

/** The first block (in page order) that has a publish error. */
export function firstFailingBlockId(draft: DraftDoc, errors: PublishError[]): string | null {
  const failing = new Set(errors.map((error) => error.blockId).filter((id) => id !== null));
  return draft.blocks.find((block) => failing.has(block.id))?.id ?? null;
}

function withDraft(state: EditorState, draft: DraftDoc): EditorState {
  if (draft === state.draft) return state;
  return { ...state, draft, publishErrors: reconcileErrors(state.publishErrors, draft) };
}

function withBlocks(state: EditorState, blocks: Block[]): EditorState {
  return withDraft(state, { ...state.draft, blocks });
}

// Reducer ---------------------------------------------------------------------------------------

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { draft } = state;
  switch (action.type) {
    case "profile/name": {
      const name = clampName(action.value);
      if (name === draft.profile.name) return state;
      return withDraft(state, { ...draft, profile: { ...draft.profile, name } });
    }
    case "profile/bio": {
      const bio = clampBio(action.value);
      if (bio === draft.profile.bio) return state;
      return withDraft(state, { ...draft, profile: { ...draft.profile, bio } });
    }
    case "profile/photo": {
      if (action.value === draft.profile.photo) return state;
      return withDraft(state, { ...draft, profile: { ...draft.profile, photo: action.value } });
    }

    case "block/add": {
      if (draft.blocks.length >= LIMITS.blocks) return state;
      const block = blockDefaults[action.blockType]();
      const next = withBlocks(state, [...draft.blocks, block]);
      return {
        ...next,
        expandedId: block.id,
        focus: {
          kind: action.blockType === "divider" ? "row" : "first-input",
          blockId: block.id,
          nonce: state.seq + 1,
        },
        seq: state.seq + 1,
      };
    }

    case "block/update": {
      const index = draft.blocks.findIndex((block) => block.id === action.block.id);
      if (index < 0 || draft.blocks[index] === action.block) return state;
      const blocks = draft.blocks.slice();
      blocks[index] = action.block;
      return withBlocks(state, blocks);
    }

    case "block/set-image": {
      // Applied to the block as it is now, not as it was when the upload started: whatever was typed
      // into the same block while the file was on its way stays.
      const index = draft.blocks.findIndex((block) => block.id === action.id);
      const block = draft.blocks[index];
      if (!block || (block.type !== "card" && block.type !== "image")) return state;
      const blocks = draft.blocks.slice();
      blocks[index] = { ...block, image: action.image };
      return withBlocks(state, blocks);
    }

    case "block/toggle-visible": {
      const index = draft.blocks.findIndex((block) => block.id === action.id);
      if (index < 0) return state;
      const blocks = draft.blocks.slice();
      const block = blocks[index]!;
      blocks[index] = { ...block, visible: block.visible === false } as Block;
      return withBlocks(state, blocks);
    }

    case "block/toggle-expanded":
      return { ...state, expandedId: state.expandedId === action.id ? null : action.id };

    case "block/delete": {
      const index = draft.blocks.findIndex((block) => block.id === action.id);
      if (index < 0) return state;
      const removed = draft.blocks[index]!;
      const next = withBlocks(
        state,
        draft.blocks.filter((block) => block.id !== action.id),
      );
      const neighbour = draft.blocks[index + 1] ?? draft.blocks[index - 1];
      return {
        ...next,
        expandedId: state.expandedId === action.id ? null : state.expandedId,
        deleted: { block: removed, index, token: state.seq + 1 },
        focus: neighbour
          ? { kind: "row-button", blockId: neighbour.id, nonce: state.seq + 1 }
          : null,
        seq: state.seq + 1,
      };
    }

    case "block/undo-delete": {
      const deleted = state.deleted;
      if (!deleted) return state;
      if (draft.blocks.some((block) => block.id === deleted.block.id)) {
        return { ...state, deleted: null };
      }
      if (draft.blocks.length >= LIMITS.blocks) return { ...state, deleted: null };
      const blocks = draft.blocks.slice();
      blocks.splice(Math.min(deleted.index, blocks.length), 0, deleted.block);
      return {
        ...withBlocks(state, blocks),
        deleted: null,
        focus: { kind: "row-button", blockId: deleted.block.id, nonce: state.seq + 1 },
        seq: state.seq + 1,
      };
    }

    case "toast/dismiss":
      return state.deleted && state.deleted.token === action.token
        ? { ...state, deleted: null }
        : state;

    case "block/move": {
      const from = draft.blocks.findIndex((block) => block.id === action.id);
      const to = from + action.delta;
      if (from < 0 || to < 0 || to >= draft.blocks.length) return state;
      const blocks = draft.blocks.slice();
      const [moved] = blocks.splice(from, 1);
      blocks.splice(to, 0, moved!);
      return {
        ...withBlocks(state, blocks),
        announcement: `Moved to position ${to + 1} of ${blocks.length}`,
        announceSeq: state.announceSeq + 1,
      };
    }

    case "block/reorder": {
      const from = draft.blocks.findIndex((block) => block.id === action.activeId);
      const to = draft.blocks.findIndex((block) => block.id === action.overId);
      if (from < 0 || to < 0 || from === to) return state;
      const blocks = draft.blocks.slice();
      const [moved] = blocks.splice(from, 1);
      blocks.splice(to, 0, moved!);
      return withBlocks(state, blocks);
    }

    case "publish/errors": {
      const first = firstFailingBlockId(draft, action.errors);
      const nameFailed = action.errors.some((error) => error.field === "profile.name");
      const nonce = state.seq + 1;
      return {
        ...state,
        publishErrors: action.errors,
        expandedId: first ?? state.expandedId,
        focus: first
          ? { kind: "invalid-input", blockId: first, nonce }
          : nameFailed
            ? { kind: "profile-name", nonce }
            : state.focus,
        seq: nonce,
      };
    }

    case "focus/handled":
      return state.focus && state.focus.nonce === action.nonce ? { ...state, focus: null } : state;

    case "publish/clear-errors":
      return state.publishErrors.length === 0 ? state : { ...state, publishErrors: [] };
  }
}
