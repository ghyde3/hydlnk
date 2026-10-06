import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSelectedLayoutSegment: () => "reports",
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

const listReports = vi.fn();
vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: vi.fn(async () => ({ id: "a", email: "a@x.test" })),
}));
vi.mock("@/lib/admin/queries", () => ({
  listReports: (...args: unknown[]) => listReports(...args),
}));

const { default: AdminReports } = await import("../../src/app/(editor)/app/admin/reports/page");
const { previewDetails, parseReportFilter } = await import("@/lib/admin/view");

const render = async (status?: string, page?: string) =>
  renderToStaticMarkup(
    createElement(
      "div",
      null,
      await AdminReports({
        searchParams: Promise.resolve({ ...(status ? { status } : {}), ...(page ? { page } : {}) }),
      }),
    ),
  );
const empty = { rows: [], hasMore: false };

beforeEach(() => listReports.mockReset());

describe("M5-06 the report queue page", () => {
  it("an empty queue reads 'No open reports.' (Open is the default filter)", async () => {
    listReports.mockResolvedValue(empty);
    const html = await render();
    expect(listReports).toHaveBeenCalledWith("open", 1);
    expect(html).toContain("No open reports.");
    expect(html).toContain('aria-label="Report status"');
    expect(html.indexOf(">Open<")).toBeLessThan(html.indexOf(">Resolved<"));
    expect(html.indexOf(">Resolved<")).toBeLessThan(html.indexOf(">All<"));
  });

  it("the filter comes from ?status=, and anything unknown is Open", async () => {
    listReports.mockResolvedValue(empty);
    await render("resolved");
    expect(listReports).toHaveBeenLastCalledWith("resolved", 1);
    await render("all");
    expect(listReports).toHaveBeenLastCalledWith("all", 1);
    await render("../../etc/passwd");
    expect(listReports).toHaveBeenLastCalledWith("open", 1);
    expect(parseReportFilter(["resolved", "open"])).toBe("resolved");
    expect(parseReportFilter(undefined)).toBe("open");
  });

  it("an empty Resolved or All list says 'No reports.', not 'No open reports.'", async () => {
    listReports.mockResolvedValue(empty);
    expect(await render("resolved")).toContain("No reports.");
    expect(await render("all")).not.toContain("No open reports.");
  });

  it("renders a report's text escaped, and a deleted page without a link", async () => {
    const payload = "<script>alert(1)</script>";
    listReports.mockResolvedValue({
      hasMore: false,
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          createdAt: "2026-10-01T10:05:00Z",
          reason: "spam",
          details: payload,
          reporterEmail: '"><img src=x onerror=alert(2)>',
          status: "open",
          reportCount: 3,
          pageDeleted: true,
          pageId: null,
          handle: null,
          ownerId: null,
          ownerSuspended: false,
          ownerPageCount: 0,
        },
      ],
    });
    const html = await render();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Page deleted");
    expect(html).not.toContain("Suspend owner");
    expect(html).toContain("Dismiss");
    expect(html).toContain("2026-10-01 10:05 UTC");
  });
});

describe("M5-06 the queue is paginated", () => {
  const row = (n: number) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    createdAt: "2026-10-01T10:05:00Z",
    reason: "spam",
    details: `report ${n}`,
    reporterEmail: null,
    status: "open" as const,
    reportCount: 1,
    pageDeleted: false,
    pageId: `00000000-0000-4000-8000-0000000000${n}`,
    handle: `h${n}`,
    ownerId: "00000000-0000-4000-8000-000000000999",
    ownerSuspended: false,
    ownerPageCount: 1,
  });

  it("a first page with more behind it offers Next, and no Previous", async () => {
    listReports.mockResolvedValue({ rows: [row(1)], hasMore: true });
    const html = await render();
    expect(html).toContain('href="/admin/reports?page=2"');
    expect(html).toContain(">Next<");
    expect(html).not.toContain(">Previous<");
  });

  it("?page= is read (bad values are page 1), the filter rides along, and a later page offers Previous", async () => {
    listReports.mockResolvedValue({ rows: [row(1)], hasMore: false });
    const html = await render("resolved", "3");
    expect(listReports).toHaveBeenLastCalledWith("resolved", 3);
    expect(html).toContain('href="/admin/reports?status=resolved&amp;page=2"');
    expect(html).not.toContain(">Next<");
    for (const bad of ["0", "-2", "abc", "1.5", "99999"]) {
      await render("open", bad);
      expect(listReports).toHaveBeenLastCalledWith("open", 1);
    }
  });

  it("one short page shows no pager at all", async () => {
    listReports.mockResolvedValue({ rows: [row(1)], hasMore: false });
    const html = await render();
    expect(html).not.toContain(">Next<");
    expect(html).not.toContain(">Previous<");
  });
});

describe("M5-06 details preview", () => {
  it("shows the first 120 characters, by code point, with an ellipsis only when cut", () => {
    expect(previewDetails("short")).toBe("short");
    expect(previewDetails(null)).toBe("");
    expect(previewDetails("a".repeat(120))).toBe("a".repeat(120));
    expect(previewDetails("a".repeat(121))).toBe(`${"a".repeat(120)}…`);
    // An emoji at the cut is never split in half.
    const text = `${"a".repeat(119)}😀tail`;
    expect(previewDetails(text)).toBe(`${"a".repeat(119)}😀…`);
  });
});
