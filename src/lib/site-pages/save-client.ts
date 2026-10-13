import { scheduleMediaCleanup } from "@/lib/media/cleanup-client";
import { postEntryDraft } from "./entry-save-client";
import type { SubSaveFn } from "./saver";

/**
 * The revision of every sub-page the editor holds (M15-01, 1b1-17): the page entry's `rev`, the same
 * notion MCP's writer uses. A save sends the rev it last loaded or saved and the route answers
 * `conflict` when another writer moved it. Publish does not change an entry's rev, so there is
 * nothing to re-read after it.
 */
export interface SubPageRevisions {
  get(id: string): number | undefined;
  set(id: string, rev: number): void;
  delete(id: string): void;
}

export function createSubPageRevisions(initial: Readonly<Record<string, number>>): SubPageRevisions {
  const map = new Map(Object.entries(initial));
  return {
    get: (id) => map.get(id),
    set: (id, rev) => void map.set(id, rev),
    delete: (id) => void map.delete(id),
  };
}

/**
 * The browser-side write of a sub-page's draft (M11-08, 1b1-17): a POST to the page-entry save route
 * (`entry-save-client.ts`), conditional on the entry rev the editor last loaded or saved, so a change
 * made elsewhere (an MCP client) is never overwritten. The answers map one to one onto the queue's
 * results; an `ok` keeps the rev the route returned for the next save.
 */
export function createSubPageSaveFn(revisions: SubPageRevisions, siteId: string): SubSaveFn {
  return async (id, doc) => {
    const revision = revisions.get(id);
    // Never write without a revision to check against: reloading gives the editor one.
    if (revision === undefined) return { kind: "conflict" };
    const answer = await postEntryDraft(siteId, id, revision, doc);
    switch (answer.kind) {
      case "ok":
        revisions.set(id, answer.rev);
        scheduleMediaCleanup();
        return { kind: "ok" };
      case "blocked":
        return { kind: "blocked", hosts: answer.hosts, blockIds: answer.blockIds };
      case "invalid":
        return { kind: "error" };
      default:
        return { kind: answer.kind };
    }
  };
}
