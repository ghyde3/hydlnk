"use client";

import { useCallback, useReducer, useRef, type Dispatch, type SetStateAction } from "react";
import type { DraftDoc } from "@/lib/document";
import {
  createHistory,
  recordEdit,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "@/lib/editor/history";

type Action =
  | {
      type: "edit";
      update: (draft: DraftDoc) => DraftDoc;
      group: string | undefined;
      at: number;
      batch: number;
    }
  | { type: "undo" | "redo"; expect: DraftDoc | undefined };

function reducer(history: History, action: Action): History {
  if (action.type === "edit") {
    const next = action.update(history.present);
    return next === history.present
      ? history
      : recordEdit(history, next, { group: action.group, at: action.at, batch: action.batch });
  }
  // A step decided for a draft the screen has left since (an edit landed meanwhile) is dropped.
  if (action.expect !== undefined && action.expect !== history.present) return history;
  return action.type === "undo" ? undoHistory(history) : redoHistory(history);
}

/**
 * The Design screen's draft with undo and redo (M6-08): the same engine as the Editor
 * (src/lib/editor/history.ts), held as the screen's own state.
 *
 *   draft      the draft on screen (`history.present`).
 *   setDraft   a drop-in for a `useState` setter, which is what the saved-themes hook takes. Every
 *              call that changes the draft is one undo step of its own (applying, saving, updating
 *              or deleting a theme never merge into a neighbor); one that returns the draft it was
 *              given is not a step.
 *   update     the same with a typing group: edits of one group that arrive within a second of each
 *              other (one slider drag, one hex field) are one step. Every call made in the same tick
 *              (an accent swatch sets the accent and the button colors) is one step, group or not.
 *   step       applies one undo or redo step (see `useUndoRedo`, which checks images first).
 */
export function useDraftHistory(initial: DraftDoc) {
  const [history, dispatch] = useReducer(reducer, initial, createHistory);

  // Writes made in one synchronous run belong to one gesture: they share a batch number, which
  // moves on once the run is over.
  const batch = useRef({ id: 0, open: false });
  const update = useCallback((fn: (draft: DraftDoc) => DraftDoc, group?: string) => {
    if (!batch.current.open) {
      batch.current.open = true;
      batch.current.id += 1;
      queueMicrotask(() => {
        batch.current.open = false;
      });
    }
    dispatch({ type: "edit", update: fn, group, at: Date.now(), batch: batch.current.id });
  }, []);
  const setDraft = useCallback<Dispatch<SetStateAction<DraftDoc>>>(
    (value) => update(typeof value === "function" ? value : () => value),
    [update],
  );
  const step = useCallback(
    (direction: "undo" | "redo", expect?: DraftDoc) => dispatch({ type: direction, expect }),
    [],
  );

  return { draft: history.present, history, setDraft, update, step };
}
