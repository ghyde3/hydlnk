// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, toSubPagePublishForm, type SubPageDraft } from "@/lib/document";

/**
 * M15-10: saves that land while a publish is still answering. Every timing here is forced with a
 * deferred promise: nothing depends on how fast a request is.
 *
 *   - the rev a publish answers is adopted only while the editor still holds the rev it sent
 *     (Home's saver and the sub-pages' revisions); a save answered meanwhile keeps its newer rev;
 *   - after Publish all changes the editor adopts the revs the publish ANSWERED and never reads the
 *     stored revs again (A2): a rev another writer made since must stay a conflict;
 *   - a page is marked live with the form that was PUBLISHED, not with what was typed since.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

type Revs = { id: string; rev: number }[] | null;
const readEntryRevs = vi.fn<(siteId: string) => Promise<Revs>>();
vi.mock("@/lib/site-pages/entry-revs-client", () => ({
  readEntryRevs: (siteId: string) => readEntryRevs(siteId),
}));
// The save route: every write is stored and answers the next rev.
const postEntryDraft = vi.fn(
  async (_site: string, _entry: string, rev: number, _draft: unknown) =>
    ({ kind: "ok", rev: rev + 1, unchanged: false }) as const,
);
vi.mock("@/lib/site-pages/entry-save-client", () => ({
  postEntryDraft: (site: string, entry: string, rev: number, draft: unknown) =>
    postEntryDraft(site, entry, rev, draft),
}));
vi.mock("@/lib/media/cleanup-client", () => ({ scheduleMediaCleanup: () => {} }));
// The design write (`pages.draft`): always stored.
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
const { useSitePages } = await import("@/components/site/use-site-pages");
type SiteValue = ReturnType<typeof useSitePages>;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "00000000-0000-4000-8000-000000000001";
const SUB = "00000000-0000-4000-8000-000000000002";
const header = (text: string) => ({ id: "hdr-aaaaaaaa", type: "header", visible: true, text });
const homeDoc = (text: string, rev: number) =>
  ({ ...emptyDraft("mara"), rev, blocks: [header(text)] }) as never;
const lastSentRev = () => postEntryDraft.mock.calls.at(-1)![2];

beforeEach(() => {
  postEntryDraft.mockClear();
  readEntryRevs.mockReset();
});

describe("M15-10 Home's entry rev while a publish answers", () => {
  it("a save answered during Publish page keeps its rev: the publish's older answer is not adopted", async () => {
    const saver = createDraftSaver("p", { entryId: HOME, rev: 2 }, [header("One")]);
    // Publish page is sent with the rev held, and its answer is held.
    const sent = saver.homeRev()!;
    const publish = deferred<{ rev: number }>();
    // Meanwhile an edit is autosaved: the entry moves to rev 3.
    expect(await saver(homeDoc("Two", 2), "1")).toEqual({ kind: "ok" });
    expect(saver.homeRev()).toBe(3);
    // The publish answers the rev it was checked against.
    publish.resolve({ rev: sent });
    saver.adoptHomeRev((await publish.promise).rev, sent);
    expect(saver.homeRev()).toBe(3);
    // The next edit is saved against rev 3, so it is stored and not a conflict.
    await saver(homeDoc("Three", 3), "2");
    expect(lastSentRev()).toBe(3);
  });

  it("with no save in between, the rev the publish answered is adopted", () => {
    const saver = createDraftSaver("p", { entryId: HOME, rev: 2 }, [header("One")]);
    saver.adoptHomeRev(3, 2);
    expect(saver.homeRev()).toBe(3);
  });

  it("A2: Home's saver has no way to re-read the stored rev", () => {
    const saver = createDraftSaver("p", { entryId: HOME, rev: 2 }, [header("One")]);
    expect("refreshHomeRev" in saver).toBe(false);
  });
});

describe("M15-10 a sub-page's rev while a publish answers", () => {
  const doc = (text: string): SubPageDraft =>
    ({ path: "gallery", title: "Gallery", description: "", blocks: [header(text)] }) as never;

  it("a save answered during Publish page keeps its rev", async () => {
    const revisions = createSubPageRevisions({ [SUB]: 2 });
    const save = createSubPageSaveFn(revisions, "p");
    const sent = revisions.get(SUB)!;
    await save(SUB, doc("Two"));
    expect(revisions.get(SUB)).toBe(3);
    revisions.adopt(SUB, sent, sent);
    expect(revisions.get(SUB)).toBe(3);
    await save(SUB, doc("Three"));
    expect(lastSentRev()).toBe(3);
  });

  it("with no save in between, the answered rev is adopted", () => {
    const revisions = createSubPageRevisions({ [SUB]: 2 });
    revisions.adopt(SUB, 3, 2);
    expect(revisions.get(SUB)).toBe(3);
  });

  it("A2: the revisions have no way to re-read the stored revs", () => {
    const revisions = createSubPageRevisions({ [SUB]: 2 });
    expect("refresh" in revisions).toBe(false);
  });
});

describe("M15-10 what the editor calls live after a publish", () => {
  let root: Root;
  let site: SiteValue;
  const initialDraft: SubPageDraft = {
    path: "gallery",
    title: "Gallery",
    description: "",
    blocks: [],
  } as never;

  function Probe() {
    site = useSitePages({
      siteId: "p",
      plan: "pro",
      initial: [
        {
          id: SUB,
          draft: initialDraft,
          published: toSubPagePublishForm(initialDraft),
          livePath: "gallery",
          createdAt: "2026-11-01T00:00:00Z",
          rev: 1,
        },
      ],
      homeTitle: "Home",
      nav: { show: true, items: [] },
      editDraft: () => {},
    });
    return null;
  }
  const retitle = (title: string) => act(() => site.updateSettings(SUB, { title }));
  const store = async () => {
    let stored = false;
    await act(async () => {
      stored = await site.flush();
    });
    expect(stored).toBe(true);
  };

  beforeEach(() => {
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(site.pageStates[SUB]).toBe("live");
  });
  afterEach(() => act(() => root.unmount()));

  it("Publish page: an edit typed while it answers leaves the page with unpublished changes", async () => {
    retitle("One");
    await store();
    // Publish page is sent: this is the form that goes live. Its answer is held.
    const published = site.snapshotForms().get(SUB);
    const sent = site.revisions()[SUB]!;
    const publish = deferred<{ rev: number }>();
    // Typed, and autosaved, while it answers.
    retitle("Two");
    await store();
    publish.resolve({ rev: sent });
    const answer = await publish.promise;
    act(() => site.markPagePublished(SUB, { rev: answer.rev, sent, form: published }));
    // "One" is live, the draft says "Two".
    expect(published?.title).toBe("One");
    expect(site.pageStates[SUB]).toBe("changed");
    expect(site.dirty).toBe(true);
    // And the rev the save gave is kept.
    expect(site.revisions()[SUB]).toBe(sent + 1);
  });

  it("Publish page with nothing typed since: the page is live at the answered rev", async () => {
    retitle("One");
    await store();
    const sent = site.revisions()[SUB]!;
    const form = site.snapshotForms().get(SUB);
    act(() => site.markPagePublished(SUB, { rev: sent + 1, sent, form }));
    expect(site.pageStates[SUB]).toBe("live");
    expect(site.revisions()[SUB]).toBe(sent + 1);
  });

  it("Publish all changes: an edit typed while it answers is not called live", async () => {
    retitle("One");
    await store();
    const published = site.snapshotForms();
    const sent = site.revisions();
    retitle("Two");
    await store();
    act(() => site.markPublished(published, sent, sent));
    expect(site.pageStates[SUB]).toBe("changed");
    expect(site.dirty).toBe(true);
  });

  it("A2: Publish all changes adopts the revs the publish answered and reads none", async () => {
    retitle("One");
    await store();
    const sent = site.revisions();
    const before = sent[SUB]!;
    // The publish moved the entry's rev; meanwhile ANOTHER writer moved it further (rev + 5). A read
    // of the stored revs would bring that writer's rev in, and the next save would go over its draft.
    readEntryRevs.mockResolvedValue([{ id: SUB, rev: before + 5 }]);
    act(() => site.markPublished(site.snapshotForms(), { [SUB]: before + 1 }, sent));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(readEntryRevs).not.toHaveBeenCalled();
    expect(site.revisions()[SUB]).toBe(before + 1);
    expect(site.pageStates[SUB]).toBe("live");
    // The next save is sent with the answered rev: the route refuses it against the other writer's.
    retitle("Two");
    await act(async () => {
      await site.flush();
    });
    expect(lastSentRev()).toBe(before + 1);
  });

  it("A2: a rev answered for a page whose held rev moved since is not adopted", async () => {
    retitle("One");
    await store();
    const sent = site.revisions();
    retitle("Two");
    await store();
    const held = site.revisions()[SUB]!;
    act(() => site.markPublished(site.snapshotForms(), { [SUB]: sent[SUB]! + 1 }, sent));
    expect(site.revisions()[SUB]).toBe(held);
  });

  it("A2: Unpublish reads no revs either", async () => {
    readEntryRevs.mockResolvedValue([{ id: SUB, rev: 99 }]);
    const before = site.revisions()[SUB];
    act(() => site.markUnpublished());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(readEntryRevs).not.toHaveBeenCalled();
    expect(site.revisions()[SUB]).toBe(before);
  });

  it("the sub-pages' saves wait while held and go on release", async () => {
    const held = site.holdSaves();
    await held.settled;
    postEntryDraft.mockClear();
    retitle("Typed during publish");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(postEntryDraft).not.toHaveBeenCalled();
    expect(site.hasUnsaved()).toBe(true);
    await act(async () => {
      held.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
    expect(site.hasUnsaved()).toBe(false);
  });
});
