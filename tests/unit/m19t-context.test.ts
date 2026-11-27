import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookie.value === undefined ? undefined : { value: cookie.value }) }),
}));

const { getCurrentPage } = await import("@/lib/pages/current");

/**
 * M19-10, M19-11 (C3, T5, T6): the current site is picked among the user's own pages and the ACTIVE
 * sites shared with them (the gate lists only those), by the `hl-page` cookie as a preference. A
 * cookie naming any other id falls back to the oldest OWN page, or with none the oldest shared one,
 * so a reload after removal lands on the member's own site (or /claim, from the gate).
 */
const page = (id: string, created: string) => ({ id, created_at: created });
const own = [page("own-new", "2026-02-01"), page("own-old", "2026-01-01")];
const shared = [page("shared-a", "2025-01-01")];
const user = { id: "u" };

describe("M19-10 the current site among own and shared", () => {
  it("M19-10 the cookie picks an active shared site", async () => {
    cookie.value = "shared-a";
    expect((await getCurrentPage(user, own, shared)).id).toBe("shared-a");
  });
  it("M19-11 a cookie naming a site the user lost (or never had) falls back to the oldest OWN page", async () => {
    cookie.value = "removed-site";
    expect((await getCurrentPage(user, own, shared)).id).toBe("own-old");
    cookie.value = undefined;
    expect((await getCurrentPage(user, own, shared)).id).toBe("own-old");
  });
  it("M19-10 an account with no site of its own lands on its oldest shared site", async () => {
    cookie.value = undefined;
    expect((await getCurrentPage(user, [], shared)).id).toBe("shared-a");
  });
});
