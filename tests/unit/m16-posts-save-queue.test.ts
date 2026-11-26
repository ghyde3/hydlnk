import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST_SAVE_DEBOUNCE_MS, PostSaveQueue, type PostSaveView } from "@/lib/posts/save-queue";
import type { EntrySaveAnswer } from "@/lib/site-pages/entry-save-client";

/**
 * The post editor's autosave (M16-13, M16-15): 1.5 s after the last edit, one request at a time,
 * always at the rev the server last answered. A stale rev stops saving for good (the conflict
 * notice); a save and a publish of the same post never overlap, and the editor takes only the rev
 * the publish answers.
 */

type Draft = { title: string };
const ok = (rev: number): EntrySaveAnswer => ({ kind: "ok", rev, unchanged: false });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(answers: Array<EntrySaveAnswer | Promise<EntrySaveAnswer>>, rev = 3) {
  const calls: Array<{ rev: number; draft: Draft }> = [];
  const views: PostSaveView[] = [];
  const queue = new PostSaveQueue<Draft>({
    rev,
    save: async (sentRev, draft) => {
      calls.push({ rev: sentRev, draft });
      const next = answers.shift();
      if (next === undefined) throw new Error("no answer queued");
      return next;
    },
    onChange: (view) => views.push(view),
  });
  return { queue, calls, views };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PostSaveQueue", () => {
  it("waits 1.5 s after the last edit, sends the newest draft once and adopts the answered rev", async () => {
    const { queue, calls } = setup([ok(4)]);
    queue.push({ title: "a" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS - 1);
    queue.push({ title: "ab" });
    expect(queue.view.state).toBe("unsaved");
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS - 1);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ rev: 3, draft: { title: "ab" } }]);
    expect(queue.view).toEqual({ state: "saved", problem: null });
    expect(queue.rev).toBe(4);
    expect(POST_SAVE_DEBOUNCE_MS).toBe(1500);
  });

  it("keeps one request in flight: an edit made meanwhile goes next, at the new rev", async () => {
    const first = deferred<EntrySaveAnswer>();
    const { queue, calls } = setup([first.promise, ok(5)]);
    queue.push({ title: "one" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(queue.view.state).toBe("saving");
    queue.push({ title: "two" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS * 3);
    expect(calls).toHaveLength(1);
    first.resolve(ok(4));
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(calls).toEqual([
      { rev: 3, draft: { title: "one" } },
      { rev: 4, draft: { title: "two" } },
    ]);
    expect(queue.rev).toBe(5);
    expect(queue.view.state).toBe("saved");
  });

  it("a stale rev (a write from elsewhere, as MCP makes) is a conflict: nothing is sent again", async () => {
    const { queue, calls } = setup([{ kind: "conflict" }]);
    queue.push({ title: "mine" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(queue.view.state).toBe("conflict");
    expect(queue.rev).toBe(3);
    queue.push({ title: "mine again" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS * 10);
    expect(calls).toHaveLength(1);
    expect(await queue.flush()).toBe(false);
    expect(calls).toHaveLength(1);
    const ran = vi.fn();
    expect(await queue.exclusive(ran)).toEqual({ ok: false });
    expect(ran).not.toHaveBeenCalled();
  });

  it("a refusal shows as an error with its reason and the next edit tries again", async () => {
    const { queue, calls } = setup([{ kind: "too-large" }, ok(4)]);
    queue.push({ title: "big" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(queue.view).toEqual({ state: "error", problem: "too-large" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    queue.push({ title: "small" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(queue.view).toEqual({ state: "saved", problem: null });
  });

  it("a network failure is retried without a new edit", async () => {
    const { queue, calls } = setup([{ kind: "error" }, ok(4)]);
    queue.push({ title: "x" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(queue.view).toEqual({ state: "error", problem: "error" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2);
    expect(queue.view.state).toBe("saved");
  });

  it("flush sends at once and says whether everything is stored", async () => {
    const { queue, calls } = setup([ok(4)]);
    queue.push({ title: "now" });
    const done = queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(await done).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await queue.flush()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("exclusive: the pending edit is stored first, then the action runs alone at that rev", async () => {
    const save = deferred<EntrySaveAnswer>();
    const { queue, calls } = setup([save.promise, ok(9)]);
    const order: string[] = [];
    queue.push({ title: "typed" });
    const publish = deferred<{ rev: number; value: string }>();
    const running = queue.exclusive(async (rev) => {
      order.push(`publish at ${rev}`);
      return publish.promise;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ rev: 3, draft: { title: "typed" } }]);
    expect(order).toEqual([]);
    save.resolve(ok(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["publish at 4"]);

    // Typed while the publish is on the wire: held, not sent.
    queue.push({ title: "typed during publish" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS * 4);
    expect(calls).toHaveLength(1);
    expect(queue.view.state).toBe("unsaved");

    // The publish answers rev 7: the editor adopts that rev and nothing else, then saves the held edit.
    publish.resolve({ rev: 7, value: "live" });
    expect(await running).toEqual({ ok: true, value: "live" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(calls[1]).toEqual({ rev: 7, draft: { title: "typed during publish" } });
    expect(queue.rev).toBe(9);
  });

  it("exclusive: an action that fails leaves the rev alone and saving goes on", async () => {
    const { queue, calls } = setup([ok(4)]);
    await expect(
      queue.exclusive(async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect(queue.rev).toBe(3);
    queue.push({ title: "after" });
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS);
    expect(calls).toEqual([{ rev: 3, draft: { title: "after" } }]);
  });

  it("exclusive: when the pending edit cannot be stored, the action does not run", async () => {
    const { queue } = setup([{ kind: "invalid" }]);
    queue.push({ title: "bad" });
    const ran = vi.fn();
    const out = queue.exclusive(ran);
    await vi.advanceTimersByTimeAsync(0);
    expect(await out).toEqual({ ok: false });
    expect(ran).not.toHaveBeenCalled();
  });

  it("dispose stops everything", async () => {
    const { queue, calls } = setup([ok(4)]);
    queue.push({ title: "x" });
    queue.dispose();
    await vi.advanceTimersByTimeAsync(POST_SAVE_DEBOUNCE_MS * 2);
    expect(calls).toEqual([]);
  });
});
