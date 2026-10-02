import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, emptyDraft, type DraftDoc } from "@/lib/document";
import { jsonbTextBytes } from "@/lib/editor/size";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AutosaveQueue,
  type SaveFn,
  type SaveResult,
  type SaveStatus,
} from "@/lib/editor/autosave";

/** M2-04: the autosave queue, with fake timers and a fake transport. */

const draft = (name: string, rev = 0): DraftDoc => ({
  ...emptyDraft("mara"),
  rev,
  profile: { name, bio: "", photo: null },
});

function setup(results: SaveResult[] = [], initial = { rev: 3, revKey: "3" as string | null }) {
  const calls: { doc: DraftDoc; expected: string | null }[] = [];
  const statuses: SaveStatus[] = [];
  const queue_results = [...results];
  const save: SaveFn = vi.fn(async (doc, expected): Promise<SaveResult> => {
    calls.push({ doc, expected });
    return queue_results.shift() ?? { kind: "ok" };
  });
  const queue = new AutosaveQueue({
    save,
    onStatus: (s) => statuses.push(s),
    initial,
  });
  return { queue, save, calls, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("ten edits in a burst give one write, 800 ms after the last, with rev + 1", async () => {
    const { queue, calls, statuses } = setup();
    for (let i = 1; i <= 10; i++) {
      queue.schedule(draft("x".repeat(i)));
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 41);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.doc.rev).toBe(4);
    expect(calls[0]!.doc.profile.name).toBe("xxxxxxxxxx");
    expect(calls[0]!.expected).toBe("3");
    expect(statuses).toEqual(["pending", "saving", "saved"]);
  });

  it("never writes before the first edit", async () => {
    const { calls, queue } = setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(0);
    expect(queue.status).toBe("idle");
    expect(queue.hasUnsaved).toBe(false);
  });

  it("each later write continues from the stored rev", async () => {
    const { queue, calls } = setup();
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    queue.schedule(draft("ab"));
    await vi.advanceTimersByTimeAsync(900);
    expect(calls.map((c) => [c.doc.rev, c.expected])).toEqual([
      [4, "3"],
      [5, "4"],
    ]);
  });

  it("a stored draft without a rev is written against null and becomes rev 1", async () => {
    const { queue, calls } = setup([], { rev: 0, revKey: null });
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(calls[0]!.expected).toBeNull();
    expect(calls[0]!.doc.rev).toBe(1);
  });

  it("an edit while a write is in flight is written after its own debounce", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls: DraftDoc[] = [];
    const queue = new AutosaveQueue({
      save: async (doc) => {
        calls.push(doc);
        if (calls.length === 1) await gate;
        return { kind: "ok" };
      },
      onStatus: () => {},
      initial: { rev: 0, revKey: "0" },
    });
    queue.schedule(draft("first"));
    await vi.advanceTimersByTimeAsync(900);
    expect(queue.status).toBe("saving");
    queue.schedule(draft("second"));
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(900);
    expect(calls.map((c) => [c.rev, c.profile.name])).toEqual([
      [1, "first"],
      [2, "second"],
    ]);
    expect(queue.status).toBe("saved");
  });
});

describe("flush", () => {
  it("writes at once, without waiting for the debounce", async () => {
    const { queue, calls } = setup();
    queue.schedule(draft("a"));
    expect(calls).toHaveLength(0);
    expect(await queue.flush()).toBe(true);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1); // the debounce timer was cancelled
    expect(queue.savedDraft?.profile.name).toBe("a");
  });

  it("with nothing edited it writes nothing and says stored", async () => {
    const { queue, calls } = setup();
    expect(await queue.flush()).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("waits for a write in flight, then writes the newer edit", async () => {
    const { queue, calls } = setup();
    queue.schedule(draft("a"));
    const first = queue.flush();
    queue.schedule(draft("ab"));
    expect(await first).toBe(true);
    expect(await queue.flush()).toBe(true);
    expect(calls.map((c) => c.doc.profile.name)).toEqual(["a", "ab"]);
    expect(queue.hasUnsaved).toBe(false);
  });

  it("resolves false when the write fails, and the retry stays scheduled", async () => {
    const { queue, calls } = setup([{ kind: "error" }]);
    queue.schedule(draft("a"));
    expect(await queue.flush()).toBe(false);
    expect(queue.status).toBe("error");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(calls).toHaveLength(2);
    expect(queue.status).toBe("saved");
  });
});

describe("failure and retry", () => {
  it("keeps the edits, shows an error, retries with backoff and saves when the network is back", async () => {
    const { queue, calls, statuses } = setup([
      { kind: "error" },
      { kind: "error" },
      { kind: "error" },
      { kind: "ok" },
    ]);
    queue.schedule(draft("offline edit"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("error");
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000); // first retry after 1 s
    expect(calls).toHaveLength(2);
    expect(queue.status).toBe("error");
    await vi.advanceTimersByTimeAsync(1_900);
    expect(calls).toHaveLength(2); // second delay is 2 s
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toHaveLength(4);
    expect(queue.status).toBe("saved");
    // The indicator never flickers to "saving" during a retry.
    expect(statuses).toEqual(["pending", "saving", "error", "saved"]);
    // Every attempt sent the same rev: nothing was stored until the last one.
    expect(new Set(calls.map((c) => c.doc.rev))).toEqual(new Set([4]));
  });

  it("caps the backoff", async () => {
    const results: SaveResult[] = Array.from({ length: 12 }, () => ({ kind: "error" }));
    const { queue, calls } = setup(results);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 5_000 + 5_000 + 5_000);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(queue.status).toBe("error");
  });

  it("retryNow retries immediately (the browser came back online)", async () => {
    const { queue, calls } = setup([{ kind: "error" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("error");
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(queue.status).toBe("saved");
  });

  it("an exception from the transport is a retryable error", async () => {
    let n = 0;
    const queue = new AutosaveQueue({
      save: async () => {
        if (n++ === 0) throw new Error("boom");
        return { kind: "ok" };
      },
      onStatus: () => {},
      initial: { rev: 0, revKey: "0" },
    });
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(900);
    expect(queue.status).toBe("error");
    await vi.advanceTimersByTimeAsync(1_100);
    expect(queue.status).toBe("saved");
  });
});

describe("stale tab guard", () => {
  it("a write that matches no row is a conflict: no retry, edits stay", async () => {
    const { queue, calls } = setup([{ kind: "conflict" }]);
    queue.schedule(draft("b's edit"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("conflict");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    queue.schedule(draft("more"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(queue.status).toBe("conflict");
    expect(await queue.flush()).toBe(false);
  });
});

describe("size and validity gates", () => {
  it("a draft over 256 KB is not sent", async () => {
    const { queue, calls } = setup();
    queue.schedule({
      ...draft("big"),
      profile: { name: "big", bio: "x".repeat(LIMITS.draftBytes), photo: null },
    } as DraftDoc);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(0);
    expect(queue.status).toBe("too-large");
    expect(queue.hasUnsaved).toBe(true);
  });

  it("counts jsonb's extra spaces: a draft whose compact JSON fits but whose jsonb text does not", async () => {
    const { queue, calls } = setup();
    const filler = Array.from({ length: 11_500 }, (_, i) => ({ id: `d${i}`, v: 1 }));
    const doc = { ...draft("edge"), filler } as unknown as DraftDoc;
    const compact = JSON.stringify({ ...doc, rev: 4 }).length;
    expect(compact).toBeLessThan(LIMITS.draftBytes);
    expect(jsonbTextBytes({ ...doc, rev: 4 })).toBeGreaterThan(LIMITS.draftBytes);
    queue.schedule(doc);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(0);
    expect(queue.status).toBe("too-large");
  });

  it("recovers once the draft is small enough again", async () => {
    const { queue, calls } = setup();
    queue.schedule({
      ...draft("big"),
      profile: { name: "big", bio: "x".repeat(LIMITS.draftBytes), photo: null },
    } as DraftDoc);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("too-large");
    queue.schedule(draft("small"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(1);
    expect(queue.status).toBe("saved");
  });

  it("a database refusal (check violation) is terminal too, with no retry", async () => {
    const { queue, calls } = setup([{ kind: "too-large" }]);
    queue.schedule(draft("a"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(queue.status).toBe("too-large");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(1);
  });

  it("a draft that fails the draft schema is not sent", async () => {
    const { queue, calls } = setup();
    const invalid = {
      ...draft("a"),
      blocks: [{ id: "x", type: "divider", visible: true }], // id too short
    } as unknown as DraftDoc;
    queue.schedule(invalid);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS + 10);
    expect(calls).toHaveLength(0);
    expect(queue.status).toBe("invalid");
  });
});

describe("dispose", () => {
  it("cancels the pending write", async () => {
    const { queue, calls } = setup();
    queue.schedule(draft("a"));
    queue.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(0);
  });
});
