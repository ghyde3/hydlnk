import { describe, expect, it } from "vitest";
import {
  SUBMISSION_MESSAGES,
  formActionPath,
  formOpenPath,
  isBackHref,
  linksIn,
  parseSubmission,
} from "@/lib/forms/contract";

/** M17-06 step 1: the submission rules, the links counter and the two path helpers (pure). */

const PAGE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

describe("M17-06 parseSubmission", () => {
  it("a sign-up needs a valid address and ignores a message, and a name unless it asks for one", () => {
    expect(
      parseSubmission("signup", false, { email: " ana@example.test ", name: "Ana", message: "hi" }),
    ).toEqual({
      ok: true,
      values: { email: "ana@example.test", name: "", message: "" },
    });
    expect(parseSubmission("signup", true, { email: "ana@example.test", name: " Ana " })).toEqual({
      ok: true,
      values: { email: "ana@example.test", name: "Ana", message: "" },
    });
    expect(parseSubmission("signup", true, { email: "ana@example.test" }).ok).toBe(true);
  });

  it.each([
    ["", SUBMISSION_MESSAGES.emailMissing],
    ["   ", SUBMISSION_MESSAGES.emailMissing],
    [null, SUBMISSION_MESSAGES.emailMissing],
    ["not-an-address", SUBMISSION_MESSAGES.emailInvalid],
    ["a@b", SUBMISSION_MESSAGES.emailInvalid],
    ["two@@example.test", SUBMISSION_MESSAGES.emailInvalid],
    ["x@example.test,y@example.test", SUBMISSION_MESSAGES.emailInvalid],
    [`${"a".repeat(64)}@${"b".repeat(186)}.test`, SUBMISSION_MESSAGES.emailInvalid],
  ])("the address %j: %s", (email, message) => {
    const result = parseSubmission("signup", false, { email });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBe(message);
  });

  it("a contact form needs a name of at most 80 with no link, and a message of 1 to 2,000 with at most 5 links", () => {
    const ok = { email: "bo@example.test", name: "Bo", message: "Hello" };
    expect(parseSubmission("contact", false, ok).ok).toBe(true);
    const errors = (raw: Record<string, string>) => {
      const result = parseSubmission("contact", false, { ...ok, ...raw });
      return result.ok ? {} : result.errors;
    };
    expect(errors({ name: "" })).toEqual({ name: SUBMISSION_MESSAGES.nameMissing });
    expect(errors({ name: "n".repeat(81) })).toEqual({ name: SUBMISSION_MESSAGES.nameTooLong });
    expect(errors({ name: "👍".repeat(80) })).toEqual({});
    expect(errors({ name: "Visit www.spam.example" })).toEqual({
      name: SUBMISSION_MESSAGES.nameLink,
    });
    expect(errors({ message: "" })).toEqual({ message: SUBMISSION_MESSAGES.messageMissing });
    expect(errors({ message: "m".repeat(2001) })).toEqual({
      message: SUBMISSION_MESSAGES.messageTooLong,
    });
    expect(errors({ message: "👍".repeat(2000) })).toEqual({});
    const links = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://e${i}.example/x`).join(" ");
    expect(errors({ message: links(5) })).toEqual({});
    expect(errors({ message: links(6) })).toEqual({ message: SUBMISSION_MESSAGES.messageLinks });
    expect(errors({ name: "", message: "", email: "" })).toEqual({
      email: SUBMISSION_MESSAGES.emailMissing,
      name: SUBMISSION_MESSAGES.nameMissing,
      message: SUBMISSION_MESSAGES.messageMissing,
    });
  });

  it("removes control and bidi characters; a message keeps its line feeds and CRLF becomes LF", () => {
    const result = parseSubmission("contact", false, {
      email: "bo@example.test\u0000",
      name: "B‮o\u0007",
      message: "line one\r\nline\ttwo⁦\n",
    });
    expect(result).toEqual({
      ok: true,
      values: { email: "bo@example.test", name: "Bo", message: "line one\nlinetwo" },
    });
  });

  it("always returns the cleaned values, so an error page can show them", () => {
    const result = parseSubmission("contact", false, {
      email: "nope",
      name: " Bo ",
      message: " Hi ",
    });
    expect(result).toEqual({
      ok: false,
      values: { email: "nope", name: "Bo", message: "Hi" },
      errors: { email: SUBMISSION_MESSAGES.emailInvalid },
    });
  });
});

describe("M17-06 linksIn", () => {
  it("finds http(s) links and bare www. hosts, once each, at most 50", () => {
    expect(linksIn("see https://a.example/x and www.b.example, or http://c.example")).toEqual([
      "https://a.example/x",
      "www.b.example",
      "http://c.example",
    ]);
    expect(linksIn("https://www.a.example")).toEqual(["https://www.a.example"]);
    expect(linksIn("(see https://a.example/x).")).toEqual(["https://a.example/x"]);
    expect(linksIn("no links, just example.com")).toEqual([]);
    expect(linksIn("http://x.example ".repeat(80))).toHaveLength(50);
  });
});

describe("M17-04 the path helpers", () => {
  it("the action and the open marker", () => {
    expect(formActionPath(PAGE, "formSign01")).toBe(`/f/${PAGE}/formSign01`);
    expect(formOpenPath(PAGE)).toBe(`/f/${PAGE}/o`);
  });

  it("a hostile id is encoded, never a second path or a query", () => {
    expect(formActionPath(PAGE, "../../r?x=1#y")).toBe(`/f/${PAGE}/..%2F..%2Fr%3Fx%3D1%23y`);
    expect(() => formOpenPath("../../evil")).toThrow();
    expect(() => formOpenPath(`${PAGE}/x`)).toThrow();
  });

  it("Back leads to Home or one sub-page, nowhere else", () => {
    expect(isBackHref("/")).toBe(true);
    expect(isBackHref("/about")).toBe(true);
    for (const bad of [
      "//evil.example",
      "https://evil.example",
      "/r",
      "/a/b",
      "javascript:alert(1)",
      "",
      undefined,
    ]) {
      expect(isBackHref(bad), String(bad)).toBe(false);
    }
  });
});
