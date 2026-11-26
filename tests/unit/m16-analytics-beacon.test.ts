import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBeacon } from "@/lib/analytics/ingest/beacon";
import type { BeaconPage } from "@/lib/analytics/ingest/types";
import { IPHONE_UA, ORIGIN, PAGE_ID, makeDeps, spyOnConsole } from "./analytics-ingest-helpers";

/**
 * M16-11: the beacon's `subPageId` is a generic item id. Besides a live sub-page it may name an
 * enabled archive of the site (the Post type's id: archive, paging and term pages) or a live post
 * of the site. Anything else (a draft post, another site's post, a random UUID, an archive that is
 * off) is the same silent 204 with nothing recorded. The post check is asked last, after the bot
 * filter, the limiter and the origin check, and never for an id the cached site read already knows.
 */

const SUB_PAGE = "11111111-1111-4111-8111-111111111111";
const POST_TYPE = "44444444-4444-4444-8444-444444444444";
const LIVE_POST = "55555555-5555-4555-8555-555555555555";
const DRAFT_POST = "66666666-6666-4666-8666-666666666666";
const OTHER_SITE_POST = "77777777-7777-4777-8777-777777777777";
const OTHER_SITE_TYPE = "88888888-8888-4888-8888-888888888888";
const RANDOM = "99999999-9999-4999-8999-999999999999";

function beacon(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://mara.localhost:3000/api/e", {
    method: "POST",
    headers: {
      "user-agent": IPHONE_UA,
      origin: ORIGIN,
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function blogDeps(page: Partial<BeaconPage> = {}) {
  // The site's own answer: only LIVE_POST is a live post of an enabled archive of THIS site.
  const isLivePost = vi.fn(async (entryId: string) => entryId === LIVE_POST);
  const spies = makeDeps({
    lookupBeaconPage: vi.fn(async (pageId: string) =>
      pageId === PAGE_ID
        ? {
            handle: "mara",
            customHosts: ["links.example.test"],
            subPageIds: [SUB_PAGE],
            archiveTypeIds: [POST_TYPE],
            isLivePost,
            ...page,
          }
        : null,
    ),
  });
  return { ...spies, isLivePost };
}

const view = (subPageId: string) => ({ pageId: PAGE_ID, subPageId, referrer: "" });

afterEach(() => vi.restoreAllMocks());

describe("M16-11 the beacon: posts and archives", () => {
  it("records a view of a live post under its entry id", async () => {
    const s = blogDeps();
    const response = await handleBeacon(beacon(view(LIVE_POST)), s.deps);
    expect(response.status).toBe(204);
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({
      page_id: PAGE_ID,
      type: "view",
      block_id: "",
      sub_page_id: LIVE_POST,
    });
    expect(s.isLivePost).toHaveBeenCalledTimes(1);
    expect(s.isLivePost).toHaveBeenCalledWith(LIVE_POST);
  });

  it("records an archive, paging or term page under the Post type's id, with no post check", async () => {
    const s = blogDeps();
    await handleBeacon(beacon(view(POST_TYPE.toUpperCase())), s.deps);
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]?.sub_page_id).toBe(POST_TYPE);
    expect(s.isLivePost).not.toHaveBeenCalled();
  });

  it("a live sub-page still needs no post check", async () => {
    const s = blogDeps();
    await handleBeacon(beacon(view(SUB_PAGE)), s.deps);
    expect(s.inserted).toHaveLength(1);
    expect(s.isLivePost).not.toHaveBeenCalled();
  });

  it("drops a draft post, another site's post or type and a random id: the same 204, no row", async () => {
    const ok = await handleBeacon(beacon({ pageId: PAGE_ID, referrer: "" }), blogDeps().deps);
    for (const id of [DRAFT_POST, OTHER_SITE_POST, OTHER_SITE_TYPE, RANDOM]) {
      const s = blogDeps();
      const response = await handleBeacon(beacon(view(id)), s.deps);
      expect(response.status).toBe(204);
      expect([...response.headers.entries()]).toEqual([...ok.headers.entries()]);
      expect(await response.text()).toBe("");
      expect(s.inserted).toEqual([]);
    }
  });

  it("drops the type id of an archive that is off (the site lists no archive)", async () => {
    const s = blogDeps({ archiveTypeIds: [] });
    await handleBeacon(beacon(view(POST_TYPE)), s.deps);
    expect(s.inserted).toEqual([]);
  });

  it("drops every unknown id when the lookup offers no post check (fails closed)", async () => {
    const s = makeDeps();
    await handleBeacon(beacon(view(LIVE_POST)), s.deps);
    expect(s.inserted).toEqual([]);
  });

  it("asks the post check only after the origin check: a foreign origin costs nothing", async () => {
    const s = blogDeps();
    await handleBeacon(beacon(view(LIVE_POST), { origin: "https://evil.example" }), s.deps);
    expect(s.isLivePost).not.toHaveBeenCalled();
    expect(s.inserted).toEqual([]);
  });

  it("a bot and a limited client never reach the lookup or the post check", async () => {
    const bot = blogDeps();
    await handleBeacon(beacon(view(LIVE_POST), { "user-agent": "Googlebot/2.1" }), bot.deps);
    expect(bot.lookupBeaconPage).not.toHaveBeenCalled();
    expect(bot.isLivePost).not.toHaveBeenCalled();
    expect(bot.inserted).toEqual([]);

    const limited = blogDeps();
    limited.rateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 9 });
    const response = await handleBeacon(beacon(view(LIVE_POST)), limited.deps);
    expect(response.status).toBe(429);
    expect(limited.lookupBeaconPage).not.toHaveBeenCalled();
    expect(limited.isLivePost).not.toHaveBeenCalled();
  });

  it("a post check that throws records nothing and logs no request data", async () => {
    const logged = spyOnConsole();
    const s = blogDeps({
      isLivePost: vi.fn(async () => {
        throw new Error("index down");
      }),
    });
    const response = await handleBeacon(beacon(view(LIVE_POST)), s.deps);
    expect(response.status).toBe(204);
    expect(s.inserted).toEqual([]);
    expect(logged.text()).toContain("index down");
    expect(logged.text()).not.toContain(LIVE_POST);
  });

  it("the verified custom host may send a post view", async () => {
    const s = blogDeps();
    await handleBeacon(
      beacon(view(LIVE_POST), { origin: "http://links.example.test" }),
      s.deps,
    );
    expect(s.inserted).toHaveLength(1);
  });
});
