import { blockedPublishErrorHolds } from "@/lib/blocklist/fields";
import {
  BLOCK_TYPE_LABELS,
  LIMITS,
  applyProfileOption,
  blockDefaults,
  collectPublishErrors,
  singleLine,
  truncateToCodePoints,
  type Block,
  type BlockType,
  type DraftDoc,
  type ImageRef,
  type ProfileOptionChange,
  type PublishError,
  type Focus,
  type Share,
  isShareEmpty,
  roundFocus,
} from "@/lib/document";
import { applyTemplate, templateById } from "@/lib/templates";
import { collectIds, duplicateBlock } from "./duplicate";
import {
  blockEditGroup,
  createHistory,
  recordEdit,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "./history";

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
  /** `itemId`: the first field of that social icon or grid cell instead of the block's first field. */
  | { kind: "first-input"; blockId: string; nonce: number; itemId?: string }
  | { kind: "row"; blockId: string; nonce: number }
  | { kind: "row-button"; blockId: string; nonce: number }
  | { kind: "invalid-input"; blockId: string; nonce: number }
  | { kind: "profile-name"; nonce: number }
  /** A field of the share card (M6-33): its first control takes focus (a Publish error names it). */
  | { kind: "share-field"; field: ShareField; nonce: number };

/** The three fields of the share card, as `share.title`, `share.description` and `share.image`. */
export type ShareField = "title" | "description" | "image";

/**
 * The "Applied the Musician template" toast (M6-40): the template's name and the draft the apply
 * made. The toast shows while the draft on screen is still that very draft: any other edit, an undo
 * or a redo makes a new draft object and takes it away (`editorReducer`), so its Undo can only ever
 * undo the template. `token` changes with every apply, so a second apply restarts the toast.
 */
export interface TemplateToast {
  name: string;
  draft: DraftDoc;
  token: number;
}

export interface EditorState {
  draft: DraftDoc;
  /**
   * Undo and redo (M6-06): every change to `draft` is recorded here, so it is undoable. `present`
   * is always `draft`. Screen state (the open row, the toast, publish errors) is not history.
   */
  history: History;
  /** The one open edit panel, by block id (so a reorder keeps it open). */
  expandedId: string | null;
  deleted: DeletedBlock | null;
  /** M6-40: the toast of the last template apply, or null. */
  templateToast: TemplateToast | null;
  /** Text for the "Moved to position N of M" live region; `announceSeq` re-announces a repeat. */
  announcement: string;
  announceSeq: number;
  publishErrors: PublishError[];
  focus: FocusRequest | null;
  seq: number;
}

/** What every action may carry: when it was dispatched (ms), for the history's typing groups. */
type Timed = { at?: number };

export type EditorAction = (
  | { type: "profile/name"; value: string }
  | { type: "profile/bio"; value: string }
  | { type: "profile/photo"; value: ImageRef | null }
  /**
   * One profile display option (M6-15 .. M6-18): the photo's shape, size and border, and whether
   * the photo, name and bio show. A value outside the option's list, or a non-boolean for a
   * switch, changes nothing (the same state object comes back).
   */
  | ({ type: "profile/option" } & ProfileOptionChange)
  /**
   * The share card (M6-33): the title and description are clamped to 70 and 200 code points on one
   * line; the image is a finished upload (a new image has no focus) or null; `share/focus` moves
   * the image's focus point (null is "Center": the key is removed). When all three fields are empty
   * the draft has no `share` key at all.
   */
  | { type: "share/title"; value: string }
  | { type: "share/description"; value: string }
  | { type: "share/image"; value: ImageRef | null }
  | { type: "share/focus"; value: Focus | null }
  /** Adds a block with the M2-10 defaults: at `index` (clamped to the page; M6-04) or at the end. */
  | { type: "block/add"; blockType: BlockType; index?: number }
  /** Inserts a ready-made block at `index` (clamped). `block/add` is this with the defaults. */
  | { type: "insert"; index: number; block: Block }
  /** M6-05: a copy of the block with fresh ids directly after it, opened and focused. */
  | { type: "duplicate"; id: string }
  /**
   * Opens one row (and closes the others) and asks for focus in it: the first input, the row itself
   * for a divider, or the first field of one social icon or grid cell when `itemId` is given.
   * Unlike `block/toggle-expanded` it never closes a row. For "tap it in the preview" (M6-03).
   */
  | { type: "expand"; id: string; itemId?: string }
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
  | { type: "publish/clear-errors" }
  /**
   * M6-40: replaces the blocks, the theme reference, the page-level overrides and (when it is
   * empty) the bio with a starter template's, in one edit and one undo step. An id that is not in
   * the catalog changes nothing.
   */
  | { type: "template/apply"; templateId: string }
  | { type: "template/dismiss"; token: number }
  /**
   * One step back or forward in the history (M6-07). `expect` is the draft the caller decided on:
   * when the screen has moved on since (an edit landed while the images were being checked), the
   * step is dropped instead of applied to a different draft.
   */
  | { type: "history/undo"; expect?: DraftDoc }
  | { type: "history/redo"; expect?: DraftDoc }
) &
  Timed;

export function initialEditorState(draft: DraftDoc): EditorState {
  return {
    draft,
    history: createHistory(draft),
    expandedId: null,
    deleted: null,
    templateToast: null,
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
    // A blocked link (M5-03) is not something the draft schema knows: it stays for as long as the
    // field still points at the host the Publish named, and goes the moment the URL is changed.
    if (typeof (error as { host?: unknown }).host === "string") {
      if (blockedPublishErrorHolds(draft, error)) next.push(error);
      continue;
    }
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

/** The draft's share card with all three keys, for an edit to build on (M6-33). */
function shareOf(draft: DraftDoc): Required<Share> {
  return {
    title: draft.share?.title ?? "",
    description: draft.share?.description ?? "",
    image: draft.share?.image ?? null,
  };
}

/**
 * Writes a share card into the draft, or takes the `share` key out when all three fields are empty
 * (clearing the card leaves the draft as if it never had one).
 */
function withShare(state: EditorState, share: Required<Share>): EditorState {
  if (isShareEmpty(share)) {
    if (state.draft.share === undefined) return state;
    const rest: DraftDoc = { ...state.draft };
    delete rest.share;
    return withDraft(state, rest);
  }
  return withDraft(state, { ...state.draft, share });
}

/** The share field a Publish error names (`share.title`, `share.description`, `share.image...`). */
function shareFieldOf(errors: readonly PublishError[]): ShareField | null {
  for (const error of errors) {
    if (error.blockId !== null) continue;
    if (error.field === "share.title") return "title";
    if (error.field === "share.description") return "description";
    if (error.field === "share.image" || error.field.startsWith("share.image.")) return "image";
  }
  return null;
}

// Insert, duplicate, expand ---------------------------------------------------------------------

/** Where focus goes in a block that was just added, duplicated or opened: its first input, or the row for a divider. */
function focusFor(block: Block, nonce: number, itemId?: string): FocusRequest {
  if (block.type === "divider") return { kind: "row", blockId: block.id, nonce };
  return itemId === undefined
    ? { kind: "first-input", blockId: block.id, nonce }
    : { kind: "first-input", blockId: block.id, nonce, itemId };
}

/**
 * Puts `block` into the page at `requested` (clamped to 0..N; undefined appends) and opens and
 * focuses it. The same state object comes back at the 50-block limit and when the id is already
 * on the page (ids are analytics keys). `announce` is the polite live-region text, if any.
 */
function insertBlock(
  state: EditorState,
  requested: number | undefined,
  block: Block,
  announce: (index: number, total: number) => string | null,
): EditorState {
  const { draft } = state;
  if (draft.blocks.length >= LIMITS.blocks) return state;
  if (collectIds(draft).has(block.id)) return state;
  const end = draft.blocks.length;
  const index =
    requested === undefined || Number.isNaN(requested)
      ? end
      : Math.min(Math.max(Math.trunc(requested), 0), end);
  const blocks = draft.blocks.slice();
  blocks.splice(index, 0, block);
  const text = announce(index, blocks.length);
  const next = withBlocks(state, blocks);
  return {
    ...next,
    expandedId: block.id,
    focus: focusFor(block, state.seq + 1),
    ...(text === null ? {} : { announcement: text, announceSeq: state.announceSeq + 1 }),
    seq: state.seq + 1,
  };
}

// History ---------------------------------------------------------------------------------------

/** The typing group of an action (what coalesces into one undo step), or undefined: its own step. */
function groupOf(state: EditorState, action: EditorAction): string | undefined {
  switch (action.type) {
    case "profile/name":
      return "profile/name";
    case "profile/bio":
      return "profile/bio";
    case "share/title":
      return "share/title";
    case "share/description":
      return "share/description";
    case "share/focus":
      return "share/focus";
    case "block/update": {
      const before = state.draft.blocks.find((block) => block.id === action.block.id);
      return before ? blockEditGroup(before, action.block) : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * One undo or redo. Only the draft moves: the open row stays open when its block is still on the
 * page (and none is open when it is not), publish errors are reconciled against the restored draft,
 * and a "Block deleted." toast whose block is back is dropped. Focus, the "Moved to position"
 * announcement and the other screen state are not history.
 */
function stepHistory(
  state: EditorState,
  direction: "undo" | "redo",
  expect: DraftDoc | undefined,
): EditorState {
  if (expect !== undefined && expect !== state.draft) return state;
  const history = direction === "undo" ? undoHistory(state.history) : redoHistory(state.history);
  if (history === state.history) return state;
  const draft = history.present;
  const present = (id: string) => draft.blocks.some((block) => block.id === id);
  return {
    ...state,
    draft,
    history,
    expandedId: state.expandedId !== null && present(state.expandedId) ? state.expandedId : null,
    deleted: state.deleted !== null && present(state.deleted.block.id) ? null : state.deleted,
    publishErrors: reconcileErrors(state.publishErrors, draft),
  };
}

// Reducer ---------------------------------------------------------------------------------------

/**
 * Every action goes through here: `reduceEditor` computes the next state, and when its draft is a
 * new object that draft is recorded in the history (M6-06), so every change, profile and block
 * alike, is one undo step (typing coalesces, see ./history). `action.at` is when it was
 * dispatched; without one the clock is read here.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const next = reduceWithHistory(state, action);
  // The template toast belongs to the draft the apply made: a new draft (an edit, an undo, a redo)
  // takes it away.
  return next.templateToast !== null && next.templateToast.draft !== next.draft
    ? { ...next, templateToast: null }
    : next;
}

function reduceWithHistory(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "history/undo") return stepHistory(state, "undo", action.expect);
  if (action.type === "history/redo") return stepHistory(state, "redo", action.expect);
  const next = reduceEditor(state, action);
  if (next === state || next.draft === state.draft) return next;
  return {
    ...next,
    history: recordEdit(state.history, next.draft, {
      group: groupOf(state, action),
      at: action.at ?? Date.now(),
    }),
  };
}

function reduceEditor(state: EditorState, action: EditorAction): EditorState {
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
    case "profile/option": {
      const profile = applyProfileOption(draft.profile, action);
      if (profile === draft.profile) return state;
      return withDraft(state, { ...draft, profile });
    }

    case "share/title": {
      const title = clampText(action.value, LIMITS.shareTitle);
      if (title === (draft.share?.title ?? "")) return state;
      return withShare(state, { ...shareOf(draft), title });
    }
    case "share/description": {
      const description = clampText(action.value, LIMITS.shareDescription);
      if (description === (draft.share?.description ?? "")) return state;
      return withShare(state, { ...shareOf(draft), description });
    }
    case "share/image": {
      const image = action.value;
      if (image === (draft.share?.image ?? null) || (image === null && !draft.share)) return state;
      return withShare(state, { ...shareOf(draft), image });
    }
    case "share/focus": {
      const current = draft.share?.image ?? null;
      if (current === null) return state;
      const bare: ImageRef = { path: current.path, width: current.width, height: current.height };
      const image: ImageRef =
        action.value === null ? bare : { ...bare, focus: roundFocus(action.value) };
      if (JSON.stringify(image) === JSON.stringify(current)) return state;
      return withShare(state, { ...shareOf(draft), image });
    }

    case "block/add": {
      const { blockType, index } = action;
      return insertBlock(state, index, blockDefaults[blockType](), (at, total) =>
        index === undefined
          ? null
          : `${BLOCK_TYPE_LABELS[blockType]} added at position ${at + 1} of ${total}.`,
      );
    }

    case "insert":
      return insertBlock(
        state,
        action.index,
        action.block,
        (at, total) =>
          `${BLOCK_TYPE_LABELS[action.block.type]} added at position ${at + 1} of ${total}.`,
      );

    case "duplicate": {
      const index = draft.blocks.findIndex((block) => block.id === action.id);
      if (index < 0 || draft.blocks.length >= LIMITS.blocks) return state;
      const copy = duplicateBlock(draft.blocks[index]!, collectIds(draft));
      return insertBlock(state, index + 1, copy, () => "Block duplicated.");
    }

    case "expand": {
      const block = draft.blocks.find((candidate) => candidate.id === action.id);
      if (!block) return state;
      return {
        ...state,
        expandedId: block.id,
        focus: focusFor(block, state.seq + 1, action.itemId),
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
      if (block?.type === "link") {
        // M6-21: a link's thumbnail is its `icon` as an image reference. It replaces a built-in
        // icon (never both) and a null removes the key, so a block without an icon is unchanged.
        const rest = { ...block };
        delete rest.icon;
        const blocks = draft.blocks.slice();
        blocks[index] = action.image
          ? { ...rest, icon: { type: "image", image: action.image } }
          : rest;
        return withBlocks(state, blocks);
      }
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
      const shareField = shareFieldOf(action.errors);
      const nonce = state.seq + 1;
      return {
        ...state,
        publishErrors: action.errors,
        expandedId: first ?? state.expandedId,
        focus: first
          ? { kind: "invalid-input", blockId: first, nonce }
          : nameFailed
            ? { kind: "profile-name", nonce }
            : shareField
              ? { kind: "share-field", field: shareField, nonce }
              : state.focus,
        seq: nonce,
      };
    }

    case "template/apply": {
      const template = templateById(action.templateId);
      if (!template) return state;
      const next = applyTemplate(draft, template);
      return {
        ...withDraft(state, next),
        // The old rows are gone: nothing is open, and a "Block deleted." toast is for a page that
        // no longer exists.
        expandedId: null,
        deleted: null,
        focus: null,
        templateToast: { name: template.name, draft: next, token: state.seq + 1 },
        seq: state.seq + 1,
      };
    }

    case "template/dismiss":
      return state.templateToast && state.templateToast.token === action.token
        ? { ...state, templateToast: null }
        : state;

    case "focus/handled":
      return state.focus && state.focus.nonce === action.nonce ? { ...state, focus: null } : state;

    case "publish/clear-errors":
      return state.publishErrors.length === 0 ? state : { ...state, publishErrors: [] };

    // Handled by `editorReducer` before this runs.
    case "history/undo":
    case "history/redo":
      return state;
  }
}
