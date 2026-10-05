import { describe, expect, it, vi } from "vitest";
import { emptySubPageDraft, type SubPageDraft } from "@/lib/document";
import { SubPageSaver, type SubSaveResult, type SubSaveStatus } from "@/lib/site-pages/saver";

/** M11-08: the sub-pages' autosave queue (debounce, retry, refusals), with fake timers. */

function setup(results: SubSaveResult[] = []) {
  const calls: Array<{ id: string; doc: SubPageDraft }> = [];
  const statuses: SubSaveStatus[] = [];
  const blocked: Array<[string, unknown]> = [];
  const save = vi.fn(async (id: string, doc: SubPageDraft) => {
    calls.push({ id, doc });
    return results.shift() ?? ({ kind: "ok" } as SubSaveResult);
  });
  const saver = new SubPageSaver({
    save,
    onStatus: (s) => statuses.push(s),
    onBlocked: (id, b) => blocked.push([id, b]),
  });
  return { saver, calls, statuses, blocked, save };
}
const doc = (title: string): SubPageDraft => emptySubPageDraft("items", title);

describe("SubPageSaver", () => {
  it("writes once, 800 ms after the last edit", async () => {
    vi.useFakeTimers();
    const { saver, calls, statuses } = setup();
    saver.schedule("a", doc("one"));
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule("a", doc("two"));
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.map((c) => c.doc.title)).toEqual(["two"]);
    expect(statuses).toEqual(["pending", "saving", "saved"]);
    saver.dispose();
    vi.useRealTimers();
  });

  it("flush writes at once, for every edited page, and resolves true", async () => {
    vi.useFakeTimers();
    const { saver, calls } = setup();
    saver.schedule("a", doc("A"));
    saver.schedule("b", doc("B"));
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(saver.hasUnsaved).toBe(false);
    saver.dispose();
    vi.useRealTimers();
  });

  it("flush with nothing edited is true and writes nothing", async () => {
    const { saver, save } = setup();
    await expect(saver.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed write is retried with backoff and the edits are kept", async () => {
    vi.useFakeTimers();
    const { saver, calls, statuses } = setup([{ kind: "error" }]);
    saver.schedule("a", doc("A"));
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    expect(statuses.at(-1)).toBe("saved");
    saver.dispose();
    vi.useRealTimers();
  });

  it("a 401 is not retried on a timer; flush says false", async () => {
    vi.useFakeTimers();
    const { saver, calls, statuses } = setup([{ kind: "unauthorized" }]);
    saver.schedule("a", doc("A"));
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(1);
    expect(statuses.at(-1)).toBe("signed-out");
    await expect(saver.flush()).resolves.toBe(false);
    saver.dispose();
    vi.useRealTimers();
  });

  it("a blocked link is reported for that page, not retried, and cleared by the next edit of it", async () => {
    vi.useFakeTimers();
    const { saver, calls, statuses, blocked } = setup([
      { kind: "blocked", hosts: ["bad.example"], blockIds: ["b1"] },
    ]);
    saver.schedule("a", doc("A"));
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(1);
    expect(statuses.at(-1)).toBe("blocked");
    expect(blocked[0]?.[0]).toBe("a");
    expect(blocked[0]?.[1]).toMatchObject({ hosts: ["bad.example"], blockIds: ["b1"] });
    await expect(saver.flush()).resolves.toBe(false);
    saver.schedule("a", doc("A2"));
    expect(blocked.at(-1)).toEqual(["a", null]);
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses.at(-1)).toBe("saved");
    saver.dispose();
    vi.useRealTimers();
  });

  it("a draft that does not pass the schema or the size limit is not sent", async () => {
    vi.useFakeTimers();
    const bad = { ...doc("A"), path: "x".repeat(200) };
    const { saver, calls, statuses } = setup();
    saver.schedule("a", bad);
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(0);
    expect(statuses.at(-1)).toBe("invalid");
    saver.dispose();
    vi.useRealTimers();
  });

  it("an unsendable page does not hold back the others: they save, the bad one stays flagged", async () => {
    vi.useFakeTimers();
    const bad = { ...doc("A"), path: "x".repeat(200) };
    const { saver, calls, statuses } = setup();
    saver.schedule("a", bad);
    saver.schedule("b", doc("B"));
    saver.schedule("c", doc("C"));
    await expect(saver.flush()).resolves.toBe(false);
    expect(calls.map((c) => c.id)).toEqual(["b", "c"]);
    expect(saver.hasUnsaved).toBe(false);
    expect(statuses.at(-1)).toBe("invalid");
    // Editing the bad page again re-arms the queue and clears the flag once it reads.
    saver.schedule("a", doc("A fixed"));
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(statuses.at(-1)).toBe("saved");
    saver.dispose();
    vi.useRealTimers();
  });

  it("a page the server calls too large is flagged and the others still save", async () => {
    vi.useFakeTimers();
    const { saver, calls, statuses } = setup([{ kind: "too-large" }]);
    saver.schedule("a", doc("A"));
    saver.schedule("b", doc("B"));
    await expect(saver.flush()).resolves.toBe(false);
    expect(calls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(statuses.at(-1)).toBe("too-large");
    saver.dispose();
    vi.useRealTimers();
  });

  it("a page that no longer exists is reported and not retried", async () => {
    vi.useFakeTimers();
    const { saver, calls, statuses } = setup([{ kind: "missing" }]);
    saver.schedule("a", doc("A"));
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses.at(-1)).toBe("missing");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(1);
    saver.dispose();
    vi.useRealTimers();
  });

  it("drop forgets a deleted page without writing it", async () => {
    vi.useFakeTimers();
    const { saver, calls } = setup();
    saver.schedule("a", doc("A"));
    saver.drop("a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(0);
    await expect(saver.flush()).resolves.toBe(true);
    saver.dispose();
    vi.useRealTimers();
  });

  it("an edit made while a write is in flight is written next", async () => {
    vi.useFakeTimers();
    let release: (r: SubSaveResult) => void = () => {};
    const calls: string[] = [];
    const saver = new SubPageSaver({
      save: (_id, d) => {
        calls.push(d.title);
        return calls.length === 1
          ? new Promise<SubSaveResult>((resolve) => (release = resolve))
          : Promise.resolve({ kind: "ok" });
      },
      onStatus: () => {},
    });
    saver.schedule("a", doc("first"));
    await vi.advanceTimersByTimeAsync(800);
    saver.schedule("a", doc("second"));
    release({ kind: "ok" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(["first", "second"]);
    expect(saver.hasUnsaved).toBe(false);
    saver.dispose();
    vi.useRealTimers();
  });
});
