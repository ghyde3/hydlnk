import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, PublishDoc, SubPagePublish } from "@/lib/document";
import { PAGE_ID, waveGPublished } from "./fixtures/m8-render-docs";
import { bannerRef } from "./fixtures/page-document";

/**
 * M20-03, M20-04 (render side): a block outside its time window is absent from the live HTML of
 * Home and of a sub-page, on the handle host and on a custom domain: its text, URL, id, CSS and FAQ
 * JSON-LD. The decision is made at generation, at the later of the server clock and the site's
 * schedule clock. The real public read (`published-page.ts`) runs over a stubbed secret-key client,
 * so the filter is proven where it lives, not around a mock of it; the clock is Vitest's fake one.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  homeBlocks: [] as unknown[],
  subPage: null as unknown,
}));

/** The secret-key client: every `pages` read answers the one site row (published-page.ts reads two). */
vi.mock("@/lib/supabase/admin", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: state.row, error: null }),
  };
  return { createAdminSupabase: () => ({ from: () => chain }) };
});
vi.mock("@/lib/site/page-entries", () => ({
  getPublishedHomeWithClient: async () => ({ published: { path: "/", blocks: state.homeBlocks } }),
}));
vi.mock("@/lib/handles/availability", () => ({ checkHandle: vi.fn() }));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: async () => null }));
vi.mock("@/lib/site/published", async () => {
  const { siteContextFrom } = await import("@/lib/site/live");
  const index = [{ id: SUB_ID, path: "events", title: "Events" }];
  return {
    getSiteIndex: async () => index,
    getPublishedSubPage: async () => state.subPage,
    getLiveSiteContext: async (_pageId: string, doc: { nav?: unknown }, currentId: string) =>
      siteContextFrom(index, doc as never, currentId),
  };
});
vi.mock("@/lib/blog/published", () => ({
  getSiteArchives: async () => ({ archives: [], pagesWithPostLists: [] }),
  getPostIndex: async () => ({ complete: true, total: 0, posts: [] }),
}));

const SUB_ID = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const T0 = Date.parse("2026-12-01T09:00:00Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + ":00Z";

const { handleResponse, siteResponse, siteSubPageResponse } =
  await import("@/lib/tenant-render/respond");

/** A link that starts in an hour, a card and an FAQ that ended an hour ago, an open-ended link, a hidden link. */
const windowed: Block[] = [
  {
    id: "lnk-upcoming1",
    type: "link",
    visible: true,
    label: "Doors open soon",
    url: "https://tickets.example/upcoming-url",
    schedule: { from: iso(T0 + 60 * MIN) },
  },
  {
    id: "crd-ended-001",
    type: "card",
    visible: true,
    title: "Last week's sale",
    caption: "Gone",
    url: "https://shop.example/ended-card-url",
    image: null,
    overrides: { accent: "#ff0055" },
    schedule: { from: iso(T0 - 120 * MIN), until: iso(T0 - 60 * MIN) },
  },
  {
    id: "faq-ended-001",
    type: "faq",
    visible: true,
    items: [{ id: "faq-item-0001", question: "Is the sale on?", answer: "It was." }],
    schedule: { until: iso(T0 - 60 * MIN) },
  },
  {
    id: "lnk-showing01",
    type: "link",
    visible: true,
    label: "Always here",
    url: "https://always.example/open-url",
    schedule: { from: iso(T0 - 60 * MIN) },
  },
  {
    id: "lnk-hidden001",
    type: "link",
    visible: false,
    label: "Hidden link",
    url: "https://hidden.example/hidden-url",
  },
] as Block[];

/** What a live block puts in the HTML (its id, its text, its CSS, the FAQ JSON-LD). */
const TRACES: Record<string, string[]> = {
  "lnk-upcoming1": ["lnk-upcoming1", "Doors open soon"],
  "crd-ended-001": ["crd-ended-001", "Last week", "#ff0055"],
  "faq-ended-001": ["Is the sale on?", "FAQPage"],
  "lnk-showing01": ["lnk-showing01", "Always here"],
  "lnk-hidden001": ["lnk-hidden001", "Hidden link"],
};
/** Destinations: outbound links go through /r, so none is ever in a body, live or not. */
const URLS = ["upcoming-url", "ended-card-url", "open-url", "hidden-url"];

function expectBlocks(html: string, present: string[]) {
  for (const [id, traces] of Object.entries(TRACES)) {
    for (const trace of traces) {
      const want = present.includes(id);
      expect(html.includes(trace), `${id}: "${trace}" ${want ? "is" : "is not"} in the HTML`).toBe(
        want,
      );
    }
  }
  for (const url of URLS) expect(html).not.toContain(url);
}

function site(clock: string | null = null) {
  const doc: PublishDoc = { ...waveGPublished, blocks: [] };
  state.row = {
    id: PAGE_ID,
    published: doc,
    published_at: "2026-11-01T00:00:00Z",
    schedule_clock: clock,
    accounts: { plan: "pro", suspended_at: null },
  };
  state.homeBlocks = windowed;
  const sub: SubPagePublish = {
    path: "events",
    title: "Events",
    description: "",
    blocks: windowed,
  };
  state.subPage = { id: SUB_ID, document: sub };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  site();
});
afterEach(() => vi.useRealTimers());

describe("M20-03 the live HTML holds a block only inside its window", () => {
  it("M20-03 Home on the handle host at three instants holds exactly the live blocks", async () => {
    vi.setSystemTime(T0 - 150 * MIN); // before the card and the open-ended link start; the FAQ shows
    expectBlocks(await (await handleResponse("mara")).text(), ["faq-ended-001"]);
    vi.setSystemTime(T0 - 90 * MIN); // the card and the FAQ are showing
    expectBlocks(await (await handleResponse("mara")).text(), ["crd-ended-001", "faq-ended-001"]);
    vi.setSystemTime(T0); // card and FAQ ended, the upcoming link not yet, the open-ended one showing
    expectBlocks(await (await handleResponse("mara")).text(), ["lnk-showing01"]);
    vi.setSystemTime(T0 + 61 * MIN);
    expectBlocks(await (await handleResponse("mara")).text(), ["lnk-showing01", "lnk-upcoming1"]);
  });

  it("M20-03 a custom domain and a sub-page answer the same way", async () => {
    vi.setSystemTime(T0);
    expectBlocks(await (await siteResponse(PAGE_ID)).text(), ["lnk-showing01"]);
    const sub = await siteSubPageResponse(PAGE_ID, "events");
    expect(sub.status).toBe(200);
    expectBlocks(await sub.text(), ["lnk-showing01"]);
  });

  it("M20-03 an out-of-window image block or card leaves no image address in the response", async () => {
    vi.setSystemTime(T0);
    const img = (name: string) => ({ ...bannerRef, path: bannerRef.path.replace("night-market-banner", name) });
    state.homeBlocks = [
      { id: "img-ended-001", type: "image", visible: true, image: img("ended-image-addr"), alt: "Ended", shape: "wide", url: "", schedule: { until: iso(T0 - 60 * MIN) } },
      { id: "crd-upcoming1", type: "card", visible: true, title: "Soon", caption: "", url: "https://shop.example/soon", image: img("upcoming-card-addr"), schedule: { from: iso(T0 + 60 * MIN) } },
      { id: "img-showing1", type: "image", visible: true, image: img("showing-image-addr"), alt: "Showing", shape: "wide", url: "", schedule: { from: iso(T0 - 60 * MIN) } },
    ];
    for (const response of [await handleResponse("mara"), await siteResponse(PAGE_ID)]) {
      const html = await response.text();
      // The control: an image inside its window is drawn with its address.
      expect(html).toContain("showing-image-addr");
      expect(html).not.toContain("ended-image-addr");
      expect(html).not.toContain("upcoming-card-addr");
      expect(html).not.toContain("img-ended-001");
      expect(html).not.toContain("crd-upcoming1");
    }
  });

  it("M20-03 no script or CSS hides anything: the one tenant script is the only script", async () => {
    vi.setSystemTime(T0);
    const html = await (await handleResponse("mara")).text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.filter((tag) => !tag.includes("application/ld+json"))).toHaveLength(1);
    expect(html).not.toMatch(/data-(from|until)|schedule/i);
  });

  it("M20-04 clock skew: a server clock one second behind the boundary draws the state the sweep expired the site for", async () => {
    const boundary = T0 + 60 * MIN; // the upcoming link starts here
    vi.setSystemTime(boundary - 1000);
    site(new Date(boundary).toISOString()); // the sweep set the clock at the boundary (database time)
    expectBlocks(await (await handleResponse("mara")).text(), ["lnk-showing01", "lnk-upcoming1"]);
    site(null);
    expectBlocks(await (await handleResponse("mara")).text(), ["lnk-showing01"]);
  });

  it("M20-03 a window planted past Publish that is not canonical fails closed, and never throws", async () => {
    vi.setSystemTime(T0);
    // The live copy is read through the publish schema, whose time rule is the renderer's own
    // (`scheduleInstant`): no stored value can pass one and fail the other. So a planted value that is
    // not a canonical minute makes the whole copy unreadable, and the page answers the plain 404
    // panel: nothing of the copy is served, the block that held it least of all. One at a time.
    for (const schedule of [
      { from: "tomorrow" },
      { from: "2026-02-30T09:00:00Z" },
      { until: "2026-11-26T24:00:00Z" },
      { until: 5 },
    ]) {
      state.homeBlocks = [
        { ...windowed[3]!, schedule } as never,
        { ...windowed[0]!, id: "lnk-planted02" },
      ];
      const response = await handleResponse("mara");
      const html = await response.text();
      expect(response.status, JSON.stringify(schedule)).toBe(404);
      expect(html, JSON.stringify(schedule)).not.toContain("lnk-showing01");
      expect(html, JSON.stringify(schedule)).not.toContain("lnk-planted02");
      expect(html, JSON.stringify(schedule)).not.toContain("upcoming-url");
    }
    // The decision itself fails closed for an unreadable `from` (what a looser reader would reach).
    const { isLiveAt } = await import("@/lib/document/schedule");
    expect(isLiveAt({ schedule: { from: "tomorrow" } }, T0)).toBe(false);
    expect(isLiveAt({ schedule: { from: "2026-11-26T24:00:00Z" } }, T0 + 10 * 24 * 60 * MIN)).toBe(
      false,
    );
  });
});
