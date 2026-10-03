import { describe, expect, it } from "vitest";
import {
  ANONYMOUS,
  LOCAL_ADMIN_CLAIM,
  denyUnlessAdmin,
  isAdminClaims,
  principalFromClaims,
  type AdminConfig,
} from "@/lib/admin/principal";

const ADMIN = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const prod: AdminConfig = { adminIds: new Set([ADMIN]), rootDomain: "hydlnk.com" };
const local: AdminConfig = { adminIds: new Set(), rootDomain: "localhost:3000" };

describe("M5-04 admin identity comes from the verified claims", () => {
  it("a subject listed in ADMIN_USER_IDS is an admin; anyone else is not", () => {
    expect(isAdminClaims({ sub: ADMIN, email: "a@x.test" }, prod)).toBe(true);
    expect(isAdminClaims({ sub: ADMIN.toUpperCase() }, prod)).toBe(true);
    expect(isAdminClaims({ sub: OTHER }, prod)).toBe(false);
  });

  it("an empty list means nobody is an admin", () => {
    const none: AdminConfig = { adminIds: new Set(), rootDomain: "hydlnk.com" };
    expect(isAdminClaims({ sub: ADMIN }, none)).toBe(false);
  });

  it("no subject, or a subject that is not a string, is nobody", () => {
    expect(isAdminClaims({}, prod)).toBe(false);
    expect(isAdminClaims({ sub: "" }, prod)).toBe(false);
    expect(isAdminClaims({ sub: 7 }, prod)).toBe(false);
    expect(isAdminClaims({ sub: ["x"] }, prod)).toBe(false);
  });

  it("an email is never an identity: only the id matters", () => {
    expect(isAdminClaims({ sub: OTHER, email: "ghyde03@gmail.com" }, prod)).toBe(false);
  });
});

describe("M5-04 the local-only marker", () => {
  it("makes an admin on a localhost root domain, from app_metadata only", () => {
    expect(isAdminClaims({ sub: OTHER, app_metadata: { [LOCAL_ADMIN_CLAIM]: true } }, local)).toBe(
      true,
    );
  });

  it("is ignored in production, whatever the claims say", () => {
    expect(isAdminClaims({ sub: OTHER, app_metadata: { [LOCAL_ADMIN_CLAIM]: true } }, prod)).toBe(
      false,
    );
    expect(
      isAdminClaims(
        { sub: OTHER, app_metadata: { [LOCAL_ADMIN_CLAIM]: true } },
        { adminIds: new Set(), rootDomain: undefined },
      ),
    ).toBe(false);
  });

  it("is not honoured from user_metadata, which a user can edit", () => {
    expect(
      isAdminClaims({ sub: OTHER, user_metadata: { [LOCAL_ADMIN_CLAIM]: true } } as never, local),
    ).toBe(false);
  });

  it("must be the boolean true, not a truthy string or a number", () => {
    for (const value of ["true", 1, "yes", {}, [], null, false]) {
      expect(
        isAdminClaims({ sub: OTHER, app_metadata: { [LOCAL_ADMIN_CLAIM]: value } }, local),
      ).toBe(false);
    }
    expect(isAdminClaims({ sub: OTHER, app_metadata: "admin" }, local)).toBe(false);
    expect(isAdminClaims({ sub: OTHER, app_metadata: null }, local)).toBe(false);
  });
});

describe("M5-04 the principal and the one admin gate", () => {
  it("no claims is anonymous: 401", () => {
    expect(principalFromClaims(null, prod)).toBe(ANONYMOUS);
    expect(principalFromClaims({}, prod)).toBe(ANONYMOUS);
    expect(denyUnlessAdmin(ANONYMOUS)).toMatchObject({
      ok: false,
      status: 401,
      error: "unauthenticated",
    });
  });

  it("a signed-in non-admin is refused with 403", () => {
    const principal = principalFromClaims({ sub: OTHER, email: "o@x.test" }, prod);
    expect(principal).toEqual({ kind: "user", id: OTHER, email: "o@x.test", admin: false });
    expect(denyUnlessAdmin(principal)).toMatchObject({
      ok: false,
      status: 403,
      error: "forbidden",
    });
  });

  it("an admin passes", () => {
    const principal = principalFromClaims({ sub: ADMIN, email: "g@x.test" }, prod);
    expect(principal).toMatchObject({ kind: "user", id: ADMIN, admin: true });
    expect(denyUnlessAdmin(principal)).toBeNull();
  });
});
