import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import {
  AUTOSAVE_RETRY_DELAYS_MS,
  AutosaveQueue,
  type SaveFn,
  type SaveResult,
  type SaveStatus,
} from "@/lib/editor/autosave";

/**
 * M5-15: a write the server refuses with 401 (the session is gone). The queue must stop (no retry
 * timer, no loop), keep every edit, say "signed-out", and try again only when asked to (the tab is
 * visible again). Fake timers and a fake transport, like editor-autosave.test.ts.
 */

const draft = (name: string, rev = 0): DraftDoc => ({
  ...emptyDraft("mara"),
  rev,
  profile: { name, bio: "", photo: null },
});

function setup(results: SaveResult[] = []) {
  const calls: { doc: DraftDoc; expected: string | null }[] = [];
  const statuses: SaveStatus[] = [];
  const queued = [...results];
  const save: SaveFn = vi.fn(async (doc, expected): Promise<SaveResult> => {
    calls.push({ doc, expected });
    return queued.shift() ?? { kind: "ok" };
  });
  const queue = new AutosaveQueue({
    save,
    onStatus: (s) => statuses.push(s),
    initial: { rev: 3, revKey: "3" },
  });
  return { queue, calls, statuses, push: (...more: SaveResult[]) => queued.push(...more) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("M5-15 a 401 stops the queue", () => {
  it("goes to signed-out and sends nothing more, however long it waits", async () => {
    const { queue, calls, statuses } = setup([{ kind: "unauthorized" }]);
    queue.schedule(draft("typed"));
    await vi.advanceTimersByTimeAsync(900);
    expect(calls).toHaveLength(1);
    expect(queue.status).toBe("signed-out");
    expect(statuses).toEqual(["pending", "saving", "signed-out"]);

    // The backoff for a failed write is 1 s, 2 s, 4 s, 5 s ...: a loop would show in a minute.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(AUTOSAVE_RETRY_DELAYS_MS[0]).toBeLessThan(60_000);
    expect(queue.status).toBe("signed-out");
  });

  it("keeps the unsaved edit: it is still the newest draft and still counts as unsaved", async () => {
    const { queue } = setup([{ kind: "unauthorized" }]);
    queue.schedule(draft("typed"));
    await vi.advanceTimersByTimeAsync(900);
    expect(queue.hasUnsaved).toBe(true);
    expect(queue.savedDraft).toBeNull();
  });

  it("more edits while signed out are kept and not sent, and do not flip the status back to pending", async () => {
    const { queue, calls, statuses } = setup([{ kind: "unauthorized" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    queue.schedule(draft("ab"));
    queue.schedule(draft("abc"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
    expect(queue.status).toBe("signed-out");
    expect(statuses.at(-1)).toBe("signed-out");
    expect(queue.hasUnsaved).toBe(true);
  });

  it("flush (Publish, leaving the screen) answers false and sends nothing while signed out", async () => {
    const { queue, calls } = setup([{ kind: "unauthorized" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(await queue.flush()).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("is not a failed write: no backoff timer is armed", async () => {
    const { queue } = setup([{ kind: "unauthorized" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(vi.getTimerCount()).toBe(0);
    queue.dispose();
  });
});

describe("M5-15 coming back", () => {
  it("retryNow tries once more; success stores the newest edit and clears the status", async () => {
    const { queue, calls } = setup([{ kind: "unauthorized" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    queue.schedule(draft("ab"));
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    // The retry carries the newest text, and continues from the stored rev (nothing was stored).
    expect(calls[1]!.doc.profile.name).toBe("ab");
    expect(calls[1]!.doc.rev).toBe(4);
    expect(calls[1]!.expected).toBe("3");
    expect(queue.status).toBe("saved");
    expect(queue.hasUnsaved).toBe(false);
    expect(queue.savedDraft?.profile.name).toBe("ab");
  });

  it("a second 401 puts it straight back to signed-out, with no timer", async () => {
    const { queue, calls, statuses } = setup([{ kind: "unauthorized" }, { kind: "unauthorized" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(queue.status).toBe("signed-out");
    // The banner never went away while it checked: no "saving" in between the two refusals.
    expect(statuses).toEqual(["pending", "saving", "signed-out"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
  });

  it("each retryNow is one attempt: three calls, three requests", async () => {
    const { queue, calls } = setup([
      { kind: "unauthorized" },
      { kind: "unauthorized" },
      { kind: "unauthorized" },
      { kind: "unauthorized" },
    ]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    for (let i = 0; i < 3; i++) {
      queue.retryNow();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(calls).toHaveLength(4);
  });

  it("retryNow does nothing when the queue is not failed or signed out", async () => {
    const { queue, calls } = setup();
    queue.retryNow();
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(queue.status).toBe("saved");
  });
});

describe("M5-15 an ordinary failure still retries, a 401 does not", () => {
  it("an error result keeps retrying with backoff", async () => {
    const { queue, calls } = setup([{ kind: "error" }, { kind: "error" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(queue.status).toBe("error");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_DELAYS_MS[0]! + 10);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(queue.status).toBe("saved");
  });

  it("a conflict is still a conflict (another tab saved first), not signed-out", async () => {
    const { queue } = setup([{ kind: "conflict" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(queue.status).toBe("conflict");
  });
});
