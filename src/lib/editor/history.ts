import { collectImageRefs, type Block, type DraftDoc } from "@/lib/document";
import { mediaPathOf } from "@/lib/themes/bg-image";

/**
 * The undo and redo engine (M6-06): one history of whole `DraftDoc` snapshots, shared by the Editor
 * and the Design screen. Framework-free and free of server-only and env imports, so it runs in
 * node and in the browser, and every function is pure (the clock is a parameter).
 *
 *   - `past`, `present` and `future` hold snapshots by reference. Every edit builds a new draft
 *     with immutable updates, so the snapshots share every block, icon and cell that did not change.
 *   - Only real edits count: recording the draft that is already `present` adds nothing.
 *   - Typing coalesces: edits with the same group key (`profile/name`, `block:{id}:{field}`,
 *     `theme:{token}`) that arrive less than `COALESCE_MS` after the previous one of the group are
 *     one step. So are the edits of one `batch` (several writes made by one gesture, in one tick,
 *     like an accent swatch that sets the accent and the button colors). Undo and redo close the
 *     open group, so an edit made after them is always a new step.
 *   - At most `HISTORY_LIMIT` steps are kept; the oldest is dropped first. A new edit clears redo.
 *   - `rev` is not part of a step. Whatever is restored takes the `rev` of the draft on screen; the
 *     autosave queue stamps the number it actually sends (stored rev + 1).
 *   - A restored draft is always a NEW top-level object (never the stored snapshot itself), so the
 *     screen's "the draft is a new object" autosave rule fires even when the restored content is the
 *     very draft the screen loaded with.
 */

export const HISTORY_LIMIT = 100;
/** Edits of one group that arrive closer together than this are one step. */
export const COALESCE_MS = 1000;

export interface History {
  /** Oldest first. At most `HISTORY_LIMIT` entries. */
  past: readonly DraftDoc[];
  present: DraftDoc;
  /** Nearest first: `future[0]` is what Redo restores. */
  future: readonly DraftDoc[];
  /** The group (and batch) the last edit belonged to, while a following edit of it may still merge into it. */
  open: { key: string | undefined; at: number; batch: number | undefined } | null;
}

export function createHistory(present: DraftDoc): History {
  return { past: [], present, future: [], open: null };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

/**
 * Records `next` as the new present. Returns `history` itself when `next` is the present already.
 * `group` (optional) is the key under which close-together edits merge; `batch` (optional) names
 * the gesture the edit belongs to, and every edit of the same batch merges whatever its group;
 * `at` is the time of the edit in ms.
 */
export function recordEdit(
  history: History,
  next: DraftDoc,
  options: { group?: string | undefined; at: number; batch?: number | undefined },
): History {
  if (next === history.present) return history;
  const { group, at, batch } = options;
  const open = history.open;
  const sameBatch = batch !== undefined && open !== null && open.batch === batch;
  const sameGroup =
    group !== undefined &&
    open !== null &&
    open.key === group &&
    at - open.at >= 0 &&
    at - open.at < COALESCE_MS;
  const merges =
    open !== null &&
    (sameBatch || sameGroup) &&
    history.past.length > 0 &&
    history.future.length === 0;
  if (merges) {
    return {
      past: history.past,
      present: next,
      future: history.future,
      open: { key: group, at, batch },
    };
  }
  const past =
    history.past.length >= HISTORY_LIMIT
      ? [...history.past.slice(history.past.length - HISTORY_LIMIT + 1), history.present]
      : [...history.past, history.present];
  return {
    past,
    present: next,
    future: [],
    open: group === undefined && batch === undefined ? null : { key: group, at, batch },
  };
}

/** A restored snapshot: a new top-level object with the rev of the draft it replaces. */
function restored(snapshot: DraftDoc, current: DraftDoc): DraftDoc {
  return { ...snapshot, rev: current.rev };
}

/** One step back. Returns `history` itself when there is nothing to undo. */
export function undo(history: History): History {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: restored(previous, history.present),
    future: [history.present, ...history.future],
    open: null,
  };
}

/** One step forward. Returns `history` itself when there is nothing to redo. */
export function redo(history: History): History {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: restored(next, history.present),
    future: history.future.slice(1),
    open: null,
  };
}

// Images ----------------------------------------------------------------------------------------

/**
 * Every uploaded image a draft names: the profile photo, card and image blocks, and the page's
 * background image. `mediaOrigin` is the Storage origin that serves page media (the background is
 * a URL in the tokens; without an origin it is left out).
 */
export function draftImagePaths(doc: DraftDoc, mediaOrigin: string | null = null): string[] {
  const paths = new Set<string>(collectImageRefs(doc).map((ref) => ref.path));
  const bg = (doc.theme.overrides as { bgImage?: unknown }).bgImage;
  if (mediaOrigin !== null && typeof bg === "string") {
    const path = mediaPathOf(bg, mediaOrigin);
    if (path !== null) paths.add(path);
  }
  return [...paths];
}

/**
 * The image paths the snapshot an undo or redo would restore holds and the draft on screen does
 * not: those files may have been deleted since (a replaced or removed image is cleaned up out of
 * Storage), so the screen checks they still exist before it applies the step.
 */
export function imagesNeededBy(
  history: History,
  direction: "undo" | "redo",
  mediaOrigin: string | null = null,
): string[] {
  const target = direction === "undo" ? history.past[history.past.length - 1] : history.future[0];
  if (!target) return [];
  const have = new Set(draftImagePaths(history.present, mediaOrigin));
  return draftImagePaths(target, mediaOrigin).filter((path) => !have.has(path));
}

export type ImageCheck = "ok" | "gone";

/**
 * One HEAD request per path to its public URL. "gone" when any file answers 404; "ok" when every
 * one is there. Anything else (a 5xx, the network down, a blocked request) is "ok": the check
 * fails open, because refusing an undo over a flaky connection is worse than a broken thumbnail.
 */
export async function checkImagesExist(
  paths: readonly string[],
  deps: { fetch: typeof fetch; urlOf: (path: string) => string },
): Promise<ImageCheck> {
  const answers = await Promise.all(
    paths.map(async (path) => {
      try {
        const response = await deps.fetch(deps.urlOf(path), { method: "HEAD", cache: "no-store" });
        return response.status === 404 || response.status === 400 ? "gone" : "ok";
      } catch {
        return "ok";
      }
    }),
  );
  return answers.includes("gone") ? "gone" : "ok";
}

export const UNDO_IMAGE_GONE = "Can’t undo that. The earlier image was already deleted.";
export const REDO_IMAGE_GONE = "Can’t redo that. That image was already deleted.";

// Groups ----------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function changedKeys(a: Rec, b: Rec): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => a[key] !== b[key]);
}

/** Where inside one block field the change is, "" for the field itself, null when it is not one edit. */
function innerPath(a: unknown, b: unknown): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return null;
    const changed = a.map((item, i) => (item === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (changed.length !== 1) return null;
    const x = a[changed[0]!];
    const y = b[changed[0]!];
    if (!isRec(x) || !isRec(y) || typeof x.id !== "string" || x.id !== y.id) return null;
    const inner = changedKeys(x, y);
    return inner.length === 1 ? `${x.id}.${inner[0]}` : x.id;
  }
  if (isRec(a) && isRec(b)) {
    const inner = changedKeys(a, b);
    return inner.length === 1 ? inner[0]! : null;
  }
  return "";
}

/**
 * The typing group of an edit to one block: `block:{id}:{field}` (with the icon, cell or override
 * inside the field appended), or undefined when the edit is not one field of one block, so it is
 * always its own step.
 */
export function blockEditGroup(previous: Block, next: Block): string | undefined {
  if (previous.id !== next.id || previous.type !== next.type) return undefined;
  let keys = changedKeys(previous as Rec, next as Rec);
  // The marks of a text block follow its text (M6-28): typing that moves a bold or link range is
  // still typing, so `text` and `marks` changing together group as `text`.
  if (
    previous.type === "text" &&
    keys.length === 2 &&
    keys.includes("text") &&
    keys.includes("marks")
  ) {
    keys = ["text"];
  }
  if (keys.length !== 1) return undefined;
  const key = keys[0]!;
  const inner = innerPath((previous as Rec)[key], (next as Rec)[key]);
  if (inner === null) return undefined;
  return `block:${next.id}:${key}${inner === "" ? "" : `.${inner}`}`;
}
