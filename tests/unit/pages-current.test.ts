import { describe, expect, it } from "vitest";
import { initialsOf } from "@/lib/pages/initials";
import { pickCurrentPage } from "@/lib/pages/pick";
import { PLAN_INFO, handleAddress, meterPercent, toPlan } from "@/lib/pages/plans";

const pages = [
  { id: "11111111-1111-4111-8111-111111111112", created_at: "2026-10-01T10:00:00Z" },
  { id: "11111111-1111-4111-8111-111111111111", created_at: "2026-09-30T10:00:00Z" },
  { id: "11111111-1111-4111-8111-111111111113", created_at: "2026-10-02T10:00:00Z" },
];

describe("pickCurrentPage", () => {
  it("returns the requested page when it is one of the user's own", () => {
    expect(pickCurrentPage(pages, pages[2]!.id)).toBe(pages[2]);
  });

  it("falls back to the oldest page when the cookie is missing", () => {
    expect(pickCurrentPage(pages, undefined)).toBe(pages[1]);
    expect(pickCurrentPage(pages, "")).toBe(pages[1]);
  });

  it("falls back to the oldest page for a garbage id or another user's page id", () => {
    expect(pickCurrentPage(pages, "not-a-uuid")).toBe(pages[1]);
    expect(pickCurrentPage(pages, "22222222-2222-4222-8222-222222222222")).toBe(pages[1]);
    expect(pickCurrentPage(pages, "' or 1=1 --")).toBe(pages[1]);
  });

  it("does not mutate its input", () => {
    const copy = [...pages];
    pickCurrentPage(pages, undefined);
    expect(pages).toEqual(copy);
  });

  it("needs at least one page", () => {
    expect(() => pickCurrentPage([], undefined)).toThrow();
  });
});

describe("plans", () => {
  it("knows each plan's label and page limit", () => {
    expect(PLAN_INFO.free).toEqual({ label: "Free", maxPages: 1 });
    expect(PLAN_INFO.pro).toEqual({ label: "Pro", maxPages: 3 });
    expect(PLAN_INFO.studio).toEqual({ label: "Studio", maxPages: 15 });
  });

  it("reads an unknown plan as free", () => {
    expect(toPlan("pro")).toBe("pro");
    expect(toPlan("enterprise")).toBe("free");
    expect(toPlan(null)).toBe("free");
  });

  it("derives the meter fill from usage and limit", () => {
    expect(meterPercent(1, 1)).toBe(100);
    expect(meterPercent(1, 3)).toBe(33);
    expect(meterPercent(2, 3)).toBe(67);
    expect(meterPercent(1, 15)).toBe(7);
    expect(meterPercent(0, 3)).toBe(0);
    expect(meterPercent(5, 3)).toBe(100);
    expect(meterPercent(1, 0)).toBe(100);
  });

  it("shows the product domain for a handle", () => {
    expect(handleAddress("mara")).toBe("mara.hydlnk.com");
  });
});

describe("initialsOf", () => {
  it("takes the first two letters of the local part, upper case", () => {
    expect(initialsOf("e2e-sh-1@example.com")).toBe("E2");
    expect(initialsOf("mara@example.test")).toBe("MA");
    expect(initialsOf("x@example.com")).toBe("X");
  });

  it("copes with an empty address", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("@example.com")).toBe("?");
  });
});
