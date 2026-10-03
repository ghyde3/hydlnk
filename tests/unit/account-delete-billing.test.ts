import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-34 step 1, the Stripe half of an account deletion: `cancelAccountBilling` cancels each live
 * subscription of the account's customer exactly once and never touches anything else. The Stripe
 * SDK and the account read are replaced; the same function is exercised over HTTP against the
 * Stripe stub in tests/e2e/m4/billing-delete.spec.ts and tests/e2e/m4/lifecycle-delete.spec.ts.
 */

vi.mock("server-only", () => ({}));

const readBillingAccount = vi.fn();
vi.mock("@/lib/billing/account", () => ({ readBillingAccount }));

const list = vi.fn();
const cancel = vi.fn();
vi.mock("@/lib/billing/stripe", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/billing/stripe")>("@/lib/billing/stripe");
  return {
    isMissingResource: actual.isMissingResource,
    getStripe: () => ({ subscriptions: { list, cancel } }),
  };
});

const { cancelAccountBilling } = await import("@/lib/billing/cancel");

const missing = () => Object.assign(new Error("No such resource"), { code: "resource_missing" });
const sub = (id: string, status = "active") => ({ id, status });
const account = (customer: string | null) => ({
  id: "user-1",
  plan: "pro",
  stripe_customer_id: customer,
  stripe_subscription_id: null,
  billing_interval: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  readBillingAccount.mockResolvedValue(account("cus_1"));
  cancel.mockResolvedValue({});
});

describe("M4-34 cancelAccountBilling", () => {
  it("makes no Stripe call for an account with no row or no customer id", async () => {
    readBillingAccount.mockResolvedValueOnce(null);
    expect(await cancelAccountBilling("user-1")).toBe(0);
    readBillingAccount.mockResolvedValueOnce(account(null));
    expect(await cancelAccountBilling("user-1")).toBe(0);
    expect(list).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("reads the customer from the account of the id it is given and lists only that customer", async () => {
    list.mockResolvedValue({ data: [], has_more: false });
    await cancelAccountBilling("user-1");
    expect(readBillingAccount).toHaveBeenCalledWith("user-1");
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 100 });
  });

  it("cancels each live subscription once and skips the ones that already ended", async () => {
    list.mockResolvedValue({
      data: [
        sub("sub_active"),
        sub("sub_trialing", "trialing"),
        sub("sub_past_due", "past_due"),
        sub("sub_unpaid", "unpaid"),
        sub("sub_paused", "paused"),
        sub("sub_incomplete", "incomplete"),
        sub("sub_canceled", "canceled"),
        sub("sub_expired", "incomplete_expired"),
      ],
      has_more: false,
    });
    expect(await cancelAccountBilling("user-1")).toBe(6);
    expect(cancel.mock.calls.map(([id]) => id)).toEqual([
      "sub_active",
      "sub_trialing",
      "sub_past_due",
      "sub_unpaid",
      "sub_paused",
      "sub_incomplete",
    ]);
  });

  it("follows the pagination cursor to the next page", async () => {
    list
      .mockResolvedValueOnce({ data: [sub("sub_a"), sub("sub_b")], has_more: true })
      .mockResolvedValueOnce({ data: [sub("sub_c")], has_more: false });
    expect(await cancelAccountBilling("user-1")).toBe(3);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]![0]).toMatchObject({ customer: "cus_1", starting_after: "sub_b" });
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("a customer Stripe no longer has has nothing to cancel and is not an error", async () => {
    list.mockRejectedValueOnce(missing());
    expect(await cancelAccountBilling("user-1")).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("a subscription that vanished between the list and the cancel is skipped", async () => {
    list.mockResolvedValue({ data: [sub("sub_gone"), sub("sub_live")], has_more: false });
    cancel.mockRejectedValueOnce(missing());
    expect(await cancelAccountBilling("user-1")).toBe(1);
    expect(cancel.mock.calls.map(([id]) => id)).toEqual(["sub_gone", "sub_live"]);
  });

  it("any other cancel failure throws and stops before the next subscription", async () => {
    list.mockResolvedValue({ data: [sub("sub_a"), sub("sub_b")], has_more: false });
    cancel.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "api_error" }));
    await expect(cancelAccountBilling("user-1")).rejects.toThrow("boom");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("any other list failure throws and cancels nothing", async () => {
    list.mockRejectedValueOnce(new Error("stripe is down"));
    await expect(cancelAccountBilling("user-1")).rejects.toThrow("stripe is down");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("an unreadable account throws instead of being treated as 'nothing to cancel'", async () => {
    readBillingAccount.mockRejectedValueOnce(
      new Error("Reading the billing account failed: db down"),
    );
    await expect(cancelAccountBilling("user-1")).rejects.toThrow(
      "Reading the billing account failed",
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("a retry after a partial failure cancels only what is left", async () => {
    // First run: sub_a is canceled, then Stripe fails on sub_b.
    list.mockResolvedValueOnce({ data: [sub("sub_a"), sub("sub_b")], has_more: false });
    cancel.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("blip"));
    await expect(cancelAccountBilling("user-1")).rejects.toThrow("blip");
    // Second run: Stripe now reports sub_a as canceled.
    list.mockResolvedValueOnce({ data: [sub("sub_a", "canceled"), sub("sub_b")], has_more: false });
    cancel.mockResolvedValue({});
    expect(await cancelAccountBilling("user-1")).toBe(1);
    const ids = cancel.mock.calls.map(([id]) => id);
    expect(ids.filter((id) => id === "sub_a")).toHaveLength(1);
    expect(ids.filter((id) => id === "sub_b")).toHaveLength(2);
  });
});
