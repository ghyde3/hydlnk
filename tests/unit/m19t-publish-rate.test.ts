import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2, R3 (M19-05, G18): the publish rate keys on a shared site. A publisher's publish counts on their
 * own key and on the OWNER's (so the owner's 60 an hour is the budget of the whole team); the owner
 * counts once; an editor (who may not publish) counts on their own key only and never spends the
 * owner's budget. The access helper is asked with need `publish`.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: vi.fn() }));

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const core = vi.fn(async () => ({ ok: false, errors: [], reason: "forbidden" }));
vi.mock("@/lib/publish/core", () => ({
  publishPageCore: core,
  publishSitePageCore: core,
  publishDesignCore: core,
}));
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly: vi.fn() }));

const OWNER = "11111111-1111-4111-8111-111111111111";
const PUBLISHER = "22222222-2222-4222-8222-222222222222";
const EDITOR = "33333333-3333-4333-8333-333333333333";
const SITE = "44444444-4444-4444-8444-444444444444";
const ENTRY = "55555555-5555-4555-8555-555555555555";

// The rule, as the helper answers it: the owner and the publisher may publish, the editor may not.
const asked: Array<{ actorId: string; need: string }> = [];
vi.mock("@/lib/access/server", () => ({
  siteAccessFor: async (input: { actorId: string; need: string }) => {
    asked.push({ actorId: input.actorId, need: input.need });
    const canPublish = input.actorId === OWNER || input.actorId === PUBLISHER;
    const allowed = input.need === "publish" ? canPublish : input.actorId !== "stranger";
    return allowed ? { ok: true, access: { ownerId: OWNER } } : { ok: false, reason: "forbidden" };
  },
}));

// A real counter per key: `spent` keys are already at the limit.
const counts = new Map<string, number>();
let spent = new Set<string>();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return { allowed: !spent.has(key), retryAfter: 0 };
  },
}));

const { publishPage, publishSitePage, publishDesign } = await import("@/lib/publish/actions");

beforeEach(() => {
  counts.clear();
  asked.length = 0;
  spent = new Set();
  core.mockClear();
});

const ACTIONS = [
  ["publishPage", () => publishPage(SITE)],
  ["publishSitePage", () => publishSitePage(SITE, ENTRY, 1)],
  ["publishDesign", () => publishDesign(SITE, null)],
] as const;

describe("S2 the publish rate keys on a shared site", () => {
  it.each(ACTIONS)("%s: a publisher counts on their own key and the owner's", async (_name, act) => {
    getSessionUser.mockResolvedValue({ id: PUBLISHER, email: "p@example.com", methods: ["otp"] });
    await act();
    expect(Object.fromEntries(counts)).toEqual({ [`publish:${PUBLISHER}`]: 1, [`publish:${OWNER}`]: 1 });
    expect(asked).toEqual([{ actorId: PUBLISHER, need: "publish" }]);
  });

  it.each(ACTIONS)("%s: an editor counts on their own key only, never the owner's", async (_name, act) => {
    getSessionUser.mockResolvedValue({ id: EDITOR, email: "e@example.com", methods: ["otp"] });
    await act();
    expect(Object.fromEntries(counts)).toEqual({ [`publish:${EDITOR}`]: 1 });
  });

  it.each(ACTIONS)("%s: the owner counts once", async (_name, act) => {
    getSessionUser.mockResolvedValue({ id: OWNER, email: "o@example.com", methods: ["otp"] });
    await act();
    expect(Object.fromEntries(counts)).toEqual({ [`publish:${OWNER}`]: 1 });
  });

  it("G18: the owner's key is the team's budget: spent, a publisher is refused before the gate", async () => {
    spent = new Set([`publish:${OWNER}`]);
    getSessionUser.mockResolvedValue({ id: PUBLISHER, email: "p@example.com", methods: ["otp"] });
    expect(await publishPage(SITE)).toEqual({ ok: false, errors: [], reason: "rate_limited" });
    expect(core).not.toHaveBeenCalled();
  });

  it("an editor cannot use up the owner's budget: 70 editor calls leave the owner's key untouched", async () => {
    getSessionUser.mockResolvedValue({ id: EDITOR, email: "e@example.com", methods: ["otp"] });
    for (let i = 0; i < 70; i++) await publishSitePage(SITE, ENTRY, 1);
    expect(counts.get(`publish:${OWNER}`)).toBeUndefined();
    expect(counts.get(`publish:${EDITOR}`)).toBe(70);
  });
});
