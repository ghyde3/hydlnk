import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { fullPublished } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the table test always passes its own client");
  },
}));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
// The size guard cannot be reached with a document that passes the schema (its limits are far
// below the cap), so one test makes the measure report a draft over the cap.
const size = { forceOver: false };
vi.mock("@/lib/editor/size", async (original) => {
  const real = await original<typeof import("@/lib/editor/size")>();
  return {
    ...real,
    jsonbTextBytes: (value: unknown) => (size.forceOver ? 524_289 : real.jsonbTextBytes(value)),
  };
});

const { loadVersionPreviewCore, restorePageVersionCore } = await import("@/lib/versions/core");
const actions = await import("@/lib/versions/actions");

/**
 * M6-49: the two actions take two ids and no document, and check in this order, reading and writing
 * nothing before the previous check passes: no session, a page that is not the user's, a suspended
 * owner, a plan that keeps no versions, a version id that is not this page's, then the work. A table
 * runs every branch against a recording stand-in for the secret-key client and shows that none of
 * the failing ones writes (and that a failing early check reads nothing that comes after it).
 */

const OWNER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PAGE = "00000000-0000-4000-8000-0000000000b1";
const OTHER_PAGE = "00000000-0000-4000-8000-0000000000c1";
const VERSION = "11111111-1111-4111-8111-111111111111";
const FOREIGN_VERSION = "22222222-2222-4222-8222-222222222222";
const THEIR_VERSION = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_VERSION = "44444444-4444-4444-8444-444444444444";

interface World {
  pages: { id: string; owner_id: string; draft: unknown; draft_rev: string | null }[];
  accounts: { id: string; plan: string; suspended_at: string | null }[];
  versions: { id: string; page_id: string; version_no: number; document: unknown }[];
  themes: { id: string; owner_id: string | null; tokens: unknown }[];
  /** Hosts the blocklist function reports for any draft. */
  blockedHosts: string[];
  /** The update of the draft matches no row (another tab saved first). */
  staleWrite: boolean;
  writeError: { code: string; message: string; details?: string; hint?: string } | null;
}

interface Call {
  kind: "select" | "update" | "rpc" | "exists";
  table: string;
  filters: [string, unknown][];
  payload?: unknown;
}

function makeWorld(over: Partial<World> = {}): World {
  const draft = {
    version: 1,
    rev: 4,
    profile: { name: "Old", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: [],
  };
  return {
    pages: [
      { id: PAGE, owner_id: OWNER, draft, draft_rev: "4" },
      { id: OTHER_PAGE, owner_id: OWNER, draft, draft_rev: "4" },
      { id: "00000000-0000-4000-8000-0000000000d1", owner_id: OTHER, draft, draft_rev: "4" },
    ],
    accounts: [
      { id: OWNER, plan: "pro", suspended_at: null },
      { id: OTHER, plan: "pro", suspended_at: null },
    ],
    versions: [
      { id: VERSION, page_id: PAGE, version_no: 8, document: fullPublished },
      { id: FOREIGN_VERSION, page_id: OTHER_PAGE, version_no: 1, document: fullPublished },
      {
        id: THEIR_VERSION,
        page_id: "00000000-0000-4000-8000-0000000000d1",
        version_no: 1,
        document: fullPublished,
      },
    ],
    themes: [],
    blockedHosts: [],
    staleWrite: false,
    writeError: null,
    ...over,
  };
}

/** A recording stand-in for the supabase-js builder: just enough of it for the version core. */
function fakeAdmin(world: World) {
  const calls: Call[] = [];
  const rowsOf = (table: string): Record<string, unknown>[] =>
    table === "pages"
      ? world.pages
      : table === "accounts"
        ? world.accounts
        : table === "page_versions"
          ? world.versions
          : table === "themes"
            ? world.themes
            : [];

  function from(table: string) {
    const call: Call = { kind: "select", table, filters: [] };
    calls.push(call);
    const matches = (row: Record<string, unknown>) =>
      call.filters.every(([column, value]) => {
        if (column === "owner_id.is.null,owner_id.eq")
          return row.owner_id === null || row.owner_id === value;
        if (column === "draft->>rev")
          return value === null ? row.draft_rev === null : row.draft_rev === value;
        return row[column] === value;
      });
    const builder = {
      select(columns?: string) {
        if (call.kind === "select") call.payload = columns;
        return builder;
      },
      update(values: unknown) {
        call.kind = "update";
        call.payload = values;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return builder;
      },
      is(column: string, value: unknown) {
        call.filters.push([column, value]);
        return builder;
      },
      or(expression: string) {
        const owner = /owner_id\.eq\.([^,)]+)/.exec(expression)?.[1];
        call.filters.push(["owner_id.is.null,owner_id.eq", owner]);
        return builder;
      },
      async maybeSingle() {
        const row = rowsOf(table).find(matches);
        return { data: row ?? null, error: null };
      },
      then(resolve: (value: unknown) => unknown) {
        if (call.kind === "update") {
          if (world.writeError) return resolve({ data: null, error: world.writeError });
          if (world.staleWrite) return resolve({ data: [], error: null });
          const row = rowsOf(table).find(matches);
          return resolve({ data: row ? [{ id: row.id }] : [], error: null });
        }
        return resolve({ data: rowsOf(table).filter(matches), error: null });
      },
    };
    return builder;
  }

  return {
    calls,
    client: {
      from,
      rpc(fn: string, args: unknown) {
        calls.push({ kind: "rpc", table: fn, filters: [], payload: args });
        const rows = world.blockedHosts.map((host) => ({
          block_id: "link-portraits",
          item_id: null,
          field: "url",
          host,
          reason: "blocked_domain",
        }));
        return Promise.resolve({ data: rows, error: null });
      },
      storage: { from: () => ({ exists: async () => ({ data: true, error: null }) }) },
    } as never,
  };
}

const tablesRead = (calls: Call[]) => [
  ...new Set(calls.filter((c) => c.kind === "select").map((c) => c.table)),
];
const writes = (calls: Call[]) => calls.filter((c) => c.kind === "update");

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  getSessionUser.mockReset();
});

type Case = {
  name: string;
  world?: Partial<World>;
  input: { pageId: unknown; versionId: unknown; userId: string | null };
  reason: string;
  /** Tables that may have been read; anything after the failing check must be absent. */
  reads: string[];
};

const FAILING: Case[] = [
  {
    name: "no session",
    input: { pageId: PAGE, versionId: VERSION, userId: null },
    reason: "unauthorized",
    reads: [],
  },
  {
    name: "a user id that is not a uuid",
    input: { pageId: PAGE, versionId: VERSION, userId: "x" },
    reason: "unauthorized",
    reads: [],
  },
  {
    name: "a page id that is not a uuid",
    input: { pageId: "x", versionId: VERSION, userId: OWNER },
    reason: "forbidden",
    reads: [],
  },
  {
    name: "an empty page id",
    input: { pageId: "", versionId: VERSION, userId: OWNER },
    reason: "forbidden",
    reads: [],
  },
  {
    name: "a 10,000 character page id",
    input: { pageId: "a".repeat(10_000), versionId: VERSION, userId: OWNER },
    reason: "forbidden",
    reads: [],
  },
  {
    name: "SQL in the page id",
    input: { pageId: "' or 1=1 --", versionId: VERSION, userId: OWNER },
    reason: "forbidden",
    reads: [],
  },
  {
    name: "a page id that is not a string",
    input: { pageId: { id: PAGE }, versionId: VERSION, userId: OWNER },
    reason: "forbidden",
    reads: [],
  },
  {
    name: "a page that does not exist",
    input: { pageId: "00000000-0000-4000-8000-00000000ffff", versionId: VERSION, userId: OWNER },
    reason: "forbidden",
    reads: ["pages"],
  },
  {
    name: "another user's page (the version id is not looked at)",
    input: {
      pageId: "00000000-0000-4000-8000-0000000000d1",
      versionId: THEIR_VERSION,
      userId: OWNER,
    },
    reason: "forbidden",
    reads: ["pages"],
  },
  {
    name: "a suspended owner",
    world: { accounts: [{ id: OWNER, plan: "pro", suspended_at: "2026-10-01T00:00:00Z" }] },
    input: { pageId: PAGE, versionId: VERSION, userId: OWNER },
    reason: "account_suspended",
    reads: ["pages", "accounts"],
  },
  {
    name: "a Free plan (no version row is read)",
    world: { accounts: [{ id: OWNER, plan: "free", suspended_at: null }] },
    input: { pageId: PAGE, versionId: VERSION, userId: OWNER },
    reason: "plan_required",
    reads: ["pages", "accounts"],
  },
  {
    name: "a Free plan with a garbage version id still says plan_required",
    world: { accounts: [{ id: OWNER, plan: "free", suspended_at: null }] },
    input: { pageId: PAGE, versionId: "' or 1=1 --", userId: OWNER },
    reason: "plan_required",
    reads: ["pages", "accounts"],
  },
  {
    name: "an unknown plan name reads as Free",
    world: { accounts: [{ id: OWNER, plan: "enterprise", suspended_at: null }] },
    input: { pageId: PAGE, versionId: VERSION, userId: OWNER },
    reason: "plan_required",
    reads: ["pages", "accounts"],
  },
  {
    name: "a version id that is not a uuid",
    input: { pageId: PAGE, versionId: "x", userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts"],
  },
  {
    name: "an empty version id",
    input: { pageId: PAGE, versionId: "", userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts"],
  },
  {
    name: "a 10,000 character version id",
    input: { pageId: PAGE, versionId: "9".repeat(10_000), userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts"],
  },
  {
    name: "SQL in the version id",
    input: { pageId: PAGE, versionId: "1; drop table pages", userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts"],
  },
  {
    name: "an unknown version id",
    input: { pageId: PAGE, versionId: UNKNOWN_VERSION, userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts", "page_versions"],
  },
  {
    name: "a version of the owner's other page given with this page's id",
    input: { pageId: PAGE, versionId: FOREIGN_VERSION, userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts", "page_versions"],
  },
  {
    name: "another user's version id with this page's id",
    input: { pageId: PAGE, versionId: THEIR_VERSION, userId: OWNER },
    reason: "not_found",
    reads: ["pages", "accounts", "page_versions"],
  },
  {
    name: "a stored document that does not parse (the raw JSON is never returned)",
    world: {
      versions: [
        {
          id: VERSION,
          page_id: PAGE,
          version_no: 8,
          document: { version: 1, profile: "SECRET-RAW-JSON" },
        },
      ],
    },
    input: { pageId: PAGE, versionId: VERSION, userId: OWNER },
    reason: "error",
    reads: ["pages", "accounts", "page_versions"],
  },
];

describe("M6-49 the order of the checks, and no failing branch writes", () => {
  for (const kase of FAILING) {
    for (const action of ["preview", "restore"] as const) {
      it(`M6-49 ${action}: ${kase.name} is ${kase.reason}`, async () => {
        const world = makeWorld(kase.world);
        const { client, calls } = fakeAdmin(world);
        const run = action === "preview" ? loadVersionPreviewCore : restorePageVersionCore;
        const result = await run(kase.input, { admin: client, mediaExists: async () => true });
        expect(result).toMatchObject({ ok: false, reason: kase.reason });
        expect(JSON.stringify(result)).not.toContain("SECRET-RAW-JSON");
        expect(writes(calls)).toEqual([]);
        // Nothing is read before the previous check passed: exactly the reads up to the failing one.
        expect(tablesRead(calls)).toEqual(kase.reads);
        // The version row is never read for a plan that keeps none, or for a page that is not the user's.
        if (
          ["unauthorized", "forbidden", "account_suspended", "plan_required"].includes(kase.reason)
        ) {
          expect(tablesRead(calls)).not.toContain("page_versions");
        }
        // No cache call exists in this module at all (see the static test below); no rpc ran either.
        expect(calls.some((c) => c.kind === "rpc")).toBe(false);
      });
    }
  }
});

describe("M6-49 the work", () => {
  it("M6-49 preview returns the parsed document and a count, writes nothing and reads only", async () => {
    const world = makeWorld();
    const { client, calls } = fakeAdmin(world);
    const result = await loadVersionPreviewCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => true },
    );
    expect(result).toMatchObject({ ok: true, missingImages: 0 });
    if (!result.ok) throw new Error("unreachable");
    expect(result.doc.profile.name).toBe(fullPublished.profile.name);
    expect(writes(calls)).toEqual([]);
    expect(calls.some((c) => c.kind === "rpc")).toBe(false);
    // it never asks for another page's version, whatever the id says
    const versionReads = calls.filter((c) => c.table === "page_versions");
    expect(versionReads).toHaveLength(1);
    expect(versionReads[0]!.filters).toEqual([
      ["id", VERSION],
      ["page_id", PAGE],
    ]);
  });

  it("M6-49 preview counts the images that are gone and returns them as null", async () => {
    const { client } = fakeAdmin(makeWorld());
    const result = await loadVersionPreviewCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => false },
    );
    if (!result.ok) throw new Error("unreachable");
    expect(result.missingImages).toBe(3);
    expect(result.doc.profile.photo).toBeNull();
  });

  it("M6-49 an upload that is not in the owner's folder is never looked up in Storage", async () => {
    const stranger = `${OTHER}/avatar-aaaaaaaa.webp`;
    const doc = {
      ...fullPublished,
      profile: { ...fullPublished.profile, photo: { path: stranger, width: 400, height: 400 } },
    };
    const { client } = fakeAdmin(
      makeWorld({ versions: [{ id: VERSION, page_id: PAGE, version_no: 8, document: doc }] }),
    );
    const asked: string[] = [];
    const result = await loadVersionPreviewCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async (path) => (asked.push(path), true) },
    );
    if (!result.ok) throw new Error("unreachable");
    expect(result.doc.profile.photo).toBeNull();
    expect(result.missingImages).toBe(1);
    expect(asked).not.toContain(stranger);
  });

  it("M6-49 restore writes pages.draft and nothing else, filtered on the page, the owner and the rev read at the start", async () => {
    const world = makeWorld();
    const { client, calls } = fakeAdmin(world);
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => true },
    );
    expect(result).toEqual({ ok: true, restored: 8, missingImages: 0 });
    const written = writes(calls);
    expect(written).toHaveLength(1);
    expect(written[0]!.table).toBe("pages");
    expect(Object.keys(written[0]!.payload as object)).toEqual(["draft"]);
    expect(written[0]!.filters).toEqual([
      ["id", PAGE],
      ["owner_id", OWNER],
      ["draft->>rev", "4"],
    ]);
    const draft = (
      written[0]!.payload as { draft: { rev: number; blocks: { visible: boolean }[] } }
    ).draft;
    expect(draft.rev).toBe(5);
    expect(draft.blocks.every((b) => b.visible)).toBe(true);
    // no other table was written, and the blocklist was asked about the draft before the write
    expect(calls.filter((c) => c.kind === "update").map((c) => c.table)).toEqual(["pages"]);
    expect(calls.findIndex((c) => c.kind === "rpc")).toBeLessThan(
      calls.findIndex((c) => c.kind === "update"),
    );
  });

  it("M6-49 restore with a stored draft that has no rev guards on a null rev", async () => {
    const world = makeWorld();
    world.pages[0]!.draft_rev = null;
    world.pages[0]!.draft = { whatever: true };
    const { client, calls } = fakeAdmin(world);
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => true },
    );
    expect(result.ok).toBe(true);
    expect(writes(calls)[0]!.filters).toContainEqual(["draft->>rev", null]);
    expect((writes(calls)[0]!.payload as { draft: { rev: number } }).draft.rev).toBe(1);
  });

  it("M6-49 restore with a missing photo, card image, image-block image and background counts them and nulls them", async () => {
    const bg = `http://127.0.0.1:54321/storage/v1/object/public/page-media/${OWNER}/bg-aaaaaaaa.webp`;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const doc = {
      ...fullPublished,
      tokens: { ...fullPublished.tokens, bgType: "image" as const, bgImage: bg },
    };
    const world = makeWorld({
      versions: [{ id: VERSION, page_id: PAGE, version_no: 8, document: doc }],
    });
    const { client, calls } = fakeAdmin(world);
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => false },
    );
    expect(result).toEqual({ ok: true, restored: 8, missingImages: 4 });
    const draft = (
      writes(calls)[0]!.payload as {
        draft: { profile: { photo: unknown }; theme: { overrides: Record<string, unknown> } };
      }
    ).draft;
    expect(draft.profile.photo).toBeNull();
    expect(draft.theme.overrides.bgImage).toBeNull();
    expect(draft.theme.overrides.bgType).toBe("solid");
  });

  it("M6-49 a link to a site on the blocklist now is blocked_link with the hosts, and nothing is written", async () => {
    const { client, calls } = fakeAdmin(
      makeWorld({ blockedHosts: ["example.test", "bad.example"] }),
    );
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => true },
    );
    expect(result).toEqual({
      ok: false,
      reason: "blocked_link",
      hosts: ["bad.example", "example.test"],
    });
    expect(writes(calls)).toEqual([]);
  });

  it("M6-49 a draft that changed between the read and the write is a conflict", async () => {
    const { client, calls } = fakeAdmin(makeWorld({ staleWrite: true }));
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => true },
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(writes(calls)).toHaveLength(1);
  });

  it("M6-49 the database refusing the draft as a blocked link is blocked_link, and any other refusal is a plain error", async () => {
    const blocked = fakeAdmin(
      makeWorld({
        writeError: {
          code: "HL005",
          message: "blocked_link",
          details: "late.example",
          hint: "link-portraits",
        },
      }),
    );
    expect(
      await restorePageVersionCore(
        { pageId: PAGE, versionId: VERSION, userId: OWNER },
        { admin: blocked.client, mediaExists: async () => true },
      ),
    ).toEqual({ ok: false, reason: "blocked_link", hosts: ["late.example"] });

    const tooLarge = fakeAdmin(
      makeWorld({
        writeError: {
          code: "23514",
          message: "new row violates check constraint pages_draft_size",
          details: "Failing row contains (SECRET-ROW)",
        },
      }),
    );
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: tooLarge.client, mediaExists: async () => true },
    );
    expect(result).toEqual({ ok: false, reason: "error" });
    // nothing from the database's message reached a log line
    const logged = JSON.stringify([
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
    ]);
    expect(logged).not.toContain("SECRET-ROW");
  });

  it("M6-49 a restored draft over the 524288-byte cap is an error and nothing is written", async () => {
    const { client, calls } = fakeAdmin(makeWorld());
    size.forceOver = true;
    try {
      const result = await restorePageVersionCore(
        { pageId: PAGE, versionId: VERSION, userId: OWNER },
        { admin: client, mediaExists: async () => true },
      );
      expect(result).toMatchObject({ ok: false, reason: "error" });
    } finally {
      size.forceOver = false;
    }
    expect(writes(calls)).toEqual([]);
  });

  it("M6-49 a theme that is another user's is not used: the lookup is scoped to the owner and system themes", async () => {
    const themeId = "00000000-0000-4000-8000-000000000001";
    const draftWithTheme = { ...fullPublished, theme: { ...fullPublished.theme, ref: themeId } };
    const world = makeWorld({
      versions: [{ id: VERSION, page_id: PAGE, version_no: 8, document: draftWithTheme }],
      themes: [{ id: themeId, owner_id: OTHER, tokens: { bg: "#000000" } }],
    });
    const { client, calls } = fakeAdmin(world);
    const result = await restorePageVersionCore(
      { pageId: PAGE, versionId: VERSION, userId: OWNER },
      { admin: client, mediaExists: async () => true },
    );
    expect(result.ok).toBe(true);
    const draft = (writes(calls)[0]!.payload as { draft: { theme: { ref: string | null } } }).draft;
    expect(draft.theme.ref).toBeNull();
  });
});

describe("M6-49 logging: a short code and the ids, never a document, a URL or a token", () => {
  it("M6-49 every failure logs one line with a code and real uuids only", async () => {
    for (const kase of FAILING) {
      vi.mocked(console.warn).mockClear();
      vi.mocked(console.error).mockClear();
      const { client } = fakeAdmin(makeWorld(kase.world));
      await restorePageVersionCore(kase.input, { admin: client, mediaExists: async () => true });
      const lines = [
        ...vi.mocked(console.warn).mock.calls,
        ...vi.mocked(console.error).mock.calls,
      ].map((args) => args.join(" "));
      expect(lines.length, kase.name).toBe(1);
      expect(lines[0], kase.name).toMatch(/^\[versions\] restore [a-z_]+ page=\S+ version=\S+$/);
      // nothing hostile was echoed, however long
      expect(lines[0]!.length, kase.name).toBeLessThan(200);
      expect(lines[0], kase.name).not.toMatch(/drop table|1=1|SECRET|https?:|sb_secret/);
    }
  });
});

describe("M6-49 the actions", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  /** The file's code with its comments removed, so prose about a rule cannot trip a check on the rule. */
  const code = (path: string) =>
    source(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("M6-49 the module is 'use server' and exports exactly two async functions", () => {
    const text = source("src/lib/versions/actions.ts");
    expect(text.trimStart().startsWith('"use server"')).toBe(true);
    expect(text.match(/^export (?!type\b|interface\b)/gm)).toHaveLength(2);
    expect(text).toMatch(
      /^export async function loadVersionPreview\(\s*pageId: string,\s*versionId: string,?\s*\)/m,
    );
    expect(text).toMatch(
      /^export async function restorePageVersion\(\s*pageId: string,\s*versionId: string,?\s*\)/m,
    );
  });

  it("M6-49 they take two ids and no document (type test)", () => {
    expectTypeOf(actions.loadVersionPreview).parameters.toEqualTypeOf<[string, string]>();
    expectTypeOf(actions.restorePageVersion).parameters.toEqualTypeOf<[string, string]>();
    // @ts-expect-error a document cannot be passed
    void (() => actions.restorePageVersion("page", "version", { profile: { name: "x" } }));
    // @ts-expect-error a document cannot stand in for the version id
    void (() => actions.loadVersionPreview("page", { profile: { name: "x" } }));
    expect(actions.loadVersionPreview.length).toBe(2);
    expect(actions.restorePageVersion.length).toBe(2);
  });

  it("M6-49 the action reads the session user and passes the ids on, with no session as null", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await actions.loadVersionPreview(PAGE, VERSION)).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(await actions.restorePageVersion(PAGE, VERSION)).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(getSessionUser).toHaveBeenCalledTimes(2);
  });

  it("M6-49 nothing in the versions module touches the cache or publishes", () => {
    const dir = join(process.cwd(), "src/lib/versions");
    for (const name of readdirSync(dir)) {
      const text = code(`src/lib/versions/${name}`);
      expect(text, name).not.toMatch(
        /next\/cache|updateTag|revalidateTag|revalidatePath|publishPage/,
      );
      // the three modules that act never name the live document or its time as something to write
      if (["core.ts", "actions.ts", "restore.ts"].includes(name)) {
        expect(text, name).not.toMatch(/\.published\b|published_at\s*:|published\s*:/);
      }
      // the list loader only reads
      if (name === "load.ts") expect(text, name).not.toMatch(/\.(?:update|insert|delete|upsert)\(/);
    }
  });

  it("M6-49 the core imports the secret-key client under server-only, the action does not touch it", () => {
    const core = source("src/lib/versions/core.ts");
    expect(core).toMatch(/^import "server-only";/m);
    expect(core).toMatch(/from "@\/lib\/supabase\/admin"/);
    const action = source("src/lib/versions/actions.ts");
    expect(action).not.toMatch(/supabase\/admin/);
  });

  it("M6-49 the client-side modules never import the secret-key client", () => {
    for (const name of ["types.ts", "messages.ts", "restore.ts"]) {
      const text = code(`src/lib/versions/${name}`);
      expect(text, name).not.toMatch(/supabase\/admin|server-only|SUPABASE_SECRET/);
    }
  });
});
