import { describe, expect, it, vi } from "vitest";
import { inlinedSentryDsn, sentryBuildEnabled } from "../../src/lib/sentry/build";
import { parseSentryDsn, resolveSentryDsn, SENTRY_DSN_VARIABLE } from "@/lib/sentry/dsn";

/** M9-10: Sentry is off unless NEXT_PUBLIC_SENTRY_DSN is a usable https DSN; a bad value is ignored with one line that names the variable. */

const GOOD = "https://0123456789abcdef@o4500000000.ingest.sentry.io/4500000001";

describe("M9-10 which DSNs are usable", () => {
  it("accepts an https DSN, trimmed", () => {
    expect(parseSentryDsn(GOOD)).toBe(GOOD);
    expect(parseSentryDsn(`  ${GOOD}\n`)).toBe(GOOD);
    expect(parseSentryDsn("https://key@sentry.example.test/12")).toBe("https://key@sentry.example.test/12");
    expect(parseSentryDsn("https://key@sentry.example.test/prefix/12")).toBe("https://key@sentry.example.test/prefix/12");
  });

  it("accepts http only for a loopback host (the Playwright stub)", () => {
    expect(parseSentryDsn("http://key@127.0.0.1:12345/1")).toBe("http://key@127.0.0.1:12345/1");
    expect(parseSentryDsn("http://key@localhost:12345/1")).toBe("http://key@localhost:12345/1");
    expect(parseSentryDsn("http://key@sentry.localhost:12345/1")).toBe("http://key@sentry.localhost:12345/1");
    expect(parseSentryDsn("http://key@[::1]:12345/1")).toBe("http://key@[::1]:12345/1");
  });

  it.each([
    ["unset", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    ["not a URL", "not a dsn"],
    ["http on the internet", "http://key@o1.ingest.sentry.io/1"],
    ["http on a look-alike of localhost", "http://key@localhost.example.com/1"],
    ["no key", "https://o1.ingest.sentry.io/1"],
    ["the legacy secret half", "https://key:secret@o1.ingest.sentry.io/1"],
    ["no project id", "https://key@o1.ingest.sentry.io/"],
    ["a project id that is not a number", "https://key@o1.ingest.sentry.io/abc"],
    ["a query string", "https://key@o1.ingest.sentry.io/1?x=1"],
    ["a fragment", "https://key@o1.ingest.sentry.io/1#x"],
    ["another scheme", "ftp://key@o1.ingest.sentry.io/1"],
    ["javascript:", "javascript:alert(1)"],
    ["a data URL", "data:text/plain,hello"],
  ])("ignores %s", (_label, value) => {
    expect(parseSentryDsn(value as string | null | undefined)).toBeUndefined();
  });
});

describe("M9-10 ignoring a bad value says so once, naming the variable and never the value", () => {
  it("unset and blank are silent", () => {
    const log = vi.fn();
    expect(resolveSentryDsn(undefined, log)).toBeUndefined();
    expect(resolveSentryDsn("", log)).toBeUndefined();
    expect(resolveSentryDsn("  ", log)).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("a usable DSN is returned and nothing is logged", () => {
    const log = vi.fn();
    expect(resolveSentryDsn(GOOD, log)).toBe(GOOD);
    expect(log).not.toHaveBeenCalled();
  });

  it("a malformed one is ignored with exactly one line that names NEXT_PUBLIC_SENTRY_DSN and holds no part of the value", () => {
    for (const bad of ["http://secretkey123@o1.ingest.sentry.io/1", "secretkey123", "https://secretkey123@o1.ingest.sentry.io/"]) {
      const log = vi.fn();
      expect(resolveSentryDsn(bad, log)).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]![0]);
      expect(line).toContain("NEXT_PUBLIC_SENTRY_DSN");
      expect(line).toContain(SENTRY_DSN_VARIABLE);
      expect(line).not.toContain("secretkey123");
      expect(line).not.toContain("ingest.sentry.io");
    }
  });
});

describe("M9-10 what the build inlines and when it wraps", () => {
  it("NEXT_PUBLIC_SENTRY_DSN is inlined as the validated DSN, or as an empty string", () => {
    expect(inlinedSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: GOOD })).toBe(GOOD);
    expect(inlinedSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: "nope" })).toBe("");
    expect(inlinedSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: "http://k@o1.ingest.sentry.io/1" })).toBe("");
    expect(inlinedSentryDsn({})).toBe("");
  });

  it("the build is wrapped only when the token, the organisation and the project are all set", () => {
    const all = { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" };
    expect(sentryBuildEnabled(all)).toBe(true);
    expect(sentryBuildEnabled({})).toBe(false);
    for (const missing of Object.keys(all)) {
      const partial: Record<string, string> = { ...all };
      delete partial[missing];
      expect(sentryBuildEnabled(partial), `without ${missing}`).toBe(false);
    }
    for (const blank of Object.keys(all)) {
      expect(sentryBuildEnabled({ ...all, [blank]: "  " }), `blank ${blank}`).toBe(false);
    }
    // The DSN alone never turns the build on.
    expect(sentryBuildEnabled({ NEXT_PUBLIC_SENTRY_DSN: GOOD })).toBe(false);
  });
});
