import { describe, expect, it, vi } from "vitest";
import "./support/mcp-fakes";

vi.mock("server-only", () => ({}));
// The suspension sentence lives next to code that reads the server environment at import.
vi.mock("@/lib/env/server", () => ({ serverEnv: new Proxy({}, { get: () => "x" }) }));

const { contentFailure } = await import("@/lib/mcp/content-failure");
const { MESSAGES, TOOL_ERROR_CODES } = await import("@/lib/mcp/errors");
const { postLimitMessage, TERM_LIMIT_MESSAGE } = await import("@/lib/limits/messages");
import type { ContentErrorCode, ContentFailure } from "@/lib/content";

/**
 * M18 (plan 3.6): a refusal of the content writer as a tool failure. One table for every content
 * tool; a conflict carries no rev, and an unexpected failure never carries the writer's text.
 */

const fail = (error: ContentErrorCode, more: Partial<ContentFailure> = {}): ContentFailure => ({
  ok: false,
  status: 400,
  error,
  message: `WRITER-TEXT-${error}`,
  ...more,
});

describe("contentFailure", () => {
  it("maps every writer code to a pinned tool code", () => {
    const table: Record<ContentErrorCode, string> = {
      not_found: "not_found",
      // A member's refusal reads as a missing id (MCP is owner-only, M19-13).
      forbidden: "not_found",
      // Only a scheduled fire's creator re-check raises it (HL022); it reads like a missing id.
      access_lost: "not_found",
      conflict: "conflict",
      account_suspended: "account_suspended",
      type_disabled: "type_disabled",
      invalid: "invalid_input",
      blocked_link: "blocked_link",
      storage_full: "too_large",
      entry_limit: "plan_required",
      type_limit: "server_error",
      term_limit: "limit_reached",
      page_limit: "plan_required",
      path_taken: "invalid_input",
      slug_taken: "invalid_input",
      slug_reserved: "invalid_input",
      too_large: "too_large",
      // No content tool schedules (Wave E is the app's), so these are never expected here.
      schedule_plan: "server_error",
      schedule_limit: "server_error",
      schedule_time: "server_error",
      // The team activity limit: a retry time, as every other rate limit of the connector.
      rate_limited: "rate_limited",
      error: "server_error",
    };
    for (const [code, expected] of Object.entries(table)) {
      const out = contentFailure(fail(code as ContentErrorCode));
      expect(out.code, code).toBe(expected);
      expect(TOOL_ERROR_CODES).toContain(out.code);
    }
    expect(TOOL_ERROR_CODES).toHaveLength(18);
    expect(TOOL_ERROR_CODES).toContain("type_disabled");
    expect(TOOL_ERROR_CODES).toContain("limit_reached");
  });

  it("a conflict has the one sentence and no rev to retry with", () => {
    const out = contentFailure(fail("conflict", { currentRev: 41 }));
    expect(out.message).toBe(
      "This changed while I was working on it. Call get_entry again and redo the change.",
    );
    expect(JSON.stringify({ message: out.message, extras: out.extras })).not.toContain("41");
    expect(out.extras).toEqual({});
    // A page is read again with get_page.
    expect(contentFailure(fail("conflict"), { conflictMessage: MESSAGES.conflict }).message).toBe(
      MESSAGES.conflict,
    );
  });

  it("not_found is the entry sentence unless the tool names its own", () => {
    expect(contentFailure(fail("not_found")).message).toBe(
      "We couldn’t find that. Call list_entries to see your posts, or list_pages for pages.",
    );
    expect(
      contentFailure(fail("not_found"), { notFoundMessage: MESSAGES.term_not_found }).message,
    ).toBe(MESSAGES.term_not_found);
  });

  it("a blog that is off says how to turn it on", () => {
    expect(contentFailure(fail("type_disabled")).message).toBe(
      "The blog is off for this site. Turn it on with update_content_type or in the app.",
    );
  });

  it("an unexpected failure is our sentence, never the writer's text", () => {
    for (const code of ["error", "type_limit"] as const) {
      const out = contentFailure(fail(code));
      expect(out.message).toBe(MESSAGES.serverError);
      expect(JSON.stringify(out.extras)).not.toContain("WRITER-TEXT");
    }
    const unknown = contentFailure(fail("made_up" as ContentErrorCode));
    expect(unknown.code).toBe("server_error");
    expect(unknown.message).toBe(MESSAGES.serverError);
  });

  it("invalid carries the issues, bounded: at most 10, paths and messages cut", () => {
    const issues = Array.from({ length: 14 }, (_, index) => ({
      path: `body${"x".repeat(200)}`,
      message: `${index} ${"m".repeat(400)}`,
    }));
    const out = contentFailure(fail("invalid", { issues }));
    expect(out.code).toBe("invalid_input");
    expect(out.extras.issues).toHaveLength(10);
    for (const issue of out.extras.issues!) {
      expect(issue.path.length).toBeLessThanOrEqual(120);
      expect(issue.message.length).toBeLessThanOrEqual(200);
    }
    // Without issues the writer's one sentence stands, with no issue list.
    const plain = contentFailure(fail("invalid", { message: "Give the term a name." }));
    expect(plain.message).toBe("Give the term a name.");
    expect(plain.extras).toEqual({});
  });

  it("from a publish tool a content problem is publish_refused, naming what to fix", () => {
    const out = contentFailure(
      fail("invalid", {
        issues: [
          { path: "title", message: "Add a title." },
          { path: "body", message: "Use an image from your uploads." },
        ],
      }),
      { publish: true },
    );
    expect(out.code).toBe("publish_refused");
    expect(out.message).toBe("Publishing stopped. Add a title. Use an image from your uploads.");
    expect(out.extras.issues).toEqual([
      { path: "title", message: "Add a title." },
      { path: "body", message: "Use an image from your uploads." },
    ]);
  });

  it("blocked_link carries the hosts in details, bounded", () => {
    const out = contentFailure(fail("blocked_link", { hosts: ["bad.example", "worse.example"] }));
    expect(out.code).toBe("blocked_link");
    expect(out.extras.details).toEqual({ hosts: ["bad.example", "worse.example"] });
    expect(out.message).toBe(MESSAGES.blocked_link);
    const many = contentFailure(
      fail("blocked_link", {
        hosts: Array.from({ length: 50 }, (_, i) => `h${i}.${"x".repeat(300)}`),
      }),
    );
    const hosts = (many.extras.details as { hosts: string[] }).hosts;
    expect(hosts).toHaveLength(20);
    expect(hosts[0]!.length).toBeLessThanOrEqual(120);
    // A publish names the hosts in the sentence too.
    const publish = contentFailure(fail("blocked_link", { hosts: ["bad.example"] }), {
      publish: true,
    });
    expect(publish.message).toContain("bad.example");
    // No hosts (an address too long to judge): still blocked_link, with an empty list.
    expect(contentFailure(fail("blocked_link")).extras.details).toEqual({ hosts: [] });
  });

  it("the post limit is plan_required with the plan's own sentence", () => {
    expect(contentFailure(fail("entry_limit"), { plan: "free" }).message).toBe(
      postLimitMessage("free"),
    );
    expect(postLimitMessage("free")).toContain("25 posts");
    expect(contentFailure(fail("entry_limit"), { plan: "pro" }).message).toBe(
      postLimitMessage("pro"),
    );
    // Without a plan to name, a plain sentence; never the writer's.
    expect(contentFailure(fail("entry_limit")).message).toBe(MESSAGES.postLimit);
    expect(contentFailure(fail("page_limit"), { plan: "free" }).message).toBe(MESSAGES.postLimit);
  });

  it("the term cap is limit_reached; storage and size are too_large", () => {
    expect(contentFailure(fail("term_limit")).message).toBe(TERM_LIMIT_MESSAGE);
    expect(contentFailure(fail("too_large")).message).toBe(MESSAGES.entryTooLarge);
    expect(contentFailure(fail("storage_full")).code).toBe("too_large");
    expect(contentFailure(fail("storage_full")).message).not.toContain("WRITER-TEXT");
  });

  it("a slug problem is an issue on slug, a path problem an issue on archivePath", () => {
    const taken = contentFailure(fail("slug_taken", { message: "Another entry uses that slug." }));
    expect(taken.extras.issues).toEqual([
      { path: "slug", message: "Another entry uses that slug." },
    ]);
    const reserved = contentFailure(
      fail("slug_reserved", { message: "That address is reserved." }),
    );
    expect(reserved.extras.issues![0]!.path).toBe("slug");
    const term = contentFailure(fail("slug_taken"), { slugTakenMessage: "Term slug in use." });
    expect(term.message).toBe("Term slug in use.");
    const path = contentFailure(fail("path_taken", { message: "That address is already used." }));
    expect(path.code).toBe("invalid_input");
    expect(path.extras.issues).toEqual([
      { path: "archivePath", message: "That address is already used." },
    ]);
  });

  it("in a publish call, a slug taken or reserved is publish_refused with the slug issue", () => {
    for (const code of ["slug_taken", "slug_reserved"] as const) {
      const out = contentFailure(fail(code, { message: "Another entry uses that slug." }), {
        publish: true,
      });
      expect(out.code, code).toBe("publish_refused");
      expect(out.message, code).toBe("Publishing stopped. Another entry uses that slug.");
      expect(out.extras.issues, code).toEqual([
        { path: "slug", message: "Another entry uses that slug." },
      ]);
    }
  });

  it("suspension has the one sentence of the rest of the connector", async () => {
    const { ACCOUNT_SUSPENDED_MESSAGE } = await import("@/lib/admin/suspension");
    expect(contentFailure(fail("account_suspended")).message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
  });
});
