"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REDO_IMAGE_GONE,
  UNDO_IMAGE_GONE,
  checkImagesExist,
  imagesNeededBy,
  type History,
} from "@/lib/editor/history";
import type { DraftDoc } from "@/lib/document";
import { mediaOrigin, mediaUrl } from "@/lib/media/url";

export type HistoryDirection = "undo" | "redo";

export const NOTHING_TO_UNDO = "Nothing to undo.";
export const NOTHING_TO_REDO = "Nothing to redo.";
export const UNDID = "Undid the last change.";
export const REDID = "Redid the change.";

/** What the header buttons, the shortcuts and the live region of one screen share. */
export interface UndoRedo {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** The polite live-region text ("Undid the last change."); `messageSeq` makes a repeat count again. */
  message: string;
  messageSeq: number;
  /** The reason a step was refused ("Can’t undo that. ..."), shown as an inline notice, or null. */
  notice: string | null;
}

/** Fields of the draft keep the app's undo; any other text field keeps the browser's own (below). */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Whether the browser keeps the key: a text field that is not part of the draft (the page-name
 * field in the header, a dialog's field) has its own undo stack, and anything inside a dialog is
 * not the page underneath. `scope` is the CSS selector of the panel that holds the draft's fields.
 */
export function keepsNativeUndo(
  target: EventTarget | null,
  scope: string,
  nativeWithin?: string,
): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('dialog, [role="dialog"], [role="alertdialog"], [data-native-undo]')) {
    return true;
  }
  if (!isTextField(target)) return false;
  if (nativeWithin !== undefined && target.closest(nativeWithin) !== null) return true;
  return target.closest(scope) === null;
}

/**
 * Undo and redo for one screen (M6-07, M6-08): the buttons' state, the keyboard shortcuts and the
 * messages. The history itself lives in the screen's state; `step` applies it.
 *
 *   - Ctrl+Z / Cmd+Z undoes, Shift+Ctrl+Z / Shift+Cmd+Z / Ctrl+Y redoes, anywhere on the screen,
 *     including in a text field of the draft (the app handles the key and calls `preventDefault`).
 *     Text fields outside the draft keep the browser's own undo (`keepsNativeUndo`).
 *   - A step that would bring back an image that was deleted since is checked first (one HEAD
 *     request per file); if one is gone nothing changes and `notice` says why. A network error
 *     applies the step.
 *   - The history is in memory only. Nothing here reads or writes storage.
 */
export function useUndoRedo(args: {
  history: History;
  /**
   * Applies one step to the screen's history. `expect` is given only when the step waited for the
   * image check: the draft it was decided for, so a step is dropped if an edit landed meanwhile.
   */
  step: (direction: HistoryDirection, expect?: DraftDoc) => void;
  /** CSS selector of the panel that holds the draft's fields (a focused text field in it is the draft's). */
  scope: string;
  /** A region inside `scope` whose text fields are not the draft's (the saved themes' rename field). */
  nativeWithin?: string;
}): UndoRedo {
  const { history, step, scope, nativeWithin } = args;
  const [message, setMessage] = useState({ text: "", seq: 0 });
  // A refusal belongs to the draft it was shown for: the next edit (or step) takes it away.
  const [refusal, setRefusal] = useState<{ text: string; draft: DraftDoc } | null>(null);

  // The newest values for the handlers that outlive a render (a key press, an awaited request).
  const historyRef = useRef(history);
  const stepRef = useRef(step);
  const busyRef = useRef(false);
  useEffect(() => {
    historyRef.current = history;
    stepRef.current = step;
  }, [history, step]);

  const say = useCallback((text: string) => {
    setMessage((current) => ({ text, seq: current.seq + 1 }));
  }, []);

  const run = useCallback(
    async (direction: HistoryDirection) => {
      if (busyRef.current) return;
      const before = historyRef.current;
      const available = direction === "undo" ? before.past.length > 0 : before.future.length > 0;
      if (!available) {
        say(direction === "undo" ? NOTHING_TO_UNDO : NOTHING_TO_REDO);
        return;
      }
      const missing = imagesNeededBy(before, direction, mediaOrigin());
      const checked = missing.length > 0;
      if (checked) {
        busyRef.current = true;
        try {
          const verdict = await checkImagesExist(missing, {
            fetch: window.fetch.bind(window),
            urlOf: mediaUrl,
          });
          if (verdict === "gone") {
            setRefusal({
              text: direction === "undo" ? UNDO_IMAGE_GONE : REDO_IMAGE_GONE,
              draft: before.present,
            });
            return;
          }
        } finally {
          busyRef.current = false;
        }
        // An edit that landed while the files were checked: the answer was for another draft.
        if (historyRef.current.present !== before.present) return;
      }
      setRefusal(null);
      stepRef.current(direction, checked ? before.present : undefined);
      say(direction === "undo" ? UNDID : REDID);
    },
    [say],
  );

  const undo = useCallback(() => void run("undo"), [run]);
  const redo = useCallback(() => void run("redo"), [run]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing || event.altKey || event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      let direction: HistoryDirection;
      if (key === "z") direction = event.shiftKey ? "redo" : "undo";
      else if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey)
        direction = "redo";
      else return;
      if (keepsNativeUndo(event.target, scope, nativeWithin)) return;
      event.preventDefault();
      void run(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run, scope, nativeWithin]);

  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    message: message.text,
    messageSeq: message.seq,
    notice: refusal !== null && refusal.draft === history.present ? refusal.text : null,
  };
}
