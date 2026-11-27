import { describe, expect, it, vi } from "vitest";
import { failure, fireAccessRefusal, mapDbError } from "@/lib/content/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));

const { runScheduleWorker, scheduleActorRefusal } = await import("@/lib/schedule/worker");
const { SITE_NOT_LIVE_MESSAGE } = await import("@/lib/publish/gate-messages");
const { SCHEDULING_PLAN_MESSAGE } = await import("@/lib/limits/messages");
const { PATH_MESSAGES } = await import("@/lib/document/path");
const { WORKER_BUDGET_MS, WORKER_MAX_ROWS } = await import("@/lib/schedule/types");

/**
 * M20-08, M20-09: the schedule worker with a spy client. Each case claims rows, fires them through
 * spy gates, and checks what it published and how it ended each row (`finish_schedule`).
 */

const NOW = Date.parse("2026-12-01T09:00:30Z");
const OWNER = "11111111-1111-4111-8111-111111111111";
const SITE = "33333333-3333-4333-8333-333333333333";

type Raw = Record<string, unknown>;
const row = (over: Raw = {}): Raw => ({
  id: `sch-${Math.random().toString(36).slice(2, 8)}`,
  claim: "claim-token",
  action: "publish",
  entry_id: "e1",
  site_id: SITE,
  owner_id: OWNER,
  created_by: OWNER,
  type_id: "t1",
  type_key: "post",
  run_at: "2026-12-01T09:00:00Z",
  snapshot: { title: "Hi" },
  attempts: 1,
  ...over,
});

function setup(
  batches: Raw[][],
  opts: {
    account?: Raw | null;
    accountError?: boolean;
    now?: () => number;
    /** What finish_schedule answers (the row's status afterwards); by default as the real one would. */
    finishStatus?: string;
  } = {},
) {
  const finished: Array<{ p_id: string; p_failed: boolean; p_code: string }> = [];
  const released: string[] = [];
  let claims = 0;
  const db = {
    rpc: vi.fn(async (name: string, args: Raw) => {
      if (name === "claim_due_schedules") return { data: batches[claims++] ?? [], error: null };
      // Wave F: the one access rule decides the creator; here the owner (OPTS.account) owns SITE.
      if (name === "site_access") {
        if (opts.accountError) return { data: null, error: { message: "down" } };
        const account = opts.account === undefined ? { plan: "pro", suspended_at: null } : opts.account;
        const active = account?.suspended_at === null;
        return {
          data:
            account && args.p_user === OWNER && args.p_site === SITE
              ? [{ site_id: SITE, owner_id: OWNER, role: "owner", is_owner: true, can_read: true,
                  can_edit: active, can_publish: active, owner_plan: account.plan,
                  state: active ? "active" : "suspended_self" }]
              : [],
          error: null,
        };
      }
      if (name === "finish_schedule") {
        finished.push(args as never);
        return { data: opts.finishStatus ?? (args.p_failed ? "failed" : "pending"), error: null };
      }
      if (name === "release_schedule_claim") {
        released.push(String(args.p_id));
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    }),
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          opts.accountError
            ? { data: null, error: { message: "down" } }
            : {
                data:
                  opts.account === undefined ? { plan: "pro", suspended_at: null } : opts.account,
                error: null,
              },
      };
      return chain;
    },
  };
  const place = { siteId: SITE, typeId: "t1", typeKey: "post" };
  const deps = {
    db: db as never,
    now: opts.now ?? (() => NOW),
    publishPost: vi.fn(async () => ({ ok: true as const, ...place })),
    publishPage: vi.fn(async () => ({
      ok: true as const,
      publishedAt: "x",
      rev: 2,
      unchanged: false,
    })),
    unpublish: vi.fn(async () => ({ ok: true as const, changed: true, ...place })),
    expire: vi.fn(async (...args: [unknown, unknown]) => args.length > 0),
  };
  return { deps, finished, released, db, place };
}

describe("M20-08 the worker publishes due snapshots through the gate", () => {
  it("M20-08 a due post is published as the owner with source system, then its cache expires", async () => {
    const { deps, finished, place } = setup([[row({ id: "a" })]]);
    const out = await runScheduleWorker(deps);
    expect(out).toEqual({ published: 1, unpublished: 0, failed: 0, retried: 0, expiryFailed: 0 });
    expect(deps.publishPost).toHaveBeenCalledWith(
      { actor: { userId: OWNER, source: "system" }, entryId: "e1" },
      { kind: "fire", scheduleId: "a", claim: "claim-token", snapshot: { title: "Hi" } },
    );
    expect(deps.expire).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", entryId: "e1" }),
      place,
    );
    expect(finished).toEqual([]); // the fire marked it done in its own transaction
  });

  it("M20-08 a page goes through the Publish page gate and expires the site", async () => {
    const { deps } = setup([[row({ type_key: "page" })]]);
    await runScheduleWorker(deps);
    expect(deps.publishPage).toHaveBeenCalledWith(
      { siteId: SITE, entryId: "e1", userId: OWNER },
      expect.objectContaining({ kind: "fire" }),
    );
    expect(deps.expire).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "e1", ownerId: OWNER }),
      { siteId: SITE, typeId: "t1", typeKey: "page" },
    );
  });

  it("M20-08 the owner is suspended at fire: failed account_suspended, nothing published", async () => {
    const { deps, finished } = setup([[row({ id: "a" })]], {
      account: { plan: "pro", suspended_at: "2026-11-30T00:00:00Z" },
    });
    expect((await runScheduleWorker(deps)).failed).toBe(1);
    expect(deps.publishPost).not.toHaveBeenCalled();
    expect(finished).toEqual([
      expect.objectContaining({ p_id: "a", p_failed: true, p_code: "account_suspended" }),
    ]);
  });

  it("M20-08 the plan no longer includes scheduling: failed plan", async () => {
    const { deps, finished } = setup([[row()]], { account: { plan: "free", suspended_at: null } });
    await runScheduleWorker(deps);
    expect(deps.publishPost).not.toHaveBeenCalled();
    expect(finished[0]).toMatchObject({ p_failed: true, p_code: "plan" });
  });

  it("M20-08 a row scheduled by someone who may not publish the site never fires (the one actor check)", async () => {
    const { deps, finished } = setup([[row({ created_by: "22222222-2222-4222-8222-222222222222" })]]);
    await runScheduleWorker(deps);
    expect(deps.publishPost).not.toHaveBeenCalled();
    // Wave F: the creator is asked through the access rule; one with no publish access is access_lost.
    expect(finished[0]).toMatchObject({ p_failed: true, p_code: "access_lost" });
    // M19-16 step 5, directly: it publishes nothing (no post, no page, no unpublish) and expires nothing.
    expect(deps.publishPage).not.toHaveBeenCalled();
    expect(deps.unpublish).not.toHaveBeenCalled();
    expect(deps.expire).not.toHaveBeenCalled();
  });

  it("M20-08 the site's owner is no longer the row's owner: access_lost, nothing fires (S6)", async () => {
    // The creator may publish SITE (its owner is OWNER), but the claim names another owner: the
    // site changed hands after the row was claimed. The row must never publish as the old owner.
    const other = "44444444-4444-4444-8444-444444444444";
    const { deps, finished } = setup([[row({ owner_id: other })]]);
    expect(
      await scheduleActorRefusal(deps.db, {
        action: "publish",
        siteId: SITE,
        ownerId: other,
        createdBy: OWNER,
      }),
    ).toBe("access_lost");
    await runScheduleWorker(deps);
    expect(deps.publishPost).not.toHaveBeenCalled();
    expect(finished[0]).toMatchObject({ p_failed: true, p_code: "access_lost" });
  });

  it.each([
    ["access_lost", "access_lost"],
    ["account_suspended", "account_suspended"],
  ])(
    "M20-08 the fire's own creator re-check (HL022 %s) ends the row with that code, never retried (L1)",
    async (message, code) => {
      const refusal = mapDbError({ code: "HL022", message });
      expect(refusal.error).toBe(code);
      for (const typeKey of ["post", "page"]) {
        const { deps, finished } = setup([[row({ type_key: typeKey })]]);
        deps.publishPost.mockResolvedValueOnce(refusal as never);
        deps.publishPage.mockResolvedValueOnce({ ok: false, reason: code, errors: [] } as never);
        const out = await runScheduleWorker(deps);
        expect(out).toMatchObject({ published: 0, failed: 1, retried: 0 });
        expect(finished[0]).toMatchObject({ p_failed: true, p_code: code });
        expect(deps.expire).not.toHaveBeenCalled();
      }
    },
  );

  it("M20-08 fireAccessRefusal reads HL022 only", () => {
    expect(fireAccessRefusal({ code: "HL022", message: "account_suspended" })).toBe(
      "account_suspended",
    );
    expect(fireAccessRefusal({ code: "HL022", message: "access_lost" })).toBe("access_lost");
    expect(fireAccessRefusal({ code: "P0002", message: "access_lost" })).toBeNull();
  });

  it.each([
    ["a blocklisted link", failure("blocked_link"), "blocked_link"],
    ["a javascript: link (the unsafe scheme check)", failure("invalid"), "invalid"],
    ["another user's image", failure("invalid", "That image isn’t one of yours."), "invalid"],
    ["a slug taken meanwhile", failure("slug_taken"), "slug_taken"],
    ["a type turned off", failure("type_disabled"), "type_disabled"],
    ["a downgrade the database saw first (HL017)", failure("schedule_plan"), "plan"],
  ])(
    "M20-08 the snapshot now holds %s: failed with that code, never retried",
    async (_label, refusal, code) => {
      const { deps, finished } = setup([[row()]]);
      deps.publishPost.mockResolvedValueOnce(refusal as never);
      const out = await runScheduleWorker(deps);
      expect(out).toMatchObject({ published: 0, failed: 1, retried: 0 });
      expect(finished[0]).toMatchObject({ p_failed: true, p_code: code });
      expect(deps.expire).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["the site is not live", [SITE_NOT_LIVE_MESSAGE], "site_not_live"],
    ["the plan", [SCHEDULING_PLAN_MESSAGE], "plan"],
    ["a path taken meanwhile", [PATH_MESSAGES.taken], "path_taken"],
    ["something else", ["Add a link label."], "invalid"],
  ])("M20-08 a page refused because %s ends with that code", async (_label, messages, code) => {
    const { deps, finished } = setup([[row({ type_key: "page" })]]);
    deps.publishPage.mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
      errors: messages.map((message) => ({ blockId: null, field: "document", message })),
    } as never);
    await runScheduleWorker(deps);
    expect(finished[0]).toMatchObject({ p_failed: true, p_code: code });
  });

  it("M20-08 a block id clash at fire ends as block_id_clash", async () => {
    const { deps, finished } = setup([[row({ type_key: "page" })]]);
    deps.publishPage.mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
      errors: [{ blockId: "lnk-1", field: "id", message: "This block shares its id..." }],
    } as never);
    await runScheduleWorker(deps);
    expect(finished[0]).toMatchObject({ p_failed: true, p_code: "block_id_clash" });
  });

  it("M20-08 a publish more than 24 hours late: failed missed, nothing published", async () => {
    const { deps, finished } = setup([[row({ run_at: "2026-11-30T09:00:00Z" })]]);
    await runScheduleWorker(deps);
    expect(deps.publishPost).not.toHaveBeenCalled();
    expect(finished[0]).toMatchObject({ p_failed: true, p_code: "missed" });
  });

  it("M20-08 a publish 23 hours late still runs (an outage's catch-up fires once)", async () => {
    const { deps } = setup([[row({ run_at: "2026-11-30T10:00:00Z" })]]);
    expect((await runScheduleWorker(deps)).published).toBe(1);
    expect(deps.publishPost).toHaveBeenCalledTimes(1);
  });

  it("M20-08 a database error releases the lease for a retry", async () => {
    const { deps, finished } = setup([[row({ id: "a" })]]);
    deps.publishPost.mockResolvedValueOnce(failure("error") as never);
    expect((await runScheduleWorker(deps)).retried).toBe(1);
    expect(finished).toEqual([
      { p_id: "a", p_claim: "claim-token", p_failed: false, p_code: "error" },
    ]);
  });

  it("M20-08 a gate that throws, or an account read that fails, is a retry too", async () => {
    const thrown = setup([[row()]]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    thrown.deps.publishPost.mockRejectedValueOnce(new Error("network"));
    expect((await runScheduleWorker(thrown.deps)).retried).toBe(1);
    const unreadable = setup([[row()]], { accountError: true });
    expect((await runScheduleWorker(unreadable.deps)).retried).toBe(1);
    expect(unreadable.deps.publishPost).not.toHaveBeenCalled();
  });

  it("M20-08 a failed cache expiry is counted (the route answers 500); the publish stands", async () => {
    const { deps } = setup([[row()]]);
    deps.expire.mockResolvedValueOnce(false);
    expect(await runScheduleWorker(deps)).toMatchObject({ published: 1, expiryFailed: 1 });
  });

  it("M20-08 a run stops claiming after 100 rows", async () => {
    // Each claim hands out other rows (a row claimed again in the same run is not fired twice).
    const batch = (n: number) => Array.from({ length: 25 }, (_, i) => row({ id: `b${n}r${i}` }));
    const { deps, db } = setup([batch(1), batch(2), batch(3), batch(4), batch(5), batch(6)]);
    const out = await runScheduleWorker(deps);
    expect(out.published).toBe(WORKER_MAX_ROWS);
    expect(db.rpc.mock.calls.filter(([name]) => name === "claim_due_schedules")).toHaveLength(4);
  });

  it("M20-08 a run stops claiming after 40 seconds", async () => {
    let clock = NOW;
    const { deps, db } = setup([[row()], [row()], [row()]], { now: () => clock });
    deps.publishPost.mockImplementation(async () => {
      clock += WORKER_BUDGET_MS / 2 + 1;
      return { ok: true as const, siteId: SITE, typeId: "t1", typeKey: "post" };
    });
    const out = await runScheduleWorker(deps);
    expect(out.published).toBe(2);
    expect(db.rpc.mock.calls.filter(([name]) => name === "claim_due_schedules")).toHaveLength(2);
  });

  it("M20-08 the budget is checked before every row: rows claimed past it are released, not fired, no attempt spent", async () => {
    let clock = NOW;
    const { deps, finished, released } = setup(
      [[row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]],
      {
        now: () => clock,
      },
    );
    deps.publishPost.mockImplementation(async () => {
      clock += WORKER_BUDGET_MS + 1; // one slow fire spends the whole budget
      return { ok: true as const, siteId: SITE, typeId: "t1", typeKey: "post" };
    });
    const out = await runScheduleWorker(deps);
    expect(out).toMatchObject({ published: 1, retried: 0, failed: 0 });
    expect(deps.publishPost).toHaveBeenCalledTimes(1);
    expect(released).toEqual(["b", "c"]);
    expect(finished).toEqual([]);
  });

  it("M20-08 a row claimed twice in one run is fired once: the second claim is released", async () => {
    const { deps, released, db } = setup([
      [row({ id: "a" })],
      [row({ id: "a" })],
      [row({ id: "z" })],
    ]);
    deps.publishPost.mockResolvedValueOnce(failure("error") as never);
    const out = await runScheduleWorker(deps);
    expect(out).toMatchObject({ retried: 1, published: 0 });
    expect(deps.publishPost).toHaveBeenCalledTimes(1);
    expect(released).toEqual(["a"]);
    // A batch of rows it already handled ends the run: a backoff that failed never loops.
    expect(db.rpc.mock.calls.filter(([name]) => name === "claim_due_schedules")).toHaveLength(2);
  });

  it("M20-08 a fire that committed but whose answer was lost still expires the cache", async () => {
    const { deps, finished } = setup([[row({ id: "a" })]], { finishStatus: "done" });
    deps.publishPost.mockRejectedValueOnce(new Error("socket hang up"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await runScheduleWorker(deps);
    expect(finished).toEqual([expect.objectContaining({ p_id: "a", p_failed: false })]);
    expect(out).toMatchObject({ published: 1, retried: 0, expiryFailed: 0 });
    expect(deps.expire).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), {
      siteId: SITE,
      typeId: "t1",
      typeKey: "post",
    });
  });

  it("M20-08 nothing due (trashed, published by hand: the rows were canceled): nothing runs", async () => {
    const { deps } = setup([[]]);
    expect(await runScheduleWorker(deps)).toEqual({
      published: 0,
      unpublished: 0,
      failed: 0,
      retried: 0,
      expiryFailed: 0,
    });
    expect(deps.publishPost).not.toHaveBeenCalled();
  });

  it("M20-08 a claim error throws (the route answers 500)", async () => {
    const { deps, db } = setup([]);
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } } as never);
    await expect(runScheduleWorker(deps)).rejects.toThrow(/down/);
  });
});

describe("M20-09 scheduled unpublish", () => {
  it("M20-09 runs however late, takes the entry down and expires it", async () => {
    const { deps, place } = setup([
      [row({ action: "unpublish", run_at: "2026-11-01T09:00:00Z", snapshot: null })],
    ]);
    expect((await runScheduleWorker(deps)).unpublished).toBe(1);
    expect(deps.unpublish).toHaveBeenCalledTimes(1);
    expect(deps.expire).toHaveBeenCalledWith(expect.objectContaining({ entryId: "e1" }), place);
  });

  it("M20-09 an entry that is not live ends done with nothing changed and nothing expired", async () => {
    const { deps } = setup([[row({ action: "unpublish", snapshot: null })]]);
    deps.unpublish.mockResolvedValueOnce({
      ok: true,
      changed: false,
      siteId: SITE,
      typeId: "t1",
      typeKey: "post",
    });
    expect((await runScheduleWorker(deps)).unpublished).toBe(1);
    expect(deps.expire).not.toHaveBeenCalled();
  });

  it("M20-09 a downgrade does not stop a scheduled unpublish; a suspension does", async () => {
    const downgraded = setup([[row({ action: "unpublish", snapshot: null })]], {
      account: { plan: "free", suspended_at: null },
    });
    expect((await runScheduleWorker(downgraded.deps)).unpublished).toBe(1);
    expect(
      await scheduleActorRefusal(
        setup([], { account: { plan: "pro", suspended_at: "x" } }).deps.db,
        { action: "unpublish", siteId: SITE, ownerId: OWNER, createdBy: OWNER },
      ),
    ).toBe("account_suspended");
  });
});
