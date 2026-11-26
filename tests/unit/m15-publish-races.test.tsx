// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyDraft,
  toPublishForm,
  toSubPagePublishForm,
  type DraftDoc,
  type SubPageDraft,
} from "@/lib/document";

/**
 * M15-10: saves that land while a publish is still answering. Every timing here is forced with a
 * deferred promise: nothing depends on how fast a request is.
 *
 *   - the rev a publish answers is adopted only while the editor still holds the rev it sent
 *     (Home's saver and the sub-pages' revisions); a save answered meanwhile keeps its newer rev;
 *   - after Publish all changes the editor adopts the revs the publish ANSWERED and never reads the
 *     stored revs again (A2): a rev another writer made since must stay a conflict;
 *   - a page is marked live with the form that was PUBLISHED, not with what was typed since;
 *   - Home and the design too: an edit typed while Publish stores the other queue's edits (before
 *     the hold) is either stored before the publish is sent, or not called live.
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

// The workspace provider's seams: the client env, the router and the publish Server Actions.
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test",
    NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.test",
  },
}));
vi.mock("@/components/editor/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  useSelectedLayoutSegment: () => "editor",
}));
type PublishAllAnswer = {
  ok: true;
  revs: { entries: Record<string, number> };
  publishedAt: string;
};
const publishPage = vi.fn<(pageId: string, expected?: unknown) => Promise<PublishAllAnswer>>();
vi.mock("@/lib/editor/contracts", () => ({
  publishPage: (pageId: string, expected?: unknown) => publishPage(pageId, expected),
  publishSitePage: vi.fn(),
  publishDesign: vi.fn(),
  unpublishSite: vi.fn(),
}));

const { createDraftSaver } = await import("@/lib/editor/save-client");
const { createSubPageRevisions, createSubPageSaveFn } =
  await import("@/lib/site-pages/save-client");
const { useSitePages } = await import("@/components/site/use-site-pages");
type SiteValue = ReturnType<typeof useSitePages>;
const { WorkspaceProvider } = await import("@/components/workspace/workspace-provider");
const { useWorkspace } = await import("@/components/workspace/workspace-context");
type Workspace = ReturnType<typeof useWorkspace>;
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

describe("M15-10 an edit of Home typed while Publish stores the sub-pages' edits", () => {
  let root: Root;
  let ws: Workspace;
  const loaded: DraftDoc = { ...emptyDraft("mara"), rev: 1 };
  const subDraft: SubPageDraft = {
    path: "gallery",
    title: "Gallery",
    description: "",
    blocks: [],
  } as never;

  function Probe() {
    ws = useWorkspace();
    return null;
  }
  const tick = (ms = 20) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const typeOnHome = (text: string) =>
    act(() => ws.editDraft((draft) => ({ ...draft, blocks: [header(text)] }) as never));
  const homeSaves = (text: string) =>
    postEntryDraft.mock.calls.filter(
      (call) => call[1] === HOME && JSON.stringify(call[3]).includes(text),
    ).length;

  beforeEach(() => {
    publishPage.mockReset();
    root = createRoot(document.createElement("div"));
    act(() =>
      root.render(
        createElement(
          WorkspaceProvider,
          {
            pageId: "p",
            ownerId: "u",
            plan: "pro",
            handle: "mara",
            address: "mara.hydlnk.test",
            name: "Mara",
            liveUrl: "https://mara.hydlnk.test",
            publicAddress: "mara.hydlnk.test",
            primaryDomain: null,
            chrome: {} as never,
            draft: loaded,
            revKey: "1",
            home: { entryId: HOME, rev: 1 },
            repaired: false,
            hasPublished: true,
            published: toPublishForm(loaded, null),
            publishedAt: "2026-11-01T00:00:00Z",
            themeTokens: null,
            templateThemes: {},
            themes: [],
            themesFailed: false,
            subPages: [
              {
                id: SUB,
                draft: subDraft,
                published: toSubPagePublishForm(subDraft),
                livePath: "gallery",
                createdAt: "2026-11-01T00:00:00Z",
                rev: 1,
              },
            ],
          } as never,
          createElement(Probe),
        ),
      ),
    );
    expect(ws.status).toBe("published");
  });
  afterEach(() => act(() => root.unmount()));

  it("Publish all: the edit is not called live unless it was stored before the publish was sent", async () => {
    // Home and the design have had no save since the load; a sub-page is dirty.
    act(() => ws.site.updateSettings(SUB, { title: "One" }));
    expect(ws.status).toBe("unpublished-changes");
    // Publish all stores the sub-page first, and that write is slow.
    const subWrite = deferred<void>();
    postEntryDraft.mockImplementationOnce(async (_site, _entry, rev) => {
      await subWrite.promise;
      return { kind: "ok", rev: rev + 1, unchanged: false } as const;
    });
    // What the server freezes is what is stored when its request arrives.
    let storedWhenPublished = false;
    publishPage.mockImplementation(async () => {
      storedWhenPublished = homeSaves("Typed meanwhile") > 0;
      return { ok: true, revs: { entries: {} }, publishedAt: "2026-11-02T00:00:00Z" };
    });
    let publish!: Promise<boolean>;
    act(() => {
      publish = ws.publishAll();
    });
    await tick();
    expect(postEntryDraft).toHaveBeenCalledTimes(1);
    expect(postEntryDraft.mock.calls[0]![1]).toBe(SUB);
    expect(publishPage).not.toHaveBeenCalled();
    // Typed on Home while that write is out: before any hold is taken.
    typeOnHome("Typed meanwhile");
    subWrite.resolve();
    let ok = false;
    await act(async () => {
      ok = await publish;
    });
    await tick();
    expect(ok).toBe(true);
    expect(publishPage).toHaveBeenCalledTimes(1);
    // The edit was stored before the hold was taken, so it went live with the rest.
    expect(storedWhenPublished).toBe(true);
    // The chip says Published only when the published site has the edit.
    expect(ws.status).toBe(storedWhenPublished ? "published" : "unpublished-changes");
    // And the edit is stored either way.
    expect(homeSaves("Typed meanwhile")).toBe(1);
    expect(ws.autosave.status).toBe("saved");
  });

  it("Publish all: an edit of Home typed while the publish answers is not called live, and is saved after", async () => {
    act(() => ws.site.updateSettings(SUB, { title: "One" }));
    const answer = deferred<void>();
    publishPage.mockImplementation(async () => {
      await answer.promise;
      return { ok: true, revs: { entries: {} }, publishedAt: "2026-11-02T00:00:00Z" };
    });
    let publish!: Promise<boolean>;
    act(() => {
      publish = ws.publishAll();
    });
    await tick();
    expect(publishPage).toHaveBeenCalledTimes(1);
    typeOnHome("Typed during the answer");
    await tick(1200);
    // Held: the edit waits.
    expect(homeSaves("Typed during the answer")).toBe(0);
    answer.resolve();
    await act(async () => {
      expect(await publish).toBe(true);
    });
    await tick();
    expect(ws.status).toBe("unpublished-changes");
    expect(homeSaves("Typed during the answer")).toBe(1);
  });
});
