import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  dismissReportAction,
  suspendAccountAction,
  unsuspendAccountAction,
} from "@/lib/admin/actions";
import { executeAdminAction } from "@/lib/admin/execute";
import type { Principal } from "@/lib/admin/principal";
import type { AdminDeps } from "@/lib/admin/types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M5-07 (suspend and unsuspend an account), M5-06 (dismiss a report) and M5-08's cache half: the
 * real admin actions with the secret-key client against the local Supabase stack. The cache calls
 * are spies (the real ones need a running Next.js; the e2e specs prove them end to end).
 */
const { run } = await stackIsUp();

const ADMIN_ID = "11111111-2222-4333-8444-555555555555";
const ADMIN: Principal = { kind: "user", id: ADMIN_ID, email: "admin@example.test", admin: true };

describe.skipIf(!run)("M5-07 / M5-06 admin actions (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];
  let reportsExist = false;

  const spies = () => ({
    invalidateAccount: vi.fn<AdminDeps["invalidateAccount"]>(async () => 1),
    invalidateHandles: vi.fn<AdminDeps["invalidateHandles"]>(() => undefined),
  });

  function depsWith(
    overrides: Partial<AdminDeps> & ReturnType<typeof spies>,
    protectedIds: string[] = [],
  ): () => AdminDeps {
    return () => ({
      db: admin as never,
      isProtectedAccount: async (id) => protectedIds.includes(id),
      now: () => new Date(),
      ...overrides,
    });
  }

  const owner = async (label: string, extraPages: string[] = []) => {
    const o = await makeOwner(admin, label);
    owners.push(o);
    if (extraPages.length > 0) {
      await admin.from("accounts").update({ paid_plan: "studio" }).eq("id", o.userId);
      for (const handle of extraPages) {
        const { error } = await admin
          .from("pages")
          .insert({ owner_id: o.userId, handle, draft: { version: 1 } });
        expect(error).toBeNull();
      }
    }
    return o;
  };

  const suspendedAt = async (id: string) =>
    (await admin.from("accounts").select("suspended_at").eq("id", id).single()).data
      ?.suspended_at as string | null;

  const auditRows = async (accountId: string) =>
    (
      await admin
        .from("admin_audit")
        .select("admin_id, action, account_id, detail")
        .eq("account_id", accountId)
        .order("id")
    ).data ?? [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const probe = await admin.from("reports").select("id").limit(1);
    reportsExist = !probe.error;
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("M5-07 suspend sets suspended_at, expires every page's cache and the handles, and writes the audit log", async () => {
    const o = await owner("sus", ["zq-sus-extra1", "zq-sus-extra2"]);
    const s = spies();
    const result = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(s),
    );
    expect(result).toMatchObject({ ok: true, status: 200, data: { changed: true, pages: 3 } });
    expect(await suspendedAt(o.userId)).not.toBeNull();
    expect(s.invalidateAccount).toHaveBeenCalledExactlyOnceWith(o.userId);
    expect(s.invalidateHandles).toHaveBeenCalledTimes(1);
    expect([...s.invalidateHandles.mock.calls[0]![0]].sort()).toEqual(
      [o.handle, "zq-sus-extra1", "zq-sus-extra2"].sort(),
    );
    const log = await auditRows(o.userId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ admin_id: ADMIN_ID, action: "suspend", account_id: o.userId });
  });

  it("M5-07 suspending twice is idempotent: no error, the first timestamp stays, one audit row, the caches are still expired", async () => {
    const o = await owner("sus2");
    const first = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(spies()),
    );
    const stamp = await suspendedAt(o.userId);
    const s = spies();
    const second = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(s),
    );
    expect(first).toMatchObject({ ok: true, data: { changed: true } });
    expect(second).toMatchObject({ ok: true, status: 200, data: { changed: false } });
    expect(await suspendedAt(o.userId)).toBe(stamp);
    expect(s.invalidateAccount).toHaveBeenCalledWith(o.userId);
    expect(await auditRows(o.userId)).toHaveLength(1);
  });

  it("M5-07 unsuspend clears suspended_at, expires the same caches, and is idempotent", async () => {
    const o = await owner("uns");
    await executeAdminAction(suspendAccountAction, ADMIN, { id: o.userId }, depsWith(spies()));
    const s = spies();
    const result = await executeAdminAction(
      unsuspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(s),
    );
    expect(result).toMatchObject({ ok: true, data: { changed: true, pages: 1 } });
    expect(await suspendedAt(o.userId)).toBeNull();
    expect(s.invalidateAccount).toHaveBeenCalledWith(o.userId);
    expect(s.invalidateHandles).toHaveBeenCalledWith([o.handle]);

    const again = await executeAdminAction(
      unsuspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(spies()),
    );
    expect(again).toMatchObject({ ok: true, status: 200, data: { changed: false } });
    expect((await auditRows(o.userId)).map((r) => r.action)).toEqual(["suspend", "unsuspend"]);
  });

  it("M5-07 an account listed as an admin is refused: 'Admins can’t be suspended.', nothing written, no cache call", async () => {
    const o = await owner("adm");
    const s = spies();
    const result = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(s, [o.userId]),
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "admin_protected",
      message: "Admins can’t be suspended.",
    });
    expect(await suspendedAt(o.userId)).toBeNull();
    expect(s.invalidateAccount).not.toHaveBeenCalled();
    expect(await auditRows(o.userId)).toHaveLength(0);
  });

  it("M5-07 an unknown account is a 404 for suspend and unsuspend", async () => {
    const id = "00000000-0000-4000-8000-0000000000fe";
    expect(
      await executeAdminAction(suspendAccountAction, ADMIN, { id }, depsWith(spies())),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      await executeAdminAction(unsuspendAccountAction, ADMIN, { id }, depsWith(spies())),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("M5-07 a failed cache call answers 500 but the suspension stays, and a retry expires the caches", async () => {
    const o = await owner("cf");
    const failing = spies();
    failing.invalidateAccount.mockRejectedValueOnce(new Error("cache down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(failing),
    );
    log.mockRestore();
    expect(first).toMatchObject({ ok: false, status: 500, error: "action_failed" });
    expect(JSON.stringify(first)).not.toContain("cache down");
    expect(await suspendedAt(o.userId)).not.toBeNull();
    // The handles were still expired although the page tags failed.
    expect(failing.invalidateHandles).toHaveBeenCalled();

    const retry = spies();
    const second = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(retry),
    );
    expect(second).toMatchObject({ ok: true, data: { changed: false } });
    expect(retry.invalidateAccount).toHaveBeenCalledWith(o.userId);
  });

  /** A db whose next `n` inserts into admin_audit fail, as a database error would. */
  const dbFailingAudit = (n: number): AdminDeps["db"] => {
    let left = n;
    return new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const builder = target.from(table);
          if (table !== "admin_audit") return builder;
          return new Proxy(builder, {
            get(inner, name, innerReceiver) {
              if (name === "insert" && left > 0) {
                left -= 1;
                return async () => ({ data: null, error: { message: "audit down" } });
              }
              return Reflect.get(inner, name, innerReceiver);
            },
          });
        };
      },
    }) as never;
  };

  it("M5-07 the audit row is written before the caches: a cache failure still leaves exactly one row, and the retry adds none", async () => {
    const o = await owner("auf");
    const failing = spies();
    failing.invalidateAccount.mockRejectedValueOnce(new Error("cache down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(failing),
    );
    log.mockRestore();
    expect(first).toMatchObject({ ok: false, status: 500 });
    expect(await auditRows(o.userId)).toHaveLength(1);
    const second = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(spies()),
    );
    expect(second).toMatchObject({ ok: true, data: { changed: false } });
    expect(await auditRows(o.userId)).toHaveLength(1);
  });

  it("M5-07 a failing audit insert fails the suspend (500, nothing leaks), and the retry, which finds the account suspended, writes the missing row once", async () => {
    const o = await owner("aud");
    const s = spies();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await executeAdminAction(suspendAccountAction, ADMIN, { id: o.userId }, () => ({
      ...depsWith(s)(),
      db: dbFailingAudit(1),
    }));
    log.mockRestore();
    expect(first).toMatchObject({ ok: false, status: 500, error: "action_failed" });
    expect(JSON.stringify(first)).not.toContain("audit down");
    expect(await suspendedAt(o.userId)).not.toBeNull();
    expect(await auditRows(o.userId)).toHaveLength(0);

    const retry = await executeAdminAction(
      suspendAccountAction,
      ADMIN,
      { id: o.userId },
      depsWith(spies()),
    );
    expect(retry).toMatchObject({ ok: true, data: { changed: false } });
    const rows = await auditRows(o.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "suspend", admin_id: ADMIN_ID });
    // A third call is a double click: no second row.
    await executeAdminAction(suspendAccountAction, ADMIN, { id: o.userId }, depsWith(spies()));
    expect(await auditRows(o.userId)).toHaveLength(1);
  });

  it("M5-07 unsuspend: the same rule (a failed audit write fails it, the retry writes the row), and unsuspending an account that was never suspended writes nothing", async () => {
    const never = await owner("aun");
    await executeAdminAction(
      unsuspendAccountAction,
      ADMIN,
      { id: never.userId },
      depsWith(spies()),
    );
    expect(await auditRows(never.userId)).toHaveLength(0);

    const o = await owner("au2");
    await executeAdminAction(suspendAccountAction, ADMIN, { id: o.userId }, depsWith(spies()));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await executeAdminAction(unsuspendAccountAction, ADMIN, { id: o.userId }, () => ({
      ...depsWith(spies())(),
      db: dbFailingAudit(1),
    }));
    log.mockRestore();
    expect(first).toMatchObject({ ok: false, status: 500 });
    expect(await suspendedAt(o.userId)).toBeNull();
    expect((await auditRows(o.userId)).map((r) => r.action)).toEqual(["suspend"]);

    await executeAdminAction(unsuspendAccountAction, ADMIN, { id: o.userId }, depsWith(spies()));
    expect((await auditRows(o.userId)).map((r) => r.action)).toEqual(["suspend", "unsuspend"]);
    await executeAdminAction(unsuspendAccountAction, ADMIN, { id: o.userId }, depsWith(spies()));
    expect(await auditRows(o.userId)).toHaveLength(2);
  });

  describe("reports (the reports table, per the Wave D contract)", () => {
    async function report(pageId: string, status = "open") {
      const { data, error } = await admin
        .from("reports")
        .insert({ page_id: pageId, reason: "spam", details: "unit test", status })
        .select("id")
        .single();
      expect(error).toBeNull();
      return data!.id as string;
    }
    const statusOf = async (id: string) =>
      (await admin.from("reports").select("status, reviewed_at, reviewed_by").eq("id", id).single())
        .data;

    it("M5-07 suspending marks the account's open reports actioned and leaves other accounts' and resolved ones alone", async (ctx) => {
      if (!reportsExist) return ctx.skip();
      const o = await owner("rep");
      const other = await owner("rep2");
      const open1 = await report(o.pageId);
      const open2 = await report(o.pageId);
      const dismissed = await report(o.pageId, "dismissed");
      const others = await report(other.pageId);

      const result = await executeAdminAction(
        suspendAccountAction,
        ADMIN,
        { id: o.userId },
        depsWith(spies()),
      );
      expect(result).toMatchObject({ ok: true, data: { changed: true, reportsActioned: 2 } });
      for (const id of [open1, open2]) {
        expect(await statusOf(id)).toMatchObject({ status: "actioned", reviewed_by: ADMIN_ID });
        expect((await statusOf(id))?.reviewed_at).not.toBeNull();
      }
      expect((await statusOf(dismissed))?.status).toBe("dismissed");
      expect((await statusOf(others))?.status).toBe("open");
    });

    it("M5-06 dismiss sets dismissed with who and when, and dismissing twice is a no-op", async (ctx) => {
      if (!reportsExist) return ctx.skip();
      const o = await owner("dis");
      const id = await report(o.pageId);
      const first = await executeAdminAction(dismissReportAction, ADMIN, { id }, depsWith(spies()));
      expect(first).toMatchObject({ ok: true, status: 200, data: { changed: true } });
      const row = await statusOf(id);
      expect(row).toMatchObject({ status: "dismissed", reviewed_by: ADMIN_ID });
      expect(row?.reviewed_at).not.toBeNull();
      const again = await executeAdminAction(dismissReportAction, ADMIN, { id }, depsWith(spies()));
      expect(again).toMatchObject({ ok: true, status: 200, data: { changed: false } });
      const rows = (await admin.from("admin_audit").select("action").eq("report_id", id)).data;
      expect(rows).toEqual([{ action: "dismiss_report" }]);
    });

    it("M5-06 a failed audit write fails the dismiss, and the retry writes the missing row once", async (ctx) => {
      if (!reportsExist) return ctx.skip();
      const o = await owner("dis3");
      const id = await report(o.pageId);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const first = await executeAdminAction(dismissReportAction, ADMIN, { id }, () => ({
        ...depsWith(spies())(),
        db: dbFailingAudit(1),
      }));
      log.mockRestore();
      expect(first).toMatchObject({ ok: false, status: 500 });
      expect((await statusOf(id))?.status).toBe("dismissed");
      const retry = await executeAdminAction(dismissReportAction, ADMIN, { id }, depsWith(spies()));
      expect(retry).toMatchObject({ ok: true, data: { changed: false } });
      await executeAdminAction(dismissReportAction, ADMIN, { id }, depsWith(spies()));
      const rows = (await admin.from("admin_audit").select("action").eq("report_id", id)).data;
      expect(rows).toEqual([{ action: "dismiss_report" }]);
    });

    it("M5-06 a report that was already actioned cannot be dismissed (409), an unknown one is 404", async (ctx) => {
      if (!reportsExist) return ctx.skip();
      const o = await owner("dis2");
      const id = await report(o.pageId, "actioned");
      expect(
        await executeAdminAction(dismissReportAction, ADMIN, { id }, depsWith(spies())),
      ).toMatchObject({
        ok: false,
        status: 409,
        error: "already_resolved",
      });
      expect((await statusOf(id))?.status).toBe("actioned");
      expect(
        await executeAdminAction(
          dismissReportAction,
          ADMIN,
          { id: "00000000-0000-4000-8000-0000000000fd" },
          depsWith(spies()),
        ),
      ).toMatchObject({ ok: false, status: 404 });
    });
  });
});
