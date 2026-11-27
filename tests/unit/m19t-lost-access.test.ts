import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import { AUTOSAVE_DEBOUNCE_MS, AutosaveQueue, type SaveFn, type SaveResult } from "@/lib/editor/autosave";
import { saveProblemFor } from "@/components/editor/save-banner";
import { saveIndicatorText } from "@/components/workspace/toolbar/save-status";
import { ACCESS_LOST_MESSAGE } from "@/lib/team/messages";

/**
 * M19-11: removal is immediate in an open tab. A design save that matches no row and finds the site
 * no longer readable is `lost-access` (save-client, states-save-client): the queue stops (no retry,
 * later edits are kept and not sent) and the tab says "You no longer have access to this site."
 * instead of the conflict notice, with Reload (which lands on the user's own site or /claim).
 */
const draft = (name: string): DraftDoc => ({ ...emptyDraft("mara"), rev: 0, profile: { name, bio: "", photo: null } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("M19-11 lost access in an open tab", () => {
  it("M19-11 the queue stops on lost-access: no retry, nothing more is sent, flush is false", async () => {
    const results: SaveResult[] = [{ kind: "lost-access" }];
    const calls: DraftDoc[] = [];
    const save: SaveFn = vi.fn(async (doc): Promise<SaveResult> => {
      calls.push(doc);
      return results.shift() ?? { kind: "ok" };
    });
    const queue = new AutosaveQueue({ save, onStatus: () => undefined, initial: { rev: 3, revKey: "3" } });
    queue.schedule(draft("edit"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("lost-access");
    queue.schedule(draft("more"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(await queue.flush()).toBe(false);
  });

  it("M19-11 the banner says the access ended, not that another tab saved", () => {
    expect(saveProblemFor("lost-access", false)).toEqual({ kind: "lost-access", message: ACCESS_LOST_MESSAGE });
    expect(ACCESS_LOST_MESSAGE).toBe("You no longer have access to this site.");
    expect(saveProblemFor("conflict", false)?.message).not.toBe(ACCESS_LOST_MESSAGE);
    expect(saveIndicatorText("lost-access")).toBe(saveIndicatorText("conflict"));
  });
});
