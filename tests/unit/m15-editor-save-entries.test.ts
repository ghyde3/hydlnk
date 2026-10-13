import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockDefaults,
  emptyDraft,
  emptySubPageDraft,
  type Block,
  type DraftDoc,
} from "@/lib/document";

/**
 * 1b1-17 (M15-05): the browser-side saves after the move. Home's design goes to pages.draft without
 * `blocks` under draft->>rev; Home's blocks go to the entry route under the entry's own rev; a
 * sub-page goes to the entry route under its rev. Both revision counters advance independently.
 */

vi.mock("@/lib/media/cleanup-client", () => ({ scheduleMediaCleanup: () => {} }));

// pages.draft PATCH ------------------------------------------------------------------------------
type Answer = {
  data: { id: string }[] | null;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
  status: number;
};
let answer: Answer;
const patches: Array<{ draft: Record<string, unknown>; eqs: unknown[][]; isNull: unknown[][] }> =
  [];
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      expect(table).toBe("pages");
      const entry = {
        draft: {} as Record<string, unknown>,
        eqs: [] as unknown[][],
        isNull: [] as unknown[][],
      };
      const builder: Record<string, unknown> = {
        update: (patch: { draft: Record<string, unknown> }) => {
          entry.draft = patch.draft;
          return builder;
        },
        eq: (...args: unknown[]) => {
          entry.eqs.push(args);
          return builder;
        },
        is: (...args: unknown[]) => {
          entry.isNull.push(args);
          return builder;
        },
        select: async () => {
          patches.push(entry);
          return answer;
        },
      };
      return builder;
    },
  }),
}));

// The entry route ---------------------------------------------------------------------------------
interface Posted {
  url: string;
  body: { rev: number; draft: Record<string, unknown> };
}
const posts: Posted[] = [];
let routeAnswers: Array<{ status: number; body: unknown } | "throw">;

beforeEach(() => {
  patches.length = 0;
  posts.length = 0;
  answer = { data: [{ id: "site" }], error: null, status: 200 };
  routeAnswers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) });
      const next = routeAnswers.shift();
      if (next === "throw") throw new Error("offline");
      const out = next ?? {
        status: 200,
        body: { kind: "ok", rev: posts.at(-1)!.body.rev + 1, unchanged: false },
      };
      return new Response(JSON.stringify(out.body), { status: out.status });
    }),
  );
});

const { createDraftSaver } = await import("@/lib/editor/save-client");
const { createSubPageRevisions, createSubPageSaveFn } =
  await import("@/lib/site-pages/save-client");

const SITE = "11111111-1111-4111-8111-111111111111";
const HOME = "22222222-2222-4222-8222-222222222222";
const link = (id: string, label = "L"): Block =>
  ({ ...blockDefaults.link(), id, label, url: "https://example.com/x" }) as Block;
const doc = (blocks: Block[], rev = 5, name = "mara"): DraftDoc => ({
  ...emptyDraft("mara"),
  rev,
  profile: { name, bio: "", photo: null },
  blocks,
});

describe("Home's autosave on page entries", () => {
  it("sends the blocks to the entry route under the entry rev, then the design without blocks under draft->>rev", async () => {
    const save = createDraftSaver(SITE, { entryId: HOME, rev: 7 });
    const out = await save(doc([link("lnk-aaaaaaaa")], 5), "4");
    expect(out).toEqual({ kind: "ok" });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(`/api/pages/${SITE}/entries/${HOME}/draft`);
    expect(posts[0]!.body.rev).toBe(7);
    expect(posts[0]!.body.draft).toMatchObject({ path: "/", title: "", description: "" });
    expect((posts[0]!.body.draft.blocks as Block[]).map((b) => b.id)).toEqual(["lnk-aaaaaaaa"]);

    expect(patches).toHaveLength(1);
    expect("blocks" in patches[0]!.draft).toBe(false);
    expect(patches[0]!.draft.rev).toBe(5);
    expect(patches[0]!.eqs).toContainEqual(["draft->>rev", "4"]);
  });

  it("keeps the entry rev between saves, and does not resend blocks that did not change", async () => {
    const save = createDraftSaver(SITE, { entryId: HOME, rev: 7 });
    const blocks = [link("lnk-aaaaaaaa")];
    await save(doc(blocks, 5), "4");
    // A theme-only edit: the same blocks, the next design rev.
    await save(doc(blocks, 6, "mara 2"), "5");
    expect(posts).toHaveLength(1);
    expect(patches).toHaveLength(2);
    // A block edit goes out under the rev the first save returned.
    await save(doc([link("lnk-aaaaaaaa", "Changed")], 7), "6");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body.rev).toBe(8);
  });

  it("a conflict on the blocks stops before the design is written", async () => {
    routeAnswers = [{ status: 409, body: { kind: "conflict", currentRev: 9 } }];
    const save = createDraftSaver(SITE, { entryId: HOME, rev: 7 });
    expect(await save(doc([link("lnk-aaaaaaaa")]), "4")).toEqual({ kind: "conflict" });
    expect(patches).toHaveLength(0);
  });

  it("a conflict on the design leaves the blocks saved, and a retry does not resend them", async () => {
    const save = createDraftSaver(SITE, { entryId: HOME, rev: 7 });
    answer = { data: [], error: null, status: 200 };
    const edit = doc([link("lnk-aaaaaaaa")], 5);
    expect(await save(edit, "4")).toEqual({ kind: "conflict" });
    expect(posts).toHaveLength(1);
    answer = { data: [{ id: "site" }], error: null, status: 200 };
    expect(await save(edit, "4")).toEqual({ kind: "ok" });
    expect(posts).toHaveLength(1);
  });

  it("maps the route's answers to the queue's results", async () => {
    const cases: Array<[{ status: number; body: unknown } | "throw", unknown]> = [
      [{ status: 413, body: { kind: "too-large" } }, { kind: "too-large" }],
      [{ status: 403, body: { kind: "storage-full" } }, { kind: "storage-full" }],
      [
        {
          status: 422,
          body: { kind: "blocked", hosts: ["bad.example"], blockIds: ["lnk-aaaaaaaa"] },
        },
        { kind: "blocked", hosts: ["bad.example"], blockIds: ["lnk-aaaaaaaa"] },
      ],
      [{ status: 401, body: { kind: "unauthorized" } }, { kind: "unauthorized" }],
      [{ status: 404, body: { kind: "missing" } }, { kind: "conflict" }],
      [{ status: 422, body: { kind: "invalid", message: "x" } }, { kind: "invalid" }],
      [{ status: 500, body: { kind: "error" } }, { kind: "error" }],
      ["throw", { kind: "error" }],
    ];
    for (const [routeAnswer, expected] of cases) {
      posts.length = 0;
      routeAnswers = [routeAnswer];
      const save = createDraftSaver(SITE, { entryId: HOME, rev: 7 });
      expect(await save(doc([link("lnk-aaaaaaaa")]), "4"), JSON.stringify(routeAnswer)).toEqual(
        expected,
      );
    }
    expect(patches).toHaveLength(0);
  });

  it("a site with no Home entry saves the whole document to pages.draft as before", async () => {
    const save = createDraftSaver(SITE, null);
    expect(await save(doc([link("lnk-aaaaaaaa")], 5), "4")).toEqual({ kind: "ok" });
    expect(posts).toHaveLength(0);
    expect(Array.isArray(patches[0]!.draft.blocks)).toBe(true);
  });
});

describe("a sub-page's autosave on page entries", () => {
  const A = "33333333-3333-4333-8333-333333333333";
  const page = emptySubPageDraft("items", "Items");

  it("posts to the entry route under its rev and keeps the rev it returns", async () => {
    const revisions = createSubPageRevisions({ [A]: 3 });
    const save = createSubPageSaveFn(revisions, SITE);
    await expect(save(A, page)).resolves.toEqual({ kind: "ok" });
    expect(posts[0]!.url).toBe(`/api/pages/${SITE}/entries/${A}/draft`);
    expect(posts[0]!.body).toEqual({ rev: 3, draft: page });
    expect(revisions.get(A)).toBe(4);
    await save(A, page);
    expect(posts[1]!.body.rev).toBe(4);
  });

  it("an unchanged answer keeps the rev", async () => {
    routeAnswers = [{ status: 200, body: { kind: "ok", rev: 3, unchanged: true } }];
    const revisions = createSubPageRevisions({ [A]: 3 });
    await createSubPageSaveFn(revisions, SITE)(A, page);
    expect(revisions.get(A)).toBe(3);
  });

  it("never writes a page whose rev is unknown", async () => {
    const save = createSubPageSaveFn(createSubPageRevisions({}), SITE);
    await expect(save(A, page)).resolves.toEqual({ kind: "conflict" });
    expect(posts).toHaveLength(0);
  });

  it("maps the route's answers", async () => {
    const cases: Array<[{ status: number; body: unknown } | "throw", unknown]> = [
      [{ status: 409, body: { kind: "conflict", currentRev: 9 } }, { kind: "conflict" }],
      [{ status: 404, body: { kind: "missing" } }, { kind: "missing" }],
      [{ status: 401, body: { kind: "unauthorized" } }, { kind: "unauthorized" }],
      [{ status: 413, body: { kind: "too-large" } }, { kind: "too-large" }],
      [{ status: 403, body: { kind: "storage-full" } }, { kind: "storage-full" }],
      [
        { status: 422, body: { kind: "blocked", hosts: ["h.example"], blockIds: ["b1"] } },
        { kind: "blocked", hosts: ["h.example"], blockIds: ["b1"] },
      ],
      [{ status: 500, body: { kind: "error" } }, { kind: "error" }],
      ["throw", { kind: "error" }],
    ];
    for (const [routeAnswer, expected] of cases) {
      routeAnswers = [routeAnswer];
      const revisions = createSubPageRevisions({ [A]: 3 });
      await expect(
        createSubPageSaveFn(revisions, SITE)(A, page),
        JSON.stringify(routeAnswer),
      ).resolves.toEqual(expected);
      expect(revisions.get(A)).toBe(3);
    }
  });
});
