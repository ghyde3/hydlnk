import { describe, expect, it } from "vitest";
import {
  SUBMISSION_MESSAGES,
  formActionPath,
  formOpenPath,
  isBackHref,
  linksIn,
  neutralizeLinks,
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

describe("forms attack pass finding 4: one link rule, glued or not", () => {
  /** A small seeded generator, so a failure names a case that can be run again. */
  function seeded(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }
  const GLUE = [..."abcxyzXYZ0123456789_-.@/~+=&%#!?*:;'\"(){}[]<>|^`$éßж"];
  const LINKS = [
    "https://evil.example/login",
    "http://evil.example",
    "HTTPS://EVIL.EXAMPLE/x",
    "ftp://evil.example/file",
    "mailto:boss@evil.example",
    "www.evil.example",
    "www.evil.example/login",
    "evil.example/login",
  ];

  it("finds every kind of link after any glue character (500 seeded cases)", () => {
    const random = seeded(20261126);
    for (let i = 0; i < 500; i++) {
      const glue = Array.from(
        { length: 1 + Math.floor(random() * 3) },
        () => GLUE[Math.floor(random() * GLUE.length)]!,
      ).join("");
      const link = LINKS[Math.floor(random() * LINKS.length)]!;
      const text = `hi ${glue}${link} bye`;
      const found = linksIn(text);
      expect(found.length, text).toBeGreaterThan(0);
      expect(found.join(" ").toLowerCase(), text).toContain("evil.example");
      // The email's plain text holds none of it whole.
      expect(neutralizeLinks(text).toLowerCase(), text).not.toContain("evil.example");
    }
  });

  it("the reported bypasses: _https, xhttps and 1www are links in a name and count toward the 5", () => {
    for (const name of [
      "Eve _https://evil.example",
      "Eve xhttps://evil.example",
      "Eve 1www.evil.example",
    ]) {
      const parsed = parseSubmission("contact", false, {
        email: "eve@example.test",
        name,
        message: "hi",
      });
      expect(parsed.ok, name).toBe(false);
      if (!parsed.ok) expect(parsed.errors.name, name).toBe(SUBMISSION_MESSAGES.nameLink);
    }
    const six = Array.from({ length: 6 }, (_, i) => `x${i}https://e${i}.example`).join(" ");
    const parsed = parseSubmission("contact", false, {
      email: "eve@example.test",
      name: "Eve",
      message: six,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.message).toBe(SUBMISSION_MESSAGES.messageLinks);
  });

  it("counts mailto:, ftp:// and a bare host with a path; not a bare host without one", () => {
    expect(linksIn("mail mailto:a@b.example or ftp://c.example/x, or d.example/login.")).toEqual([
      "mailto:a@b.example",
      "ftp://c.example/x",
      "d.example/login",
    ]);
    expect(linksIn("I use Node.js and booking.com, e.g. on v1.2/3")).toEqual([]);
  });

  it("neutralizeLinks writes [.] and [:] inside each link and changes nothing else", () => {
    expect(neutralizeLinks("See https://evil.example/a.b, ok.\nwww.x.example")).toBe(
      "See https[:]//evil[.]example/a[.]b, ok.\nwww[.]x[.]example",
    );
    expect(neutralizeLinks("mailto:a@b.example")).toBe("mailto[:]a@b[.]example");
    expect(neutralizeLinks("no links: e.g. this.")).toBe("no links: e.g. this.");
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
