import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPPORT_EMAIL,
  adminUserIdsSchema,
  isLocalRootDomain,
  readAdminUserIds,
  readSupportEmail,
  splitAdminUserIds,
  supportEmailSchema,
} from "@/lib/admin/env";
import { SUPPORT_EMAIL } from "@/components/marketing/site-map";
import { parseServerEnv } from "@/lib/env/server-schema";

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("M5-04 ADMIN_USER_IDS", () => {
  it("empty, unset and blank mean nobody is an admin", () => {
    expect(readAdminUserIds({}).size).toBe(0);
    expect(readAdminUserIds({ ADMIN_USER_IDS: "" }).size).toBe(0);
    expect(readAdminUserIds({ ADMIN_USER_IDS: "  ,  , " }).size).toBe(0);
  });

  it("is a comma-separated list of UUIDs, trimmed and lower-cased", () => {
    const ids = readAdminUserIds({ ADMIN_USER_IDS: ` ${A.toUpperCase()} , ${B},${A}` });
    expect([...ids].sort()).toEqual([A, B].sort());
  });

  it("an entry that is not a UUID is dropped at runtime, never admitted", () => {
    const ids = readAdminUserIds({
      ADMIN_USER_IDS: `${A},*,admin,${B.slice(0, -1)},ghyde03@gmail.com`,
    });
    expect([...ids]).toEqual([A]);
    expect(splitAdminUserIds("a, ,b").invalid).toEqual(["a", "b"]);
  });

  it("startup validation fails on a bad entry and says how many, never the value", () => {
    expect(adminUserIdsSchema.safeParse(undefined).success).toBe(true);
    expect(adminUserIdsSchema.safeParse("").success).toBe(true);
    expect(adminUserIdsSchema.safeParse(`${A},${B}`).success).toBe(true);
    const bad = adminUserIdsSchema.safeParse(`${A},secret-looking-value`);
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).not.toContain("secret-looking-value");
  });
});

describe("M5-09 SUPPORT_EMAIL", () => {
  it("defaults to the support address the marketing site shows", () => {
    expect(DEFAULT_SUPPORT_EMAIL).toBe(SUPPORT_EMAIL);
    expect(readSupportEmail({})).toBe(SUPPORT_EMAIL);
    expect(supportEmailSchema.parse(undefined)).toBe(SUPPORT_EMAIL);
  });

  it("uses a valid value and falls back on an empty or malformed one", () => {
    expect(readSupportEmail({ SUPPORT_EMAIL: "help@example.com" })).toBe("help@example.com");
    expect(readSupportEmail({ SUPPORT_EMAIL: "  " })).toBe(SUPPORT_EMAIL);
    expect(readSupportEmail({ SUPPORT_EMAIL: "not an email" })).toBe(SUPPORT_EMAIL);
    expect(supportEmailSchema.safeParse("not an email").success).toBe(false);
  });
});

describe("the local-only admin marker needs a localhost root domain", () => {
  it.each([
    ["localhost:3000", true],
    ["LOCALHOST:3100", true],
    ["localhost", true],
    ["app.localhost:3000", true],
    ["hydlnk.com", false],
    ["localhost.hydlnk.com", false],
    ["evil-localhost", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (domain, expected) => {
    expect(isLocalRootDomain(domain)).toBe(expected);
  });
});

describe("the two admin variables in the server environment schema (M5-04, M5-09)", () => {
  const base: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    SUPABASE_SECRET_KEY: "sb_secret_test_value",
  };
  const parse = (extra: Record<string, string | undefined>) =>
    parseServerEnv({ ...base, ...extra }, { requireM4: false });

  it("ADMIN_USER_IDS and SUPPORT_EMAIL are optional, and empty values read as unset", () => {
    const env = parse({ ADMIN_USER_IDS: "", SUPPORT_EMAIL: "" });
    expect(env.SUPPORT_EMAIL).toBe(SUPPORT_EMAIL);
    expect(parse({}).ADMIN_USER_IDS).toBeUndefined();
    expect(parse({ ADMIN_USER_IDS: `${A},${B}` }).ADMIN_USER_IDS).toBe(`${A},${B}`);
    expect(parse({ SUPPORT_EMAIL: "help@example.com" }).SUPPORT_EMAIL).toBe("help@example.com");
  });

  it("a bad entry or address fails startup naming the variable and never its value", () => {
    expect(() => parse({ ADMIN_USER_IDS: `${A},ghyde03@gmail.com` })).toThrow(/ADMIN_USER_IDS/);
    expect(() => parse({ SUPPORT_EMAIL: "not an email" })).toThrow(/SUPPORT_EMAIL/);
    try {
      parse({ ADMIN_USER_IDS: "very-secret-looking-entry" });
    } catch (error) {
      expect((error as Error).message).not.toContain("very-secret-looking-entry");
    }
  });

  it("the production deployment refuses a localhost root domain (it would open the local-only admin marker)", () => {
    expect(() => parse({ VERCEL_ENV: "production" })).toThrow(/NEXT_PUBLIC_ROOT_DOMAIN/);
    expect(() =>
      parse({ VERCEL_ENV: "production", NEXT_PUBLIC_ROOT_DOMAIN: "app.localhost:3000" }),
    ).toThrow(/localhost host when VERCEL_ENV=production/);
    expect(() =>
      parse({ VERCEL_ENV: "production", NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.com" }),
    ).not.toThrow();
    // Local development, CI and preview deployments are unaffected.
    expect(() => parse({})).not.toThrow();
    expect(() => parse({ VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => parse({ VERCEL_ENV: "development" })).not.toThrow();
  });
});
