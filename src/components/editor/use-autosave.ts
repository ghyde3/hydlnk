"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftDoc } from "@/lib/document";
import { AutosaveQueue, type BlockedSave, type SaveStatus } from "@/lib/editor/autosave";
import { createDraftSaver } from "@/lib/editor/save-client";

/** Statuses with edits that are not stored: the browser asks before the tab is closed. */
const UNSAVED: readonly SaveStatus[] = [
  "pending",
  "saving",
  "error",
  "too-large",
  "invalid",
  "signed-out",
  "blocked",
];

export interface Autosave {
  status: SaveStatus;
  /**
   * The link-blocklist refusal in force (M5-03), or null: which hosts the database refused. It
   * stays until a write succeeds, so Publish stays off while it does; the Editor shows the
   * per-field errors from it and the Design screen only the banner.
   */
  blocked: BlockedSave | null;
  /** Writes now. Resolves true when everything edited is stored. */
  flush: () => Promise<boolean>;
  /** The newest draft the database holds (what Publish will freeze). */
  savedDraft: () => DraftDoc | null;
  /** The queue's status right now (a callback that outlives a render reads this, not `status`). */
  currentStatus: () => SaveStatus;
}

/**
 * Autosave for the editor screen (M2-04): feeds every new draft to the `AutosaveQueue` and wires the
 * browser events around it.
 *
 *   - the first render never writes: only a draft that differs from the loaded one is saved;
 *   - the tab going hidden (and pagehide) flushes at once, as does leaving the screen;
 *   - `beforeunload` is listened to only while an edit is unsaved;
 *   - coming back online retries a failed write immediately;
 *   - a signed-out session (a 401) is tried again once when the tab is visible or focused again, so
 *     signing in in another tab brings the edits home without a reload (M5-15).
 */
export function useAutosave(args: {
  pageId: string;
  draft: DraftDoc;
  initialRevKey: string | null;
}): Autosave {
  const { pageId, draft, initialRevKey } = args;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [blocked, setBlocked] = useState<BlockedSave | null>(null);
  const queueRef = useRef<AutosaveQueue | null>(null);
  // What the screen loaded with: the baseline for "has the user edited yet".
  const [loaded] = useState(() => draft);
  const initialRev = loaded.rev;

  useEffect(() => {
    const queue = new AutosaveQueue({
      save: createDraftSaver(pageId),
      onStatus: setStatus,
      onBlocked: setBlocked,
      initial: { rev: initialRev, revKey: initialRevKey },
    });
    queueRef.current = queue;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void queue.flush();
      else queue.retryNow();
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
  const currentStatus = useCallback(() => queueRef.current?.status ?? "idle", []);
  return { status, blocked, flush, savedDraft, currentStatus };
}
