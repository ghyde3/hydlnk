import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HANDLE_MAX_LENGTH,
  handleDisplayHost,
  normalizeHandle,
  validateHandle,
} from "@/lib/handles/rules";
import { describeHandleStatus, isHandleStatus } from "@/lib/handles/status";

/** M1-01: one shared normalize-and-validate function. */
describe("M1-01 normalizeHandle", () => {
  it.each([
    ["Mara_Studio!", "marastudio"],
    ["MARA", "mara"],
    [" ma ra ", "mara"],
    ["mará", "mar"],
    ["a.b", "ab"],
    ["Zq_Test 9!", "zqtest9"],
    ["<script>alert(1)</script>", "scriptalert1script"],
    ["-Mara-", "-mara-"],
    ["", ""],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeHandle(input)).toBe(expected);
  });

  it("never truncates", () => {
    expect(normalizeHandle("A".repeat(40))).toBe("a".repeat(40));
  });
});

describe("M1-01 validateHandle", () => {
  it.each(["", "ab", "a-", "a", "--"])("returns 'short' for %j (0-2 characters)", (value) => {
    expect(validateHandle(value)).toBe("short");
  });

  it("runs the length check before every other rule", () => {
    // Both are also malformed (dash edges, xn-- is longer than 2), yet short wins at 2 chars.
    expect(validateHandle("-a")).toBe("short");
    expect(validateHandle("a-")).toBe("short");
    expect(validateHandle("-".repeat(2))).toBe("short");
  });

  it.each(["abc", "a-b", "123", "ma-ra", "a".repeat(30)])("returns 'ok' for %j", (value) => {
    expect(validateHandle(value)).toBe("ok");
  });

  it("returns 'too_long' at 31 characters, 'ok' at exactly 30", () => {
    expect(HANDLE_MAX_LENGTH).toBe(30);
    expect(validateHandle("a".repeat(30))).toBe("ok");
    expect(validateHandle("a".repeat(31))).toBe("too_long");
    // Length beats the dash rule: a 31 char value with a leading dash is too long first.
    expect(validateHandle("-" + "a".repeat(30))).toBe("too_long");
  });

  it.each(["-mara", "mara-", "xn--pple-43d", "xn--abc", "-abc-", "Mara", "ma_ra"])(
    "returns 'invalid' for %j",
    (value) => {
      expect(validateHandle(value)).toBe("invalid");
    },
  );

  it("accepts a plain label that merely contains xn-- later on", () => {
    expect(validateHandle("my-xn--thing")).toBe("ok");
  });
});

describe("M1-01 status copy", () => {
  it("has the exact messages of the mockup and the spec", () => {
    expect(describeHandleStatus("short", "ab")).toEqual({
      tone: "neutral",
      message: "At least 3 characters — letters, numbers and dashes.",
    });
    expect(describeHandleStatus("taken", "mara")).toEqual({
      tone: "bad",
      message: "That one’s taken. Try another.",
    });
    expect(describeHandleStatus("reserved", "www").message).toBe(
      "That name is reserved. Try another.",
    );
    expect(describeHandleStatus("invalid", "-x").message).toBe(
      "Handles can’t start or end with a dash or start with xn--.",
    );
    expect(describeHandleStatus("too_long", "a".repeat(31)).message).toBe(
      "Handles can be up to 30 characters.",
    );
    expect(describeHandleStatus("available", "zq-live-1")).toEqual({
      tone: "good",
      message: "zq-live-1.hydlnk.com is available",
    });
    expect(handleDisplayHost("zq-live-1")).toBe("zq-live-1.hydlnk.com");
  });

  it("recognises exactly the six statuses", () => {
    for (const status of ["available", "reserved", "taken", "short", "too_long", "invalid"]) {
      expect(isHandleStatus(status)).toBe(true);
    }
    expect(isHandleStatus("ok")).toBe(false);
    expect(isHandleStatus(undefined)).toBe(false);
  });
});

describe("M1-01 the module is safe in the browser and on the server", () => {
  const FORBIDDEN = [
    "server-only",
    "next/headers",
    "next/server",
    "@/lib/env",
    "@/lib/supabase",
    "@supabase/",
  ];

  /** Every module the rules file reaches through relative and "@/" imports, source text only. */
  function reachableImports(entry: string, seen = new Set<string>()): string[] {
    const specs: string[] = [];
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)) {
        const spec = match[1]!;
        specs.push(spec);
        let next: string | null = null;
        if (spec.startsWith("@/")) next = resolve("src", spec.slice(2));
        else if (spec.startsWith(".")) next = resolve(dirname(file), spec);
        if (next) queue.push(next.endsWith(".ts") ? next : `${next}.ts`);
      }
    }
    return specs;
  }

  it("imports nothing server-only (static import graph)", () => {
    const specs = reachableImports(resolve("src/lib/handles/rules.ts"));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      for (const bad of FORBIDDEN)
        expect(spec.startsWith(bad), `${spec} is server-only`).toBe(false);
    }
  });
});
