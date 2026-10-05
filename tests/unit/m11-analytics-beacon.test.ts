import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBeacon } from "@/lib/analytics/ingest/beacon";
import { IPHONE_UA, ORIGIN, PAGE_ID, makeDeps, spyOnConsole } from "./analytics-ingest-helpers";

/**
 * M11-09: the view beacon carries the sub-page id (none on Home). `/api/e` records it only for a
 * LIVE sub-page of the site the request's origin serves; every refusal is the same silent 204, so
 * the endpoint says nothing about which ids exist.
 */

const LIVE = "11111111-1111-4111-8111-111111111111";
const DRAFT_ONLY = "22222222-2222-4222-8222-222222222222";
const OTHER_SITE = "33333333-3333-4333-8333-333333333333";

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

function depsWithLive(subPageIds: string[] | undefined) {
  return makeDeps({
    lookupBeaconPage: vi.fn(async (pageId: string) =>
      pageId === PAGE_ID
        ? {
            handle: "mara",
            customHosts: ["links.example.test"],
            ...(subPageIds ? { subPageIds } : {}),
          }
        : null,
    ),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("M11-09 the beacon and the sub-page id", () => {
  it("records a view of a live sub-page with its id", async () => {
    const s = depsWithLive([LIVE]);
    const response = await handleBeacon(
      beacon({ pageId: PAGE_ID, subPageId: LIVE, referrer: "" }),
      s.deps,
    );
    expect(response.status).toBe(204);
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({ page_id: PAGE_ID, type: "view", sub_page_id: LIVE });
  });

  it("is case-insensitive about the id and stores it lower case", async () => {
    const s = depsWithLive([LIVE]);
    await handleBeacon(
      beacon({ pageId: PAGE_ID, subPageId: LIVE.toUpperCase(), referrer: "" }),
      s.deps,
    );
    expect(s.inserted[0]?.sub_page_id).toBe(LIVE);
  });

  it("Home sends no id (or null) and the row has none", async () => {
    for (const body of [
      { pageId: PAGE_ID, referrer: "" },
      { pageId: PAGE_ID, subPageId: null, referrer: "" },
    ]) {
      const s = depsWithLive([LIVE]);
      await handleBeacon(beacon(body), s.deps);
      expect(s.inserted).toHaveLength(1);
      expect("sub_page_id" in s.inserted[0]!).toBe(false);
    }
  });

  it("refuses an id that is not a live page of the site, with the same 204 and no row", async () => {
    const ok = await handleBeacon(
      beacon({ pageId: PAGE_ID, referrer: "" }),
      depsWithLive([LIVE]).deps,
    );
    for (const subPageId of [DRAFT_ONLY, OTHER_SITE]) {
      const s = depsWithLive([LIVE]);
      const response = await handleBeacon(
        beacon({ pageId: PAGE_ID, subPageId, referrer: "" }),
        s.deps,
      );
      expect(response.status).toBe(204);
      expect([...response.headers.entries()]).toEqual([...ok.headers.entries()]);
      expect(await response.text()).toBe("");
      expect(s.inserted).toEqual([]);
    }
  });

  it("refuses every id when the site has no live sub-pages (or the lookup lists none)", async () => {
    for (const ids of [[], undefined]) {
      const s = depsWithLive(ids);
      await handleBeacon(beacon({ pageId: PAGE_ID, subPageId: LIVE, referrer: "" }), s.deps);
      expect(s.inserted).toEqual([]);
    }
  });

  it("refuses an id that is not a UUID, a number, an object or an empty string", async () => {
    for (const subPageId of ["not-a-uuid", "", 7, { id: LIVE }, [LIVE], "../" + LIVE]) {
      const s = depsWithLive([LIVE]);
      const response = await handleBeacon(
        beacon({ pageId: PAGE_ID, subPageId, referrer: "" }),
        s.deps,
      );
      expect(response.status).toBe(204);
      expect(s.inserted).toEqual([]);
      // Refused before the page is even looked up.
      expect(s.lookupBeaconPage).not.toHaveBeenCalled();
    }
  });

  it("a sub-page id from a foreign origin records nothing: the origin check still comes first", async () => {
    const s = depsWithLive([LIVE]);
    await handleBeacon(
      beacon(
        { pageId: PAGE_ID, subPageId: LIVE, referrer: "" },
        { origin: "https://evil.example" },
      ),
      s.deps,
    );
    expect(s.inserted).toEqual([]);
  });

  it("the verified custom host of the site may send a sub-page view", async () => {
    const s = depsWithLive([LIVE]);
    await handleBeacon(
      beacon(
        { pageId: PAGE_ID, subPageId: LIVE, referrer: "" },
        { origin: "http://links.example.test" },
      ),
      s.deps,
    );
    expect(s.inserted).toHaveLength(1);
  });

  it("a failing insert for a sub-page view is logged without the id and still answers 204", async () => {
    const quiet = spyOnConsole();
    const s = depsWithLive([LIVE]);
    s.insertEvent.mockRejectedValueOnce(new Error("db down"));
    const response = await handleBeacon(
      beacon({ pageId: PAGE_ID, subPageId: LIVE, referrer: "" }),
      s.deps,
    );
    expect(response.status).toBe(204);
    expect(quiet.text()).not.toContain(LIVE);
    quiet.restore();
  });
});
