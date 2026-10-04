import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeAdminAction } from "@/lib/admin/execute";
import { ANONYMOUS, type Principal } from "@/lib/admin/principal";
import type { AdminAction, AdminDeps } from "@/lib/admin/types";
import { blockDomainAction, unblockDomainAction } from "@/lib/blocklist/admin-actions";
import {
  draftsSentence,
  impactSentence,
  pageDetail,
  parseImpact,
} from "@/lib/blocklist/admin-impact";
import { loadBlockedDomains } from "@/lib/blocklist";

/**
 * M7-12: the two admin actions behind /admin/blocked-links, against an in-memory database: the state
 * change comes first and its audit row right after, a failed audit write fails the action and the
 * retry writes the missing row (never a second one), nothing touches `pages`, and every refusal is
 * decided before the database is asked anything.
 */

const ADMIN: Principal = {
  kind: "user",
  id: "11111111-2222-4333-8444-555555555555",
  email: "admin@example.test",
  admin: true,
};
const OTHER_ADMIN: Principal = { ...ADMIN, id: "99999999-2222-4333-8444-555555555555" };
const NON_ADMIN: Principal = {
  kind: "user",
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  email: "n@x.test",
  admin: false,
};

interface Row {
  [column: string]: unknown;
}

interface Fake {
  db: unknown;
  deps: () => AdminDeps;
  domains: Row[];
  audit: Row[];
  /** Every database call in order, "table.op" or "rpc.name". */
  calls: string[];
  failAudit: boolean;
  failImpact: boolean;
  /** The next insert into blocked_domains reports a unique violation (a concurrent add). */
  raceOnInsert: boolean;
  impact: Row[];
}

const get = (row: Row, column: string): unknown => {
  const path = /^(\w+)->>(\w+)$/.exec(column);
  if (path) return (row[path[1]!] as Row | undefined)?.[path[2]!];
  return row[column];
};

function fake(): Fake {
  const state: Fake = {
    db: null,
    deps: () => ({ db: state.db as never }) as never,
    domains: [],
    audit: [],
    calls: [],
    failAudit: false,
    failImpact: false,
    raceOnInsert: false,
    impact: [
      { page_id: null, handle: null, hosts: null, link_count: 0, total_pages: 0, draft_pages: 0 },
    ],
  };
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 3, 12, 0, 0, tick++)).toISOString();
  let auditId = 0;

  function query(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let op: "select" | "insert" | "delete" = "select";
    let payload: Row | null = null;
    const sortKeys: { column: string; ascending: boolean }[] = [];
    let max = Infinity;
    const rows = () => (table === "blocked_domains" ? state.domains : state.audit);

    const run = (): { data: Row[] | null; error: { code?: string; message: string } | null } => {
      state.calls.push(`${table}.${op}`);
      if (table !== "blocked_domains" && table !== "admin_audit") {
        throw new Error(`the action touched ${table}`);
      }
      if (op === "insert") {
        if (table === "admin_audit") {
          if (state.failAudit) return { data: null, error: { message: "audit write failed" } };
          state.audit.push({ id: ++auditId, created_at: now(), ...payload });
        } else {
          if (state.raceOnInsert) return { data: null, error: { code: "23505", message: "dup" } };
          if (state.domains.some((d) => d.domain === payload!.domain)) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          state.domains.push({ created_at: now(), added_by: null, ...payload });
        }
        return { data: null, error: null };
      }
      let matched = rows().filter((row) => filters.every((f) => f(row)));
      if (op === "delete") {
        const keep = rows().filter((row) => !matched.includes(row));
        rows().splice(0, rows().length, ...keep);
        return { data: matched, error: null };
      }
      for (const key of [...sortKeys].reverse()) {
        matched = [...matched].sort((a, b) => {
          const x = String(get(a, key.column));
          const y = String(get(b, key.column));
          return (x < y ? -1 : x > y ? 1 : 0) * (key.ascending ? 1 : -1);
        });
      }
      return { data: matched.slice(0, max), error: null };
    };

    const builder = {
      select: () => builder,
      insert: (row: Row) => {
        op = "insert";
        payload = row;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => get(row, column) === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(get(row, column)));
        return builder;
      },
      gte: (column: string, value: string) => {
        filters.push((row) => String(get(row, column)) >= value);
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        sortKeys.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      limit: (n: number) => {
        max = n;
        return builder;
      },
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return builder;
  }

  state.db = {
    from: (table: string) => query(table),
    rpc: async (name: string) => {
      state.calls.push(`rpc.${name}`);
      if (state.failImpact) return { data: null, error: { message: "impact failed" } };
      return { data: state.impact, error: null };
    },
  };
  return state;
}

const block = (f: Fake, input: unknown, principal: Principal = ADMIN) =>
  executeAdminAction(blockDomainAction, principal, input, f.deps);
const unblock = (f: Fake, input: unknown, principal: Principal = ADMIN) =>
  executeAdminAction(unblockDomainAction, principal, input, f.deps);

const silently = async <T>(work: () => Promise<T>): Promise<T> => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    return await work();
  } finally {
    spy.mockRestore();
  }
};

const IMPACT_ROWS: Row[] = [
  {
    page_id: "p1",
    handle: "alpha",
    hosts: ["shop.example.test"],
    link_count: 2,
    total_pages: 3,
    draft_pages: 2,
  },
  {
    page_id: "p2",
    handle: "beta",
    hosts: ["example.test", "x.example.test"],
    link_count: 1,
    total_pages: 3,
    draft_pages: 2,
  },
  {
    page_id: "p3",
    handle: "gamma",
    hosts: ["example.test"],
    link_count: 1,
    total_pages: 3,
    draft_pages: 2,
  },
];

describe("M7-12 block_domain", () => {
  it("lists the domain, reads the impact, then writes one audit row with the admin, the domain, the reason and the counts", async () => {
    const f = fake();
    f.impact = IMPACT_ROWS;
    const result = await block(f, {
      domain: "https://www.Shop.Example.test/x",
      reason: "  spam  ",
    });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: {
        changed: true,
        domain: "shop.example.test",
        pages: 3,
        drafts: 2,
        list: [
          { handle: "alpha", hosts: ["shop.example.test"], links: 2 },
          { handle: "beta", hosts: ["example.test", "x.example.test"], links: 1 },
          { handle: "gamma", hosts: ["example.test"], links: 1 },
        ],
      },
    });
    expect(f.domains).toMatchObject([
      { domain: "shop.example.test", reason: "spam", added_by: ADMIN.id },
    ]);
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]).toMatchObject({
      admin_id: ADMIN.id,
      action: "block_domain",
      account_id: null,
      report_id: null,
      detail: { domain: "shop.example.test", reason: "spam", live_pages: 3, draft_pages: 2 },
    });
    // The state change first, the impact read, then its audit row; nothing else.
    expect(f.calls).toEqual([
      "blocked_domains.select",
      "blocked_domains.insert",
      "rpc.admin_blocked_domain_impact",
      "admin_audit.insert",
    ]);
  });

  it("answers 'No live pages' as pages 0 with the draft count kept", async () => {
    const f = fake();
    f.impact = [
      { page_id: null, handle: null, hosts: null, link_count: 0, total_pages: 0, draft_pages: 4 },
    ];
    const result = await block(f, { domain: "example.test", reason: "spam" });
    expect(result).toMatchObject({
      ok: true,
      data: { changed: true, pages: 0, drafts: 4, list: [] },
    });
  });

  it("caps the list at 100 rows and keeps the true total", async () => {
    const f = fake();
    f.impact = Array.from({ length: 120 }, (_, i) => ({
      page_id: `p${i}`,
      handle: `h${i}`,
      hosts: ["example.test"],
      link_count: 1,
      total_pages: 140,
      draft_pages: 0,
    }));
    const result = await block(f, { domain: "example.test", reason: "spam" });
    expect(result.ok && (result.data.list as unknown[]).length).toBe(100);
    expect(result.ok && result.data.pages).toBe(140);
  });

  it("never touches pages (nothing is unpublished)", async () => {
    const f = fake();
    f.impact = IMPACT_ROWS;
    await block(f, { domain: "example.test", reason: "spam" });
    expect(f.calls.some((call) => call.startsWith("pages"))).toBe(false);
  });

  it("a domain that is already listed answers 409 already_blocked and changes nothing", async () => {
    const f = fake();
    expect(await block(f, { domain: "example.test", reason: "spam" })).toMatchObject({ ok: true });
    const before = { domains: structuredClone(f.domains), audit: structuredClone(f.audit) };
    const again = await block(f, { domain: "https://EXAMPLE.test/other", reason: "different" });
    expect(again).toEqual({
      ok: false,
      status: 409,
      error: "already_blocked",
      message: "example.test is already blocked.",
    });
    expect({ domains: f.domains, audit: f.audit }).toEqual(before);
  });

  it("a starter-list entry (no added_by) is 'already blocked' and gets no audit row", async () => {
    const f = fake();
    f.domains.push({
      domain: "grabify.link",
      reason: "ip-logger",
      created_at: "2026-10-01T00:00:00Z",
      added_by: null,
    });
    const result = await block(f, { domain: "grabify.link", reason: "again" });
    expect(result).toMatchObject({ ok: false, status: 409, error: "already_blocked" });
    expect(f.audit).toEqual([]);
  });

  it("a concurrent add (the insert hits the unique key) is the same 409", async () => {
    const f = fake();
    f.raceOnInsert = true;
    const result = await block(f, { domain: "example.test", reason: "spam" });
    expect(result).toMatchObject({ ok: false, status: 409, error: "already_blocked" });
    expect(f.audit).toEqual([]);
  });

  it("a failed audit write fails the action (500) and the retry writes the missing row once, answering changed: false", async () => {
    const f = fake();
    f.impact = IMPACT_ROWS;
    f.failAudit = true;
    const first = await silently(() => block(f, { domain: "example.test", reason: "spam" }));
    expect(first).toEqual({
      ok: false,
      status: 500,
      error: "action_failed",
      message: "That didn’t work. Try again.",
    });
    // The state was changed, with no record yet.
    expect(f.domains).toHaveLength(1);
    expect(f.audit).toHaveLength(0);

    f.failAudit = false;
    const retry = await block(f, { domain: "example.test", reason: "spam" });
    expect(retry).toMatchObject({
      ok: true,
      data: { changed: false, domain: "example.test", pages: 3 },
    });
    expect(f.audit).toHaveLength(1);
    expect(f.audit[0]).toMatchObject({
      admin_id: ADMIN.id,
      action: "block_domain",
      detail: {
        domain: "example.test",
        reason: "spam",
        live_pages: 3,
        draft_pages: 2,
        retried: true,
        retried_by: ADMIN.id,
      },
    });

    // And once the row exists, the next call is a plain duplicate: no second row.
    const third = await block(f, { domain: "example.test", reason: "spam" });
    expect(third).toMatchObject({ ok: false, status: 409 });
    expect(f.audit).toHaveLength(1);
  });

  it("a failed impact read after the insert is healed the same way", async () => {
    const f = fake();
    f.failImpact = true;
    const first = await silently(() => block(f, { domain: "example.test", reason: "spam" }));
    expect(first).toMatchObject({ ok: false, status: 500 });
    expect(f.domains).toHaveLength(1);
    expect(f.audit).toHaveLength(0);
    f.failImpact = false;
    const retry = await block(f, { domain: "example.test", reason: "spam" });
    expect(retry).toMatchObject({ ok: true, data: { changed: false } });
    expect(f.audit).toHaveLength(1);
  });

  it("another admin's retry records the admin who made the change", async () => {
    const f = fake();
    f.failAudit = true;
    await silently(() => block(f, { domain: "example.test", reason: "spam" }));
    f.failAudit = false;
    const retry = await block(f, { domain: "example.test", reason: "spam" }, OTHER_ADMIN);
    expect(retry).toMatchObject({ ok: true, data: { changed: false } });
    // The row is the original adder's, and the admin whose request wrote it is in the detail
    // (Wave I review: the trail says who did what, as the unblock retry's does).
    expect(f.audit[0]).toMatchObject({
      admin_id: ADMIN.id,
      detail: { retried: true, retried_by: OTHER_ADMIN.id },
    });
  });

  it("refuses bad input with a 400 and its sentence before the database is asked anything", async () => {
    const cases: [unknown, string][] = [
      [{ domain: "", reason: "spam" }, "Enter a domain, such as example.com."],
      [{ reason: "spam" }, "Enter a domain, such as example.com."],
      [{ domain: "https://", reason: "spam" }, "Enter a domain, such as example.com."],
      [{ domain: "javascript:alert(1)", reason: "spam" }, "Enter a domain, such as example.com."],
      [{ domain: "has space.com", reason: "spam" }, "Enter a domain, such as example.com."],
      [
        { domain: "example.com'; drop table pages; --", reason: "spam" },
        "Enter a domain, such as example.com.",
      ],
      [{ domain: "com", reason: "spam" }, "Use the full domain, such as example.com."],
      [{ domain: "localhost", reason: "spam" }, "Use the full domain, such as example.com."],
      [{ domain: "10.0.0.1", reason: "spam" }, "IP addresses are blocked already."],
      [{ domain: `${"a".repeat(300)}.com`, reason: "spam" }, "That domain is too long."],
      [{ domain: "example.com", reason: "" }, "Add a reason so others know why."],
      [{ domain: "example.com" }, "Add a reason so others know why."],
      [{ domain: "example.com", reason: "   " }, "Add a reason so others know why."],
      [
        { domain: "example.com", reason: "x".repeat(121) },
        "Use 120 characters or fewer for the reason.",
      ],
      [{ domain: "example.com", reason: "bad\u0007bell" }, "Use plain text for the reason."],
      // Not text at all, or far too long to be a mistake: the generic sentence.
      [{ domain: "x".repeat(5000), reason: "spam" }, "That request isn’t valid."],
      [{ domain: "example.com", reason: "x".repeat(5000) }, "That request isn’t valid."],
      [{ domain: 5, reason: "spam" }, "That request isn’t valid."],
      [{ domain: ["example.com"], reason: "spam" }, "That request isn’t valid."],
      [null, "That request isn’t valid."],
      ["example.com", "That request isn’t valid."],
    ];
    for (const [input, message] of cases) {
      const f = fake();
      const result = await block(f, input);
      expect(result, JSON.stringify(input).slice(0, 80)).toEqual({
        ok: false,
        status: 400,
        error: "invalid_input",
        message,
      });
      expect(f.calls, JSON.stringify(input).slice(0, 80)).toEqual([]);
    }
  });

  it("stores the reason as plain text: markup stays characters", async () => {
    const f = fake();
    await block(f, { domain: "example.test", reason: "<script>alert(1)</script>" });
    expect(f.domains[0]).toMatchObject({ reason: "<script>alert(1)</script>" });
    expect(f.audit[0]).toMatchObject({ detail: { reason: "<script>alert(1)</script>" } });
  });

  it("reads only its own body: an id or an added_by in the body is ignored", async () => {
    const f = fake();
    await block(f, {
      domain: "example.test",
      reason: "spam",
      id: "00000000-0000-4000-8000-000000000001",
      added_by: "00000000-0000-4000-8000-000000000002",
      admin_id: "00000000-0000-4000-8000-000000000003",
    });
    expect(f.domains[0]).toMatchObject({ added_by: ADMIN.id });
    expect(f.audit[0]).toMatchObject({ admin_id: ADMIN.id });
  });
});

describe("M7-12 unblock_domain", () => {
  async function listed(f: Fake, domain = "example.test", reason = "spam") {
    await block(f, { domain, reason });
  }

  it("deletes the entry, answers changed: true and writes one audit row with the domain and the removed reason", async () => {
    const f = fake();
    await listed(f);
    f.calls.length = 0;
    const result = await unblock(f, { domain: "example.test" });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { changed: true, domain: "example.test" },
    });
    expect(f.domains).toEqual([]);
    expect(f.audit).toHaveLength(2);
    expect(f.audit[1]).toMatchObject({
      admin_id: ADMIN.id,
      action: "unblock_domain",
      account_id: null,
      report_id: null,
      detail: { domain: "example.test", reason: "spam" },
    });
    expect(f.calls).toEqual(["blocked_domains.delete", "admin_audit.insert"]);
  });

  it("a second call answers changed: false and writes no second row", async () => {
    const f = fake();
    await listed(f);
    await unblock(f, { domain: "example.test" });
    const second = await unblock(f, { domain: "example.test" });
    expect(second).toMatchObject({ ok: true, status: 200, data: { changed: false } });
    expect(f.audit.filter((row) => row.action === "unblock_domain")).toHaveLength(1);
  });

  it("a domain that was never listed answers 200 with changed: false and writes nothing", async () => {
    const f = fake();
    const result = await unblock(f, { domain: "never.example.test" });
    expect(result).toMatchObject({ ok: true, status: 200, data: { changed: false } });
    expect(f.audit).toEqual([]);
  });

  it("removes a starter-list entry like any other, with its own audit row", async () => {
    const f = fake();
    f.domains.push({
      domain: "grabify.link",
      reason: "ip-logger",
      created_at: "2026-10-01T00:00:00Z",
      added_by: null,
    });
    const result = await unblock(f, { domain: "Grabify.Link" });
    expect(result).toMatchObject({ ok: true, data: { changed: true } });
    expect(f.audit[0]).toMatchObject({
      action: "unblock_domain",
      detail: { domain: "grabify.link", reason: "ip-logger" },
    });
  });

  it("a failed audit write fails the action (500); the retry writes the missing row once", async () => {
    const f = fake();
    await listed(f);
    f.failAudit = true;
    const first = await silently(() => unblock(f, { domain: "example.test" }));
    expect(first).toMatchObject({
      ok: false,
      status: 500,
      message: "That didn’t work. Try again.",
    });
    expect(f.domains).toEqual([]);
    f.failAudit = false;
    const retry = await unblock(f, { domain: "example.test" });
    expect(retry).toMatchObject({ ok: true, data: { changed: false } });
    expect(f.audit.filter((row) => row.action === "unblock_domain")).toHaveLength(1);
    expect(f.audit[1]).toMatchObject({
      detail: { domain: "example.test", reason: "spam", retried: true },
    });
    // And it stays at one.
    await unblock(f, { domain: "example.test" });
    expect(f.audit.filter((row) => row.action === "unblock_domain")).toHaveLength(1);
  });

  it("a block, a remove and a block again leave an audit row for each step and 409 only while listed", async () => {
    const f = fake();
    await listed(f);
    await unblock(f, { domain: "example.test" });
    const again = await block(f, { domain: "example.test", reason: "back" });
    expect(again).toMatchObject({ ok: true, data: { changed: true } });
    expect(f.audit.map((row) => row.action)).toEqual([
      "block_domain",
      "unblock_domain",
      "block_domain",
    ]);
    expect(await block(f, { domain: "example.test", reason: "x" })).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("reads only the domain: anything else in the input is ignored, and a bad domain is a 400 before the database", async () => {
    const f = fake();
    await listed(f, "keep.example.test");
    f.calls.length = 0;
    const result = await unblock(f, { domain: "other.example.test", id: "keep.example.test" });
    expect(result).toMatchObject({ ok: true, data: { changed: false } });
    expect(f.domains).toHaveLength(1);

    for (const input of [
      {},
      null,
      "x",
      { domain: 5 },
      { domain: "" },
      { domain: "https://keep.example.test" },
      { domain: "a b" },
      { domain: "x".repeat(5000) },
      { domain: "'; delete from blocked_domains; --" },
    ]) {
      const g = fake();
      const bad = await unblock(g, input);
      expect(bad, JSON.stringify(input)?.slice(0, 60)).toEqual({
        ok: false,
        status: 400,
        error: "invalid_input",
        message: "That request isn’t valid.",
      });
      expect(g.calls).toEqual([]);
    }
  });
});

describe("M7-12 both actions are guarded like every admin mutation", () => {
  const ACTIONS: [string, AdminAction][] = [
    ["block_domain", blockDomainAction],
    ["unblock_domain", unblockDomainAction],
  ];
  const VALID: Record<string, unknown> = {
    block_domain: { domain: "example.test", reason: "spam" },
    unblock_domain: { domain: "example.test" },
  };

  it.each(ACTIONS)(
    "%s: nobody signed in gets 401 and a non-admin 403, with no database built",
    async (name, action) => {
      for (const [principal, status] of [
        [ANONYMOUS, 401],
        [NON_ADMIN, 403],
      ] as const) {
        const f = fake();
        const makeDeps = vi.fn(f.deps);
        const result = await executeAdminAction(action, principal, VALID[name], makeDeps);
        expect(result).toMatchObject({ ok: false, status });
        expect(makeDeps).not.toHaveBeenCalled();
        expect(f.calls).toEqual([]);
      }
    },
  );

  it("their names are the audit actions", () => {
    expect(blockDomainAction.name).toBe("block_domain");
    expect(unblockDomainAction.name).toBe("unblock_domain");
  });

  it("the action file imports nothing from the admin library but its types", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/blocklist/admin-actions.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.filter((spec) => spec!.startsWith("@/lib/admin"))).toEqual([
      "@/lib/admin/types",
    ]);
  });
});

describe("M7-12 the impact answer", () => {
  it("reads the rows, skips the 'none' row and keeps the draft count", () => {
    expect(parseImpact(IMPACT_ROWS)).toEqual({
      pages: 3,
      drafts: 2,
      list: [
        { handle: "alpha", hosts: ["shop.example.test"], links: 2 },
        { handle: "beta", hosts: ["example.test", "x.example.test"], links: 1 },
        { handle: "gamma", hosts: ["example.test"], links: 1 },
      ],
    });
    expect(
      parseImpact([
        { page_id: null, handle: null, hosts: null, link_count: 0, total_pages: 0, draft_pages: 7 },
      ]),
    ).toEqual({ pages: 0, drafts: 7, list: [] });
    // PostgREST can send a bigint as a string.
    expect(
      parseImpact([
        {
          page_id: null,
          handle: null,
          hosts: null,
          link_count: 0,
          total_pages: "0",
          draft_pages: "2",
        },
      ]),
    ).toMatchObject({ drafts: 2 });
  });

  it("an unreadable answer throws, so it is never shown as 'no live pages'", () => {
    expect(() => parseImpact(null)).toThrow();
    expect(() => parseImpact({})).toThrow();
    expect(() => parseImpact([{ nope: true }])).toThrow();
  });

  it("writes the sentences the screen shows", () => {
    expect(impactSentence(0)).toBe("No live pages link to it.");
    expect(impactSentence(1)).toBe("1 live page already links to it.");
    expect(impactSentence(3)).toBe("3 live pages already link to it.");
    expect(draftsSentence(0)).toBeNull();
    expect(draftsSentence(2)).toBe(
      "2 drafts also link to it. Their owners will see Not saved until they change the link.",
    );
    expect(pageDetail({ handle: "x", hosts: ["shop.example.test"], links: 2 })).toBe(
      "shop.example.test · 2 links",
    );
    expect(pageDetail({ handle: "x", hosts: ["a.test", "b.test"], links: 1 })).toBe(
      "a.test, b.test · 1 link",
    );
  });
});

describe("M7-12 an add or a remove takes effect at once: the Publish gate reads the table every time", () => {
  it("loadBlockedDomains has no cache: two reads see two different tables", async () => {
    let table = [{ domain: "a.example.test" }];
    const reader = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async () => ({ data: table, error: null }),
          }),
        }),
      }),
    };
    expect(await loadBlockedDomains(reader)).toEqual(["a.example.test"]);
    table = [{ domain: "a.example.test" }, { domain: "b.example.test" }];
    expect(await loadBlockedDomains(reader)).toEqual(["a.example.test", "b.example.test"]);
    table = [];
    expect(await loadBlockedDomains(reader)).toEqual([]);
  });

  it("no module-level state in the blocklist reader, and Publish asks for the list inside every publish", () => {
    const published = readFileSync(
      resolve(process.cwd(), "src/lib/blocklist/published.ts"),
      "utf8",
    );
    // No `let`, `new Map`, `new Set`, `unstable_cache` or `cache(` at module level of the reader.
    expect(published).not.toMatch(/^(?:let|var)\s/m);
    expect(published).not.toMatch(/new (?:Map|WeakMap)\(/);
    expect(published).not.toMatch(/unstable_cache|use cache|React\.cache|\bcache\(/);

    const core = readFileSync(resolve(process.cwd(), "src/lib/publish/core.ts"), "utf8");
    const call = core.indexOf("loadBlockedDomains(admin)");
    expect(call).toBeGreaterThan(-1);
    // It sits inside a function body (indented), not at module level.
    const lineStart = core.lastIndexOf("\n", call) + 1;
    expect(core.slice(lineStart, call)).toMatch(/^\s{2,}/);
    expect(core).not.toMatch(/^(?:const|let)\s+\w+\s*=\s*(?:await\s+)?loadBlockedDomains/m);
  });
});
