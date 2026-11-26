import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, emptySubPageDraft, type DraftDoc, type SubPageDraft } from "@/lib/document";
import { AUTOSAVE_DEBOUNCE_MS, AutosaveQueue, type SaveStatus } from "@/lib/editor/autosave";
import { SubPageSaver, type SubSaveStatus } from "@/lib/site-pages/saver";

/**
 * M15-10 (A3, A4): a save and a publish of the same entry never overlap. Publish HOLDS the save
 * queues it covers while its request is out; edits typed meanwhile are taken and wait, and go when
 * the hold is released, with the revs the publish answered.
 *
 *   - while a hold stands nothing is sent, whatever the debounce says, and typing is not refused;
 *   - on release ONE write goes, with the newest draft;
 *   - `settled` waits for the write that was already on the wire when the hold was taken;
 *   - the page the publish moved (rev 1 -> 2): the queued save is sent with rev 2, not 1 (A3);
 *   - a refused publish: the queued save is sent with the rev held before;
 *   - this tab's own autosave cannot land before the publish it would make a conflict (A4).
 */

const postEntryDraft = vi.fn(
  async (_site: string, _entry: string, rev: number, _draft: unknown) =>
    ({ kind: "ok", rev: rev + 1, unchanged: false }) as const,
);
vi.mock("@/lib/site-pages/entry-save-client", () => ({
  postEntryDraft: (site: string, entry: string, rev: number, draft: unknown) =>
    postEntryDraft(site, entry, rev, draft),
}));
vi.mock("@/lib/site-pages/entry-revs-client", () => ({ readEntryRevs: async () => null }));
vi.mock("@/lib/media/cleanup-client", () => ({ scheduleMediaCleanup: () => {} }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          is: () => ({ select: async () => ({ data: [{ id: "p" }], error: null, status: 200 }) }),
          eq: () => ({ select: async () => ({ data: [{ id: "p" }], error: null, status: 200 }) }),
        }),
      }),
    }),
  }),
}));
const { createDraftSaver } = await import("@/lib/editor/save-client");
const { createSubPageRevisions, createSubPageSaveFn } =
  await import("@/lib/site-pages/save-client");

const HOME = "00000000-0000-4000-8000-000000000001";
const SUB = "00000000-0000-4000-8000-000000000002";
const header = (text: string) => ({ id: "hdr-aaaaaaaa", type: "header", visible: true, text });
const home = (text: string): DraftDoc =>
  ({ ...emptyDraft("mara"), rev: 0, blocks: [header(text)] }) as never;
const sub = (title: string): SubPageDraft => emptySubPageDraft("gallery", title);
const sentRevs = () => postEntryDraft.mock.calls.map((call) => call[2]);
const LONG = AUTOSAVE_DEBOUNCE_MS * 20;

beforeEach(() => {
  vi.useFakeTimers();
  postEntryDraft.mockClear();
});
afterEach(() => vi.useRealTimers());

function homeQueue(rev: number) {
  const saver = createDraftSaver("p", { entryId: HOME, rev }, [header("Loaded")]);
  const statuses: SaveStatus[] = [];
  const queue = new AutosaveQueue({
    save: saver,
    onStatus: (status) => statuses.push(status),
    initial: { rev: 1, revKey: "1" },
  });
  return { saver, queue, statuses };
}
function subQueue(rev: number) {
  const revisions = createSubPageRevisions({ [SUB]: rev });
  const statuses: SubSaveStatus[] = [];
  const saver = new SubPageSaver({
    save: createSubPageSaveFn(revisions, "p"),
    onStatus: (status) => statuses.push(status),
  });
  return { revisions, saver, statuses };
}

describe("M15-10 Home's queue under a hold", () => {
  it("sends nothing while held, keeps taking edits, and sends the newest one on release", async () => {
    const { queue, statuses } = homeQueue(1);
    const held = queue.hold();
    await held.settled;
    queue.schedule(home("One"));
    await vi.advanceTimersByTimeAsync(LONG);
    queue.schedule(home("Two"));
    await vi.advanceTimersByTimeAsync(LONG);
    expect(postEntryDraft).not.toHaveBeenCalled();
    expect(queue.hasUnsaved).toBe(true);
    expect(statuses).not.toContain("conflict");

    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(postEntryDraft.mock.calls[0]![3])).toContain("Two");
    expect(queue.status).toBe("saved");
  });

  it("A3: Publish page moves Home's rev 1 -> 2 while an edit waits; the edit is sent with rev 2", async () => {
    const { saver, queue } = homeQueue(1);
    const held = queue.hold();
    await held.settled;
    const sent = saver.homeRev()!;
    // Typed while the publish answers.
    queue.schedule(home("Typed during publish"));
    await vi.advanceTimersByTimeAsync(LONG);
    expect(postEntryDraft).not.toHaveBeenCalled();
    // The answer: the publish left the entry at rev 2.
    saver.adoptHomeRev(2, sent);
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRevs()).toEqual([2]);
    expect(queue.status).toBe("saved");
    expect(saver.homeRev()).toBe(3);
  });

  it("a refused publish adopts nothing: the queued edit is sent with the rev held before", async () => {
    const { saver, queue } = homeQueue(4);
    const held = queue.hold();
    queue.schedule(home("Typed"));
    await vi.advanceTimersByTimeAsync(LONG);
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRevs()).toEqual([4]);
    expect(saver.homeRev()).toBe(5);
  });

  it("A4: the tab's own autosave cannot land before a publish whose request is still out", async () => {
    const { saver, queue } = homeQueue(1);
    // Publish reads the revs it will be checked against, then its request is held in the browser.
    const held = queue.hold();
    await held.settled;
    const expected = saver.homeRev();
    queue.schedule(home("Typed while the request waits"));
    await vi.advanceTimersByTimeAsync(LONG);
    // Nothing moved the entry: the publish is still checked against what is stored.
    expect(saver.homeRev()).toBe(expected);
    expect(postEntryDraft).not.toHaveBeenCalled();
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
  });

  it("settled waits for the write already on the wire, and that write is not held back", async () => {
    const { queue } = homeQueue(1);
    let answer!: () => void;
    postEntryDraft.mockImplementationOnce(
      (_site, _entry, rev) =>
        new Promise((resolve) => {
          answer = () => resolve({ kind: "ok", rev: rev + 1, unchanged: false });
        }),
    );
    queue.schedule(home("One"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
    const held = queue.hold();
    let settled = false;
    void held.settled.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    answer();
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);
    held.release();
  });

  it("holds nest: writes go only when the last one is released, and release twice is one release", async () => {
    const { queue } = homeQueue(1);
    const first = queue.hold();
    const second = queue.hold();
    queue.schedule(home("One"));
    await vi.advanceTimersByTimeAsync(LONG);
    first.release();
    first.release();
    await vi.advanceTimersByTimeAsync(LONG);
    expect(postEntryDraft).not.toHaveBeenCalled();
    second.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
  });

  it("flush during a hold resolves after the release, with the edit stored", async () => {
    const { queue } = homeQueue(1);
    const held = queue.hold();
    queue.schedule(home("One"));
    let stored: boolean | null = null;
    void queue.flush().then((ok) => (stored = ok));
    await vi.advanceTimersByTimeAsync(LONG);
    expect(stored).toBeNull();
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(stored).toBe(true);
  });
});

describe("M15-10 the sub-pages' queue under a hold", () => {
  it("sends nothing while held and the newest edit on release", async () => {
    const { saver } = subQueue(1);
    const held = saver.hold();
    await held.settled;
    saver.schedule(SUB, sub("One"));
    await vi.advanceTimersByTimeAsync(LONG);
    saver.schedule(SUB, sub("Two"));
    await vi.advanceTimersByTimeAsync(LONG);
    expect(postEntryDraft).not.toHaveBeenCalled();
    expect(saver.hasUnsaved).toBe(true);
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
    expect((postEntryDraft.mock.calls[0]![3] as SubPageDraft).title).toBe("Two");
    expect(saver.status).toBe("saved");
  });

  it("A3: the publish moves the page's rev 1 -> 2 while an edit waits; the edit is sent with rev 2", async () => {
    const { saver, revisions, statuses } = subQueue(1);
    const held = saver.hold();
    await held.settled;
    const sent = revisions.get(SUB)!;
    saver.schedule(SUB, sub("Typed during publish"));
    await vi.advanceTimersByTimeAsync(LONG);
    revisions.adopt(SUB, 2, sent);
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRevs()).toEqual([2]);
    expect(statuses).not.toContain("conflict");
    expect(revisions.get(SUB)).toBe(3);
  });

  it("a refused publish: the queued edit is sent with the rev held before", async () => {
    const { saver, revisions } = subQueue(6);
    const held = saver.hold();
    saver.schedule(SUB, sub("Typed"));
    await vi.advanceTimersByTimeAsync(LONG);
    held.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentRevs()).toEqual([6]);
    expect(revisions.get(SUB)).toBe(7);
  });
});
