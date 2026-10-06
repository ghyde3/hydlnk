import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  SITE_BYTES_CAP,
  auditLabel,
  formatDate,
  isUuid,
  parseAuditFilter,
  stripeCustomerUrl,
} from "@/lib/admin/account-view";

/** M13-02 and M13-05, the pure half: the audit filter, the action list, the Stripe link. */

const ID = "11111111-2222-4333-8444-555555555555";

describe("AUDIT_ACTIONS", () => {
  it("is exactly the action list of the admin_audit CHECK constraint (the newest migration that sets it)", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20261013000001_admin_audit_actions.sql"),
      "utf8",
    );
    const list = /check \(action in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const fromSql = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...AUDIT_ACTIONS].sort()).toEqual([...fromSql].sort());
  });

  it("every action has a plain label, and an unknown one shows as itself", () => {
    for (const action of AUDIT_ACTIONS) expect(auditLabel(action)).not.toBe(action);
    expect(auditLabel("something_new")).toBe("something_new");
  });

  it("includes this wave's actions", () => {
    for (const action of [
      "gift_plan",
      "end_gift",
      "reserve_handle",
      "unreserve_handle",
      "recheck_domain",
      "view_draft",
      "set_announcement",
      "block_app",
      "unblock_app",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
  });
});

describe("parseAuditFilter", () => {
  it("takes a valid account id (lowercased) and a known action", () => {
    expect(
      parseAuditFilter({ account: ID.toUpperCase(), action: "view_draft", page: "3" }),
    ).toEqual({ account: ID, action: "view_draft", page: 3, badAccount: null });
  });

  it("treats an unknown action as no filter, and a malformed account as a hint, never a query", () => {
    const filter = parseAuditFilter({ account: "' or 1=1 --", action: "drop_table" });
    expect(filter.account).toBeNull();
    expect(filter.action).toBeNull();
    expect(filter.badAccount).toBe("' or 1=1 --");
  });

  it("clamps the page and the typed account length", () => {
    expect(parseAuditFilter({ page: "0" }).page).toBe(1);
    expect(parseAuditFilter({ page: "-4" }).page).toBe(1);
    expect(parseAuditFilter({ page: "1.5" }).page).toBe(1);
    expect(parseAuditFilter({ page: "999999" }).page).toBe(1);
    expect(parseAuditFilter({ account: "x".repeat(500) }).badAccount).toHaveLength(100);
    expect(parseAuditFilter({}).page).toBe(1);
    expect(AUDIT_PAGE_SIZE).toBe(50);
  });

  it("reads the first value of a repeated parameter", () => {
    expect(parseAuditFilter({ action: ["suspend", "unsuspend"] }).action).toBe("suspend");
  });
});

describe("stripeCustomerUrl", () => {
  it("builds the live dashboard link from the stored id alone", () => {
    expect(stripeCustomerUrl("cus_Abc123")).toBe(
      "https://dashboard.stripe.com/customers/cus_Abc123",
    );
  });
  it("is null for nothing or for anything that is not a customer id", () => {
    expect(stripeCustomerUrl(null)).toBeNull();
    expect(stripeCustomerUrl("")).toBeNull();
    expect(stripeCustomerUrl("cus_x/../evil")).toBeNull();
    expect(stripeCustomerUrl("https://evil.example/")).toBeNull();
  });
});

describe("small helpers", () => {
  it("isUuid", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
  it("formatDate is a UTC date; nothing for a bad one", () => {
    expect(formatDate("2026-10-03T23:59:00Z")).toBe("Oct 3, 2026");
    expect(formatDate(null)).toBe("");
    expect(formatDate("garbage")).toBe("");
  });
  it("the sub-page cap is 64 MiB", () => {
    expect(SITE_BYTES_CAP).toBe(64 * 1024 * 1024);
  });
});
