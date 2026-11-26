/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toPublishForm, toSubPagePublishForm, type DraftDoc } from "@/lib/document";
import { blocks, fullDraft } from "./fixtures/page-document";
import { PAGE_A, USER_A, USER_B, identity, makeDeps, ownedPage } from "./support/mcp-fakes";

const mocks = vi.hoisted(() => ({ publish: vi.fn(), invalidate: vi.fn(), cleanup: vi.fn() }));
vi.mock("server-only", () => ({}));
// The tools take their client from the call; nothing here may build the secret-key client.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("no database in this test");
  },
}));
// The tools import the domain and billing code, which read the server environment at import.
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));
vi.mock("@/lib/publish/core", () => ({ publishPageCore: mocks.publish }));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: mocks.invalidate }));
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly: mocks.cleanup }));
vi.mock("@/lib/mcp/page-access", async (original) => ({
  ...(await original<typeof import("@/lib/mcp/page-access")>()),
  // No saved theme row and no custom domain: the reads these tests are not about.
  loadThemeTokens: async () => null,
  listPageDomains: async () => [],
}));

const { runTool } = await import("@/lib/mcp/run-tool");
const { TOOLS, toolByName } = await import("@/lib/mcp/tools");
const { MCP_SCOPES } = await import("@/lib/mcp/constants");
const { MCP_INSTRUCTIONS } = await import("@/lib/mcp/instructions");
const { MESSAGES } = await import("@/lib/mcp/errors");

/**
 * M15-10 step 6: per-page publishing does not change what the connector can do. `publish_page` still
 * publishes all changes of the site (it calls the gate with no expected revs and nothing but the
 * token's user), stays behind the publish scope, and says so; `get_page` reports each page's own
 * state, with the design's beside Home's. No database: the gate is a spy, the page comes from the
 * fake page lookup.
 */

const PUBLISHED_AT = "2026-10-20T10:00:00Z";
const SUB = "5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b";
const live = toPublishForm(fullDraft, null);

const publishTool = toolByName("publish_page")!;
const getTool = toolByName("get_page")!;

/** Home as the page lookup hands it over: the draft, and the live copy of design and blocks. */
const site = (draft: DraftDoc, over: Record<string, unknown> = {}) =>
  ownedPage({ publishedAt: PUBLISHED_AT, homeRev: 12, draft, published: live, ...over });

const json = (result: any) => JSON.parse(result.content[1].text);
const failure = (result: any) =>
  result.structuredContent.error as { code: string; message: string };

async function getPage(page: ReturnType<typeof site>, subPage?: Record<string, unknown>) {
  const { deps } = makeDeps({
    loadPage: async () => ({ ok: true, page }),
    loadSubPage: async (_user, siteId, id) => ({
      ok: true,
      subPage: {
        id,
        siteId,
        createdAt: PUBLISHED_AT,
        updatedAt: PUBLISHED_AT,
        rev: 4,
        publishedAt: null,
        livePath: null,
        ...subPage,
      },
    }),
  });
  const result = await runTool(
    getTool,
    identity(),
    { pageId: PAGE_A, ...(subPage ? { subPageId: SUB } : {}) },
    deps,
  );
  expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
  return { data: json(result), sentence: (result.content[0] as { text: string }).text };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.publish.mockResolvedValue({ ok: true, publishedAt: PUBLISHED_AT });
});

describe("M15-10 publish_page still means publish all changes", () => {
  it("says so in its description, and that hidden links are never an error", () => {
    const text = publishTool.description;
    expect(text).toContain("all changes");
    expect(text).toContain(
      "It publishes all changes: the design (theme, menu, profile) and every page of the site that changed since the last publish, including pages never published; pages that did not change keep their publish date.",
    );
    expect(text).toContain(
      "A menu item or page link that points at a page that is not live is hidden on the live site, never an error.",
    );
    // What was true before is still said.
    expect(text).toContain(
      "Makes the saved draft live on the public page at once, replacing what visitors see. Only call it when the person has asked to publish.",
    );
    for (const still of [
      "publish_refused",
      "blocked_link",
      "account_suspended",
      "10 publishes an hour",
    ]) {
      expect(text).toContain(still);
    }
    expect(text).not.toContain("whole site");
    expect(text.length).toBeLessThanOrEqual(800);
  });

  it("the server instructions say the same in their own words", () => {
    expect(MCP_INSTRUCTIONS).toContain("publish_page publishes all changes of the site.");
    expect(MCP_INSTRUCTIONS).not.toContain("whole site");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(1200);
  });

  it("is the one tool behind the publish scope: no per-page and no design publish tool was added", () => {
    expect(publishTool.scope).toBe(MCP_SCOPES.publish);
    expect(
      TOOLS.filter((tool) => tool.scope === MCP_SCOPES.publish).map((tool) => tool.name),
    ).toEqual(["publish_page"]);
    expect(TOOLS.map((tool) => tool.name).filter((name) => /publish/.test(name))).toEqual([
      "publish_page",
    ]);
    expect(TOOLS).toHaveLength(14);
  });

  it("a token without the publish scope never reaches the gate, the limiter or a page", async () => {
    const { deps, calls } = makeDeps();
    const result = await runTool(
      publishTool,
      identity({ scopes: [MCP_SCOPES.read, MCP_SCOPES.write] }),
      { pageId: PAGE_A },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(failure(result).code).toBe("insufficient_scope");
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("calls the gate once with the page and the token's user only: no expected revs, no page list", async () => {
    const { deps } = makeDeps();
    const result = await runTool(publishTool, identity(), { pageId: PAGE_A }, deps);
    expect(result.isError).toBeUndefined();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const [input, gateDeps] = mocks.publish.mock.calls[0]!;
    // Wave F (S4): the tool also says where the call came from, so decide() applies its MCP rule.
    expect(input).toEqual({ pageId: PAGE_A, userId: USER_A, source: "mcp" });
    expect(Object.keys(input).sort()).toEqual(["pageId", "source", "userId"]);
    expect("expected" in input).toBe(false);
    expect(Object.keys(gateDeps)).toEqual(["admin"]);
    expect(json(result)).toMatchObject({ published: true, publishedAt: PUBLISHED_AT });
    expect(mocks.invalidate).toHaveBeenCalledWith(PAGE_A);
  });

  it("the user is the token's, whatever the arguments say", async () => {
    const { deps } = makeDeps();
    // An argument that names another user is refused by the strict input, before the gate.
    const refused = await runTool(
      publishTool,
      identity(),
      { pageId: PAGE_A, userId: USER_B },
      deps,
    );
    expect(failure(refused).code).toBe("invalid_input");
    expect(mocks.publish).not.toHaveBeenCalled();
    for (const extra of [{ expected: { designRev: "1", entries: {} } }, { entryId: SUB }]) {
      const result = await runTool(publishTool, identity(), { pageId: PAGE_A, ...extra }, deps);
      expect(failure(result).code).toBe("invalid_input");
    }
    expect(mocks.publish).not.toHaveBeenCalled();
    // Another token: that token's user.
    await runTool(publishTool, identity({ userId: USER_B }), { pageId: PAGE_A }, deps);
    expect(mocks.publish.mock.calls[0]![0]).toEqual({ pageId: PAGE_A, userId: USER_B, source: "mcp" });
  });

  it("a refusal expires no cache; the gate's new conflict answer is the tool's conflict code", async () => {
    const { deps } = makeDeps();
    mocks.publish.mockResolvedValue({ ok: false, errors: [], reason: "conflict" });
    const conflict = await runTool(publishTool, identity(), { pageId: PAGE_A }, deps);
    expect(failure(conflict)).toMatchObject({ code: "conflict", message: MESSAGES.conflict });
    mocks.publish.mockResolvedValue({ ok: false, errors: [], reason: "forbidden" });
    expect(failure(await runTool(publishTool, identity(), { pageId: PAGE_A }, deps)).code).toBe(
      "not_found",
    );
    // A reason this tool does not know stays a plain server error, never a leak of the reason.
    mocks.publish.mockResolvedValue({ ok: false, errors: [], reason: "not_found_elsewhere" });
    const unknown = await runTool(publishTool, identity(), { pageId: PAGE_A }, deps);
    expect(failure(unknown).code).toBe("server_error");
    expect(JSON.stringify(unknown)).not.toContain("not_found_elsewhere");
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});

describe("M15-10 get_page reports each page's own status", () => {
  const [first, second, ...rest] = fullDraft.blocks;
  const blocksChanged: DraftDoc = { ...fullDraft, blocks: [second!, first!, ...rest] };
  const designChanged: DraftDoc = {
    ...fullDraft,
    profile: { ...fullDraft.profile, bio: "A new bio" },
  };

  it("says what the two statuses cover in its description", () => {
    expect(getTool.description).toContain(
      "publishStatus is this page's own; designStatus covers theme, menu and profile.",
    );
    expect(getTool.description).toContain("the only way to learn block ids and image ids");
    expect(getTool.description).toContain(
      "page (id, rev, publishStatus, designStatus, hasUnpublishedChanges, publishedAt)",
    );
    // list_pages uses the same two words for the same two things.
    const list = toolByName("list_pages")!.description;
    expect(list).toContain("publishStatus (Home's blocks) and designStatus (theme, menu, profile)");
    expect(list).toContain("hasUnpublishedChanges");
    expect(list).not.toContain("publishStatus of Home");
    expect(list.length).toBeLessThanOrEqual(800);
    expect(getTool.description.length).toBeLessThanOrEqual(800);
  });

  it("Home with nothing changed: both published", async () => {
    const { data, sentence } = await getPage(site(fullDraft));
    expect(data.page).toMatchObject({
      publishStatus: "published",
      designStatus: "published",
      hasUnpublishedChanges: false,
      publishedAt: PUBLISHED_AT,
    });
    expect(sentence).toContain("The draft matches the live page.");
  });

  it("Home with changed blocks and a live design: publishStatus changed, designStatus published", async () => {
    const { data, sentence } = await getPage(site(blocksChanged));
    expect(data.page).toMatchObject({
      publishStatus: "unpublished-changes",
      designStatus: "published",
      hasUnpublishedChanges: true,
    });
    expect(sentence).toContain("The draft has changes that aren’t live.");
  });

  it("the reverse: a changed design and live blocks", async () => {
    const { data, sentence } = await getPage(site(designChanged));
    expect(data.page).toMatchObject({
      publishStatus: "published",
      designStatus: "unpublished-changes",
      hasUnpublishedChanges: true,
    });
    expect(sentence).toContain("The design has changes that aren’t live.");
    // A menu change is a design change too.
    const menu = await getPage(site({ ...fullDraft, nav: { show: true, items: [SUB] } }));
    expect(menu.data.page).toMatchObject({
      publishStatus: "published",
      designStatus: "unpublished-changes",
    });
  });

  it("both changed, and a site never published", async () => {
    const both = await getPage(site({ ...designChanged, blocks: blocksChanged.blocks }));
    expect(both.data.page).toMatchObject({
      publishStatus: "unpublished-changes",
      designStatus: "unpublished-changes",
      hasUnpublishedChanges: true,
    });
    const never = await getPage(site(fullDraft, { publishedAt: null, published: null }));
    expect(never.data.page).toMatchObject({
      publishStatus: "not-published",
      designStatus: "not-published",
      hasUnpublishedChanges: true,
    });
    expect(never.sentence).toContain("The page isn’t published yet.");
  });

  it("a sub-page read reports that page's status while Home and the design differ", async () => {
    const draft = {
      path: "items",
      title: "Our items",
      description: "",
      blocks: [blocks.header],
    };
    const published = toSubPagePublishForm(draft as never);
    // Home's blocks and the design both have changes; the sub-page is live as it is.
    const changedSite = site({ ...designChanged, blocks: blocksChanged.blocks });
    const liveSub = await getPage(changedSite, {
      draft,
      published,
      publishedAt: PUBLISHED_AT,
      livePath: "items",
    });
    expect(liveSub.data.page).toMatchObject({
      subPageId: SUB,
      publishStatus: "published",
      hasUnpublishedChanges: false,
      live: true,
    });
    expect("designStatus" in liveSub.data.page).toBe(false);
    // The other way round: Home and the design are live, the sub-page has changes or was never published.
    const changedSub = await getPage(site(fullDraft), {
      draft: { ...draft, title: "Our new items" },
      published,
      publishedAt: PUBLISHED_AT,
      livePath: "items",
    });
    expect(changedSub.data.page).toMatchObject({
      publishStatus: "unpublished-changes",
      hasUnpublishedChanges: true,
    });
    const draftSub = await getPage(site(fullDraft), { draft, published: null });
    expect(draftSub.data.page).toMatchObject({
      publishStatus: "not-published",
      hasUnpublishedChanges: true,
      live: false,
    });
  });

  it("the answer holds the draft and never the live copy's own text", async () => {
    const page = site(
      { ...fullDraft, profile: { ...fullDraft.profile, bio: "DRAFT-ONLY-7f3a" } },
      { published: { ...live, profile: { ...live.profile, bio: "PUBLISHED-ONLY-91c2" } } },
    );
    const { data } = await getPage(page);
    const text = JSON.stringify(data);
    expect(text).toContain("DRAFT-ONLY-7f3a");
    expect(text).not.toContain("PUBLISHED-ONLY-91c2");
  });
});
