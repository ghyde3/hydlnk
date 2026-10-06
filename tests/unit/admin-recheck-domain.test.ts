import { describe, expect, it, vi } from "vitest";
import { recheckDomainAction } from "@/lib/admin/actions";
import { executeAdminAction } from "@/lib/admin/execute";
import type { Principal } from "@/lib/admin/principal";
import type { AdminDeps } from "@/lib/admin/types";
import { VercelApiError } from "@/lib/domains/vercel-client";
import { IDS, domainRow, harness } from "./domains-fakes";

/**
 * M13-04: Re-check now runs the cron's own verification (`verifyDomain`) for one domain and writes one
 * recheck_domain row to admin_audit. Vercel is the recording fake of the existing domain tests.
 */

const ADMIN: Principal = {
  kind: "user",
  id: "11111111-2222-4333-8444-555555555555",
  email: "admin@example.test",
  admin: true,
};
const A = "00000000-0000-4000-8000-0000000000a1";
const HOST = "links.example.test";

function setup(options: { audit?: "ok" | "fail" } = {}) {
  const h = harness({
    domains: [
      domainRow({
        id: A,
        hostname: HOST,
        page_id: IDS.proPage,
        created_at: "2026-10-01T00:00:00.000Z",
      }),
    ],
  });
  const audit: Record<string, unknown>[] = [];
  const db = new Proxy(h.admin.client as object, {
    get(target, property) {
      if (property === "from") {
        return (table: string) =>
          table === "admin_audit"
            ? {
                insert: async (row: Record<string, unknown>) => {
                  if (options.audit === "fail") return { error: { message: "boom" } };
                  audit.push(row);
                  return { error: null };
                },
              }
            : (h.admin.client as unknown as { from: (t: string) => unknown }).from(table);
      }
      return (target as Record<string | symbol, unknown>)[property];
    },
  });
  const deps = (): AdminDeps => ({
    db: db as never,
    invalidateAccount: vi.fn(async () => 0),
    invalidateHandles: vi.fn(),
    isProtectedAccount: vi.fn(async () => false),
    now: () => new Date(h.admin.state.clock),
    domainDeps: () => h.deps,
  });
  return { h, audit, deps };
}

const run = (deps: () => AdminDeps, input: unknown) =>
  executeAdminAction(recheckDomainAction, ADMIN, input, deps);

describe("M13-04 Re-check now", () => {
  it("runs the same verification as the cron: one Vercel verify request, last_checked_at moves, an audit row is written", async () => {
    const { h, audit, deps } = setup();
    const before = h.admin.state.domains[0]!.last_checked_at;
    const result = await run(deps, { id: A });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { domainId: A, hostname: HOST, checked: true, verified: false, state: "pending" },
    });
    expect(h.admin.state.domains[0]!.last_checked_at).not.toBe(before);
    expect(h.vercel.count("verify")).toBe(1);
    expect(h.admin.state.rpcLog.map((r) => r.name)).toContain("claim_domain_check");
    expect(audit).toEqual([
      expect.objectContaining({
        admin_id: ADMIN.id,
        action: "recheck_domain",
        account_id: IDS.pro,
        report_id: null,
        detail: expect.objectContaining({ hostname: HOST, checked: true, verified: false }),
      }),
    ]);
  });

  it("flips the domain to verified when Vercel says it is, and says so", async () => {
    const { h, audit, deps } = setup();
    h.vercel.state(HOST).verified = true;
    h.vercel.state(HOST).misconfigured = false;
    const result = await run(deps, { id: A });
    expect(result).toMatchObject({ ok: true, data: { verified: true, state: "verified" } });
    expect(h.admin.state.domains[0]!.status).toBe("verified");
    expect(audit[0]!.detail).toMatchObject({ verified: true });
  });

  it("a Vercel failure leaves it pending, answers the 'couldn't check' sentence and still audits the attempt", async () => {
    const { h, audit, deps } = setup();
    h.vercel.verifyError = new VercelApiError("unavailable", 500, null, "x");
    const result = await run(deps, { id: A });
    expect(result).toMatchObject({
      ok: true,
      data: {
        checked: true,
        verified: false,
        message: "We couldn’t check right now. Try again in a minute.",
      },
    });
    expect(audit).toHaveLength(1);
  });

  it("a second click inside the cooldown makes no second Vercel verify request", async () => {
    const { h, deps } = setup();
    await run(deps, { id: A });
    const second = await run(deps, { id: A });
    expect(second).toMatchObject({ ok: true, data: { checked: false } });
    expect(h.vercel.count("verify")).toBe(1);
  });

  it("an unknown domain is a 404 with no Vercel call and no audit row", async () => {
    const { h, audit, deps } = setup();
    const result = await run(deps, { id: "00000000-0000-4000-8000-0000000000ff" });
    expect(result).toMatchObject({ ok: false, status: 404, error: "not_found" });
    expect(h.vercel.calls).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("a bad id is a 400 before anything is read", async () => {
    const { h, deps } = setup();
    for (const input of [{}, null, { id: "x" }, { id: 5 }]) {
      expect(await run(deps, input)).toMatchObject({ ok: false, status: 400 });
    }
    expect(h.vercel.calls).toEqual([]);
  });

  it("a failure to write the audit row fails the action (500)", async () => {
    const { deps } = setup({ audit: "fail" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await run(deps, { id: A });
    spy.mockRestore();
    expect(result).toMatchObject({ ok: false, status: 500, error: "action_failed" });
  });
});
