"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftDoc } from "@/lib/document";
import { AutosaveQueue, type SaveStatus } from "@/lib/editor/autosave";
import { createDraftSaver } from "@/lib/editor/save-client";

/** Statuses with edits that are not stored: the browser asks before the tab is closed. */
const UNSAVED: readonly SaveStatus[] = ["pending", "saving", "error", "too-large", "invalid"];

export interface Autosave {
  status: SaveStatus;
  /** Writes now. Resolves true when everything edited is stored. */
  flush: () => Promise<boolean>;
  /** The newest draft the database holds (what Publish will freeze). */
  savedDraft: () => DraftDoc | null;
}

/**
 * Autosave for the editor screen (M2-04): feeds every new draft to the `AutosaveQueue` and wires the
 * browser events around it.
 *
 *   - the first render never writes: only a draft that differs from the loaded one is saved;
 *   - the tab going hidden (and pagehide) flushes at once, as does leaving the screen;
 *   - `beforeunload` is listened to only while an edit is unsaved;
 *   - coming back online retries a failed write immediately.
 */
export function useAutosave(args: {
  pageId: string;
  draft: DraftDoc;
  initialRevKey: string | null;
}): Autosave {
  const { pageId, draft, initialRevKey } = args;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const queueRef = useRef<AutosaveQueue | null>(null);
  // What the screen loaded with: the baseline for "has the user edited yet".
  const [loaded] = useState(() => draft);
  const initialRev = loaded.rev;

  useEffect(() => {
    const queue = new AutosaveQueue({
      save: createDraftSaver(pageId),
      onStatus: setStatus,
      initial: { rev: initialRev, revKey: initialRevKey },
    });
    queueRef.current = queue;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void queue.flush();
    };
    const onPageHide = () => void queue.flush();
    const onOnline = () => queue.retryNow();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      // Leaving the screen (a client navigation) writes what is pending before the queue goes. The
      // queue is disposed only once that flush is done: disposing at once would drop an edit made
      // while an earlier write was still in flight.
      void queue.flush().finally(() => queue.dispose());
      queueRef.current = null;
    };
  }, [pageId, initialRev, initialRevKey]);

  useEffect(() => {
    if (draft === loaded) return;
    queueRef.current?.schedule(draft);
  }, [draft, loaded]);

  useEffect(() => {
    if (!UNSAVED.includes(status)) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  const flush = useCallback(async () => (await queueRef.current?.flush()) ?? true, []);
  const savedDraft = useCallback(() => queueRef.current?.savedDraft ?? null, []);
  return { status, flush, savedDraft };
}
