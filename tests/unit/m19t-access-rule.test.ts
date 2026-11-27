import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { decide, needForEntryWrite, toSiteAccess, requireSiteAccess, requireEntryAccess, requireTermAccess } =
  await import("@/lib/access");
type AccessRow = import("@/lib/access").AccessRow;
type SiteNeed = import("@/lib/access").SiteNeed;
type AccessSource = import("@/lib/access").AccessSource;

/**
 * M19-02, M19-06, M19-13: the TypeScript side of the one access rule. `decide` is the only branch
 * logic; this file is its rule table, plus the helper's input checks (UUIDs before any query, the
 * entry's own site, fail closed on a database error).
 */

const SITE = "00000000-0000-4000-8000-0000000000b1";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const ACTOR = "00000000-0000-4000-8000-0000000000a9";

const row = (over: Partial<AccessRow>): AccessRow => ({
  site_id: SITE,
  owner_id: OWNER,
  role: "owner",
  is_owner: true,
  can_read: true,
  can_edit: true,
  can_publish: true,
  owner_plan: "studio",
  state: "active",
  ...over,
});

const owner = row({});
const suspendedOwner = row({ can_edit: false, can_publish: false, state: "suspended_self" });
const editor = row({ role: "editor", is_owner: false, can_publish: false });
const publisher = row({ role: "publisher", is_owner: false });
const paused = row({ role: "publisher", is_owner: false, can_read: false, can_edit: false, can_publish: false, state: "paused_plan" });

const NEEDS: SiteNeed[] = ["read", "edit", "publish", "owner"];

describe("M19-02 decide: the rule table", () => {
  const table: Array<[string, AccessRow | null, AccessSource, Record<SiteNeed, string>]> = [
    ["no row (stranger, missing id)", null, "editor", { read: "not_found", edit: "not_found", publish: "not_found", owner: "not_found" }],
    ["owner", owner, "editor", { read: "ok", edit: "ok", publish: "ok", owner: "ok" }],
    ["suspended owner", suspendedOwner, "editor", { read: "ok", edit: "account_suspended", publish: "account_suspended", owner: "account_suspended" }],
    ["editor", editor, "editor", { read: "ok", edit: "ok", publish: "forbidden", owner: "not_found" }],
    ["publisher", publisher, "editor", { read: "ok", edit: "ok", publish: "ok", owner: "not_found" }],
    ["paused member (plan, owner or self)", paused, "editor", { read: "not_found", edit: "not_found", publish: "not_found", owner: "not_found" }],
    // M19-13: MCP stays owner-only. A member's token gets the same not_found as a missing id.
    ["publisher over MCP", publisher, "mcp", { read: "not_found", edit: "not_found", publish: "not_found", owner: "not_found" }],
    ["editor over MCP", editor, "mcp", { read: "not_found", edit: "not_found", publish: "not_found", owner: "not_found" }],
    ["owner over MCP", owner, "mcp", { read: "ok", edit: "ok", publish: "ok", owner: "ok" }],
    ["publisher from the builder", publisher, "builder", { read: "ok", edit: "ok", publish: "ok", owner: "not_found" }],
    ["publisher from the system (schedule worker)", publisher, "system", { read: "ok", edit: "ok", publish: "ok", owner: "not_found" }],
  ];
  for (const [label, r, source, want] of table) {
    it(`M19-02 ${label}`, () => {
      for (const need of NEEDS) expect(decide(r, need, source), `${label} ${need}`).toBe(want[need]);
    });
  }

  it("M19-13 the MCP rule is pinned: no member row passes any need over MCP", () => {
    for (const r of [editor, publisher, paused])
      for (const need of NEEDS) expect(decide(r, need, "mcp")).toBe("not_found");
  });
});

describe("M19-06 needForEntryWrite", () => {
  it("M19-06 trash or delete of a live entry and any purge are publish-class; the rest edit", () => {
    expect(needForEntryWrite({ published: { title: "x" } }, "trash")).toBe("publish");
    expect(needForEntryWrite({ published: { title: "x" } }, "delete")).toBe("publish");
    expect(needForEntryWrite({ published: null }, "trash")).toBe("edit");
    expect(needForEntryWrite({ published: null }, "delete")).toBe("edit");
    expect(needForEntryWrite({ published: null }, "purge")).toBe("publish");
    expect(needForEntryWrite({ published: { title: "x" } }, "restore")).toBe("edit");
  });
});

describe("M19-06 toSiteAccess", () => {
  it("M19-06 carries the owner and the OWNER's plan, never the actor's", () => {
    const a = toSiteAccess(publisher, ACTOR);
    expect(a).toMatchObject({ siteId: SITE, actorId: ACTOR, ownerId: OWNER, role: "publisher", plan: "studio" });
    expect(toSiteAccess(row({ owner_plan: "enterprise" }), ACTOR).plan).toBe("free");
  });
});

function spyAdmin(opts: { access?: AccessRow | null; rpcError?: boolean; entry?: Record<string, unknown> | null; term?: Record<string, unknown> | null }) {
  const calls: string[] = [];
  const admin = {
    rpc: vi.fn(async (name: string) => {
      calls.push(`rpc:${name}`);
      if (opts.rpcError) return { data: null, error: { code: "XX000", message: "down" } };
      return { data: opts.access ? [opts.access] : [], error: null };
    }),
    from: vi.fn((table: string) => {
      calls.push(`from:${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "content_terms" ? (opts.term ?? null) : (opts.entry ?? null), error: null }),
      };
      return chain;
    }),
  };
  return { admin: admin as never, calls };
}

describe("M19-06 requireSiteAccess / requireEntryAccess / requireTermAccess", () => {
  it("M19-06 a non-UUID site or actor is not_found before any query", async () => {
    const { admin, calls } = spyAdmin({ access: owner });
    expect(await requireSiteAccess(admin, { actorId: ACTOR, siteId: "x", need: "read", source: "editor" })).toEqual({ ok: false, reason: "not_found" });
    expect(await requireSiteAccess(admin, { actorId: "x", siteId: SITE, need: "read", source: "editor" })).toEqual({ ok: false, reason: "not_found" });
    expect(await requireEntryAccess(admin, { actorId: ACTOR, entryId: 7, need: "read", source: "editor" })).toEqual({ ok: false, reason: "not_found" });
    expect(calls).toEqual([]);
  });

  it("M19-06 a database error fails closed", async () => {
    const { admin } = spyAdmin({ rpcError: true });
    expect(await requireSiteAccess(admin, { actorId: ACTOR, siteId: SITE, need: "read", source: "editor" })).toEqual({ ok: false, reason: "error" });
  });

  it("M19-06 an editor's publish is forbidden; the publisher's passes with the owner's id", async () => {
    expect(await requireSiteAccess(spyAdmin({ access: editor }).admin, { actorId: ACTOR, siteId: SITE, need: "publish", source: "editor" })).toEqual({ ok: false, reason: "forbidden" });
    const ok = await requireSiteAccess(spyAdmin({ access: publisher }).admin, { actorId: ACTOR, siteId: SITE, need: "publish", source: "editor" });
    expect(ok.ok && ok.access.ownerId).toBe(OWNER);
  });

  it("M19-06 the entry's own site decides; a different URL site is not_found (T5)", async () => {
    const entry = { id: "00000000-0000-4000-8000-0000000000e1", site_id: SITE, published: null };
    const { admin, calls } = spyAdmin({ access: editor, entry });
    const ok = await requireEntryAccess(admin, { actorId: ACTOR, entryId: entry.id, need: "edit", source: "editor", siteId: SITE });
    expect(ok.ok).toBe(true);
    expect(calls).toEqual(["from:content_entries", "rpc:site_access"]);
    const other = await requireEntryAccess(spyAdmin({ access: editor, entry }).admin, {
      actorId: ACTOR, entryId: entry.id, need: "edit", source: "editor", siteId: "00000000-0000-4000-8000-0000000000b2",
    });
    expect(other).toEqual({ ok: false, reason: "not_found" });
    const term = { id: "00000000-0000-4000-8000-0000000000c1", site_id: SITE };
    expect(await requireTermAccess(spyAdmin({ access: editor, term }).admin, {
      actorId: ACTOR, termId: term.id, need: "publish", source: "editor",
    })).toEqual({ ok: false, reason: "forbidden" });
    expect(await requireTermAccess(spyAdmin({ access: publisher, term }).admin, {
      actorId: ACTOR, termId: term.id, need: "edit", source: "editor", siteId: "00000000-0000-4000-8000-0000000000b2",
    })).toEqual({ ok: false, reason: "not_found" });
  });
});
