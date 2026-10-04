import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SENTRY_ENV_KEYS, parseSentryEnv, sentryEnvSchema } from "@/lib/env/sentry";
import { parseEnv, publicEnvSchema, readPublicEnv } from "@/lib/env/shared";
import { SERVER_ENV_KEYS, parseServerEnv } from "@/lib/env/server-schema";
import { isClientModule, listFiles, ROOT, walk } from "./support/module-graph";

/**
 * M9-10 environment: NEXT_PUBLIC_SENTRY_DSN (public), SENTRY_AUTH_TOKEN (secret, build only),
 * SENTRY_ORG and SENTRY_PROJECT are all optional, documented in .env.example with names only, and
 * the token is never exposed to client code.
 */

const BASE_PUBLIC = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
};
const BASE_SERVER = { ...BASE_PUBLIC, SUPABASE_SECRET_KEY: "sb_secret_test_value" };
const NAMES = ["NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"] as const;

describe("M9-10 the schema parses with none of the four set, and with all of them", () => {
  it("none set: every field is undefined and nothing throws", () => {
    expect(parseSentryEnv({})).toEqual({ NEXT_PUBLIC_SENTRY_DSN: undefined, SENTRY_AUTH_TOKEN: undefined, SENTRY_ORG: undefined, SENTRY_PROJECT: undefined });
    expect(sentryEnvSchema.safeParse({}).success).toBe(true);
  });

  it("all set: read as given, trimmed", () => {
    expect(
      parseSentryEnv({ NEXT_PUBLIC_SENTRY_DSN: " https://k@o1.ingest.sentry.io/1 ", SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" }),
    ).toEqual({ NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/1", SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" });
  });

  it("an empty or blank value reads as unset (Vercel and dotenv both produce them)", () => {
    const env = parseSentryEnv({ NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_AUTH_TOKEN: "  ", SENTRY_ORG: "", SENTRY_PROJECT: "\n" });
    expect(Object.values(env).every((value) => value === undefined)).toBe(true);
  });

  it("a malformed DSN does not stop anything: it is not this schema's job (Sentry stays off and one log line says so)", () => {
    expect(() => parseSentryEnv({ NEXT_PUBLIC_SENTRY_DSN: "garbage" })).not.toThrow();
    expect(parseSentryEnv({ NEXT_PUBLIC_SENTRY_DSN: "garbage" }).NEXT_PUBLIC_SENTRY_DSN).toBe("garbage");
  });

  it("the app's own schemas parse with none set (the four are not required anywhere else)", () => {
    expect(() => parseEnv(publicEnvSchema, BASE_PUBLIC, "client")).not.toThrow();
    expect(() => parseServerEnv(BASE_SERVER, { requireM4: false })).not.toThrow();
    expect(SENTRY_ENV_KEYS).toEqual(NAMES);
  });

  it("the DSN is not in the public environment every client bundle reads: it is inlined only where it is read", () => {
    expect(Object.keys(readPublicEnv())).not.toContain("NEXT_PUBLIC_SENTRY_DSN");
    expect(Object.keys(publicEnvSchema.shape)).not.toContain("NEXT_PUBLIC_SENTRY_DSN");
    for (const name of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]) expect(SERVER_ENV_KEYS as readonly string[]).not.toContain(name);
  });
});

describe("M9-10 .env.example lists the four: names only, empty values", () => {
  const lines = readFileSync(resolve(ROOT, ".env.example"), "utf8").split("\n");
  for (const name of NAMES) {
    it(`${name}= is there, empty, with a comment above it`, () => {
      const index = lines.findIndex((line) => line.startsWith(`${name}=`));
      expect(index, `${name} is not listed in .env.example`).toBeGreaterThan(-1);
      expect(lines[index]).toBe(`${name}=`);
      expect(lines[index - 1]!.trim().startsWith("#")).toBe(true);
    });
  }
});

describe("M9-10 docs/PLAN.md names the four", () => {
  it("the Decided list has the Sentry entry with the four variable names and the scope", () => {
    const decided = readFileSync(resolve(ROOT, "docs/PLAN.md"), "utf8").split("\n## Open")[0]!;
    const entry = decided.split("\n").find((line) => line.startsWith("- Sentry (2026-10-04"));
    expect(entry, "docs/PLAN.md has no 'Sentry (2026-10-04' entry in Decided").toBeDefined();
    for (const name of NAMES) expect(entry, name).toContain(name);
    expect(entry).toMatch(/app host only/);
    expect(entry).toMatch(/never a tenant page/);
  });
});

describe("M9-10 the auth token never reaches client code", () => {
  const clientModules = listFiles("src").filter((file) => isClientModule(readFileSync(resolve(ROOT, file), "utf8")));

  it("no client module, and nothing a client module imports, names SENTRY_AUTH_TOKEN, SENTRY_ORG or SENTRY_PROJECT", () => {
    expect(clientModules.length).toBeGreaterThan(50);
    const graph = walk(clientModules, { stopAtServerActions: true });
    const offenders = [...graph.files]
      .filter(([, source]) => /SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_PROJECT/.test(source))
      .map(([file]) => file.replace(`${ROOT}/`, ""));
    expect(offenders).toEqual([]);
  });

  it("the only source files that name the token are the Sentry env schema, the build module and next.config.ts (which never ship to a browser)", () => {
    const named = [...listFiles("src"), "next.config.ts"].filter((file) => /SENTRY_AUTH_TOKEN/.test(readFileSync(resolve(ROOT, file), "utf8")));
    expect(named.sort()).toEqual(["next.config.ts", "src/lib/env/sentry.ts", "src/lib/sentry/build.ts"].sort());
  });

  it("the DSN is read, spelled out, by the app host's layout component and the server hook, and by no other file", () => {
    const named = listFiles("src").filter((file) => /process\.env\.NEXT_PUBLIC_SENTRY_DSN/.test(readFileSync(resolve(ROOT, file), "utf8")));
    expect(named.sort()).toEqual(["src/components/app/error-monitor.tsx", "src/instrumentation.ts"].sort());
  });
});
