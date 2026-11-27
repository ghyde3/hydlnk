"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { PostSaveQueue, type PostSaveView } from "@/lib/posts/save-queue";
import { postEntryDraft } from "@/lib/site-pages/entry-save-client";

/**
 * The post editor's autosave (M16-13): one `PostSaveQueue` for the life of the screen, sending
 * `{rev, draft}` to the entry draft route. The queue's rules (1.5 s debounce, one request in
 * flight, a stale rev stops saving, an action runs alone) are in `src/lib/posts/save-queue.ts`.
 *
 * Leaving the screen sends what is waiting; closing the tab with unsaved text asks first.
 */
export interface PostAutosave {
  view: PostSaveView;
  queue: PostSaveQueue<unknown>;
}

const SERVER_VIEW: PostSaveView = { state: "saved", problem: null };

export function usePostAutosave(siteId: string, entryId: string, rev: number): PostAutosave {
  const [queue] = useState(
    () =>
      new PostSaveQueue<unknown>({
        rev,
        save: (sentRev, draft) => postEntryDraft(siteId, entryId, sentRev, draft),
      }),
  );
  const view = useSyncExternalStore(
    queue.subscribe,
    () => queue.view,
    () => SERVER_VIEW,
  );

  useEffect(() => {
    queue.resume();
    const onHide = () => {
      if (document.visibilityState === "hidden") void queue.flush();
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      if (queue.dirty && queue.view.state !== "conflict") event.preventDefault();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
      // The request for what is waiting starts now; the queue then stops.
      void queue.flush();
      queue.dispose();
    };
  }, [queue]);

  return { view, queue };
}
