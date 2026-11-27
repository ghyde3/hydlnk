import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmissionRow } from "@/lib/forms/contract";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rateLimit: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@/lib/pages/context", () => ({ getAppContext: mocks.context }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/forms/audience", () => ({ loadAudienceExport: mocks.load }));

const route = await import("@/app/(editor)/app/(screens)/audience/export/route");
const { audienceCsv, audienceFilename, formLabel } = await import("@/lib/forms/export");
const { parseFormFilter } = await import("@/lib/forms/contract");

/**
 * M17-09: the Audience export. The cells (formulas open as text, a comma, a quote and a line break
 * round-trip), the header and line ends, the file name, and the route's refusals: signed out 401,
 * a bad `form` 400, the 21st in a minute 429, any other method 405, and no id from the request.
 */

const SITE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const row = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  site_id: SITE,
  entry_id: null,
  block_id: "formCont01",
  kind: "contact",
  email: "vera@example.test",
  name: "Vera",
  message: "Hello",
  created_at: "2026-11-26T10:00:00.000Z",
  ...over,
});
const labels = new Map([["formCont01", formLabel({ heading: "", kind: "contact" }, "Home")]]);

/** A small RFC 4180 reader for the round-trip check. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

describe("M17-09 the CSV", () => {
  it("starts with a byte order mark, uses CRLF, the header and one row per submission, newest first as given", () => {
    const text = audienceCsv(
      [row(), row({ id: "2", block_id: "gone-form1", kind: "signup", name: "", message: "" })],
      labels,
    );
    expect(text.startsWith("﻿submitted_at,form,kind,email,name,message\r\n")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    const rows = parseCsv(text.slice(1));
    expect(rows[1]).toEqual([
      "2026-11-26T10:00:00.000Z",
      "Contact form · Home",
      "contact",
      "vera@example.test",
      "Vera",
      "Hello",
    ]);
    expect(rows[2]![1]).toBe("Removed form");
  });

  it("formulas open as text: =, +, -, @ and a tab at the start get an apostrophe", () => {
    const text = audienceCsv(
      [
        row({ name: '=HYPERLINK("http://evil.example","x")', message: "+1" }),
        row({ name: "-2", message: "@SUM(A1)" }),
        row({ message: "\tcmd" }),
      ],
      labels,
    );
    const rows = parseCsv(text.slice(1));
    expect(rows[1]![4]).toBe(`'=HYPERLINK("http://evil.example","x")`);
    expect(rows[1]![5]).toBe("'+1");
    expect(rows[2]![4]).toBe("'-2");
    expect(rows[2]![5]).toBe("'@SUM(A1)");
    expect(rows[3]![5]).toBe("'\tcmd");
  });

  it("a formula cell that also needs quoting keeps its apostrophe inside the quotes (finding 8c)", () => {
    const name = '=HYPERLINK("http://evil.example","x")\nsecond line';
    const message = "=1+1,\r\n@SUM(A1)";
    const text = audienceCsv([row({ name, message })], labels);
    const rows = parseCsv(text.slice(1));
    expect(rows[1]![4]).toBe(`'${name}`);
    expect(rows[1]![5]).toBe(`'${message}`);
    // The raw cell starts with the quote, then the apostrophe: never a bare = after the quote.
    expect(text).toContain(`,"'=HYPERLINK(""http://evil.example"",""x"")\nsecond line",`);
  });

  it("a message with a comma, a quote and a line break round-trips", () => {
    const message = 'Hi, "there"\nsecond line';
    const rows = parseCsv(audienceCsv([row({ message })], labels).slice(1));
    expect(rows[1]![5]).toBe(message);
  });

  it("the file name is made from the handle and the UTC day", () => {
    expect(audienceFilename("mara", new Date("2026-11-26T23:59:00.000Z"))).toBe(
      "mara-audience-2026-11-26.csv",
    );
  });

  it("?form= is 'all' or a block id, nothing else", () => {
    expect(parseFormFilter(null)).toBe("all");
    expect(parseFormFilter("all")).toBe("all");
    expect(parseFormFilter("formCont01")).toBe("formCont01");
    for (const bad of ["x", "../etc", "formCont01;drop", "a".repeat(25)])
      expect(parseFormFilter(bad), bad).toBeNull();
  });
});

describe("M17-09 the route", () => {
  const get = (query = "") => new NextRequest(`http://app.localhost:3000/audience/export${query}`);
  beforeEach(() => {
    mocks.context.mockResolvedValue({
      user: { id: "user-a", email: "a@example.test" },
      current: { id: SITE, handle: "mara", access: { isOwner: true } },
    });
    mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
    mocks.load.mockResolvedValue({ rows: [row()], labels });
  });
  afterEach(() => vi.clearAllMocks());

  it("200: the CSV of the current site, as an attachment, never cached", async () => {
    const response = await route.GET(get("?form=all&site=other-site&owner=x&user=y"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="mara-audience-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.load).toHaveBeenCalledWith({ siteId: SITE, form: "all" });
    expect(await response.text()).toContain("vera@example.test");
  });

  it("one form", async () => {
    await route.GET(get("?form=formCont01"));
    expect(mocks.load).toHaveBeenCalledWith({ siteId: SITE, form: "formCont01" });
  });

  it("signed out is 401 JSON, never a redirect", async () => {
    mocks.context.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login" }),
    );
    const response = await route.GET(get());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("a bad form is 400, before the limiter", async () => {
    const response = await route.GET(get("?form=../../x"));
    expect(response.status).toBe(400);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });

  it("more than 20 a minute is 429 with Retry-After", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfter: 12 });
    const response = await route.GET(get());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(mocks.rateLimit).toHaveBeenCalledWith("audience-export:user-a", 20, 60);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("any other method is 405 with Allow: GET", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const) {
      const response = await route[method]();
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
    }
  });
});
