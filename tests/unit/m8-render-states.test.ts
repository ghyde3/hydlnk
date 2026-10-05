// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waveGPublished, PAGE_ID } from "./fixtures/m8-render-docs";

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

const pageState = vi.hoisted(() => ({
  byHandle: vi.fn(),
  byId: vi.fn(),
  check: vi.fn(),
  primary: vi.fn(),
}));
vi.mock("@/app/(tenant)/published-page", () => ({
  getTenantPageState: pageState.byHandle,
  getTenantSiteState: pageState.byHandle,
  getTenantPageStateById: pageState.byId,
}));
vi.mock("@/lib/handles/availability", () => ({ checkHandle: pageState.check }));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: pageState.primary }));
// The sub-page reads (M11-06) reach the database; the state specs here never draw a sub-page.
vi.mock("@/lib/site/published", () => ({
  getSiteIndex: vi.fn(async () => []),
  getPublishedSubPage: vi.fn(async () => null),
}));

const states = await import("@/lib/tenant-render/state-pages");
const { handleResponse, siteResponse, plainNotFoundResponse } = await import(
  "@/lib/tenant-render/respond"
);

/**
 * M8-03: the placeholder, every 404 and the 500 are built the way the page is: the existing panel
 * components rendered to a string, one `<style>` with the rules that markup uses, `noindex`, no
 * script, and no request but the document and the favicon. M8-02 for the answers of the two routes.
 */

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const text = (html: string) => parse(html).body.textContent ?? "";

const FRAMEWORK = /__next_f|__NEXT_DATA__|\/_next\/|<script|modulepreload|rel="stylesheet"/;

function expectPlainDocument(html: string) {
  expect(html.startsWith('<!DOCTYPE html><html lang="en"><head>')).toBe(true);
  expect(html).not.toMatch(FRAMEWORK);
  const doc = parse(html);
  expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
  expect(doc.querySelectorAll("script").length).toBe(0);
  expect(doc.querySelectorAll("style").length).toBe(1);
  // The only things a state document may reference: the favicon.
  const refs = [...doc.querySelectorAll("[src], link[href]")].map(
    (el) => el.getAttribute("src") ?? el.getAttribute("href"),
  );
  expect(refs).toEqual(["/icon.svg"]);
}

describe("M8-03 the claimed handle with nothing published: the placeholder", () => {
  const html = states.placeholderDocument("zq-handle");
  const doc = parse(html);

  it("is a plain tenant document titled {handle}.hydlnk.com, noindex, no script, no request but the favicon", () => {
    expectPlainDocument(html);
    expect(doc.querySelector("title")?.textContent).toBe("zq-handle.hydlnk.com");
  });

  it("has exactly one h1 with the handle and 'Nothing published here yet.'", () => {
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("h1")?.textContent).toBe("zq-handle");
    expect(text(html)).toContain("Nothing published here yet.");
  });

  it("is a tenant page, not HYDLNK UI: the root carries the system --t-* variables and no --hl-* appears", () => {
    expect(doc.querySelector(".tenant-root")?.getAttribute("style")).toContain("--t-bg:");
    expect(html).not.toContain("--hl-");
    expect(html).not.toMatch(/data-app-shell|app-shell/);
    // System fonts only.
    expect(html).not.toMatch(/@font-face/);
  });
});

describe("M8-03 the 404 panels: HYDLNK-styled, with the copy of the components", () => {
  it("an unclaimed handle: 'This address isn’t claimed.', 'Claim {handle}' to the app host's signup, 'Go to hydlnk.com'", () => {
    const html = states.missingDocument("zq-free", "available");
    expectPlainDocument(html);
    const doc = parse(html);
    expect(doc.querySelector("h1")?.textContent).toBe("This address isn’t claimed.");
    const links = [...doc.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Claim zq-free", "http://app.localhost:3000/signup?handle=zq-free"],
      ["Go to hydlnk.com", "http://localhost:3000/"],
    ]);
    expect(doc.querySelector("title")?.textContent).toBe("Page not found");
  });

  it("a reserved address: 'That address is reserved.' with no claim link and no echo of the address", () => {
    const html = states.missingDocument("admin", "reserved");
    expectPlainDocument(html);
    expect(text(html)).toContain("That address is reserved.");
    expect(html).not.toMatch(/signup|Claim/);
    expect(html).not.toContain("admin");
  });

  it.each(["short", "too_long", "invalid"] as const)(
    "an invalid address (%s): 'That address isn’t valid.', no claim link, no echo",
    (status) => {
      const html = states.missingDocument("ab-secret", status);
      expectPlainDocument(html);
      expect(text(html)).toContain("That address isn’t valid.");
      expect(html).not.toMatch(/signup|Claim/);
      expect(html).not.toContain("ab-secret");
    },
  );

  it("a taken handle or a failed availability check, and any sub-path, is the plain 404", () => {
    for (const html of [
      states.missingDocument("zq-x", "taken"),
      states.missingDocument("zq-x", null),
      states.plainNotFoundDocument(),
    ]) {
      expectPlainDocument(html);
      const doc = parse(html);
      expect(doc.querySelector("h1")?.textContent).toBe("Page not found");
      expect(text(html)).toContain("This page doesn’t exist or hasn’t been published yet.");
      expect(html).not.toMatch(/signup|Claim/);
    }
  });

  it("a suspended owner: 'This page isn’t available.', 'It has been taken offline.', a link home, nothing of the page", () => {
    const html = states.unavailableDocument();
    expectPlainDocument(html);
    const doc = parse(html);
    expect(doc.querySelector("h1")?.textContent).toBe("This page isn’t available.");
    expect(text(html)).toContain("It has been taken offline.");
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("http://localhost:3000/");
    expect(doc.querySelector("title")?.textContent).toBe("Page not available");
    for (const tag of ['property="og:', 'name="twitter:', 'name="description"']) {
      expect(html).not.toContain(tag);
    }
  });

  it("the HYDLNK panels use literal HYDLNK colors inline and never a --t-* token, not even in the style element", () => {
    for (const html of [
      states.missingDocument("zq-free", "available"),
      states.missingDocument("admin", "reserved"),
      states.unavailableDocument(),
      states.errorDocument("abc12345"),
    ]) {
      expect(html).not.toContain("--t-");
      expect(html).not.toContain("tenant-root");
      expect(html).toMatch(/style="background:#(1C1B1A|F4F3F0)/);
    }
  });

  it("a hostile handle is text in the panel, and the claim link encodes it", () => {
    const html = states.missingDocument('"><img src=x onerror=alert(1)>', "available");
    const doc = parse(html);
    expect(doc.querySelector("img")).toBeNull();
    const claim = doc.querySelector("a")!;
    expect(claim.getAttribute("href")).toBe(
      `http://app.localhost:3000/signup?handle=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`,
    );
  });
});

describe("M8-03 the 500 panel", () => {
  const html = states.errorDocument("a1b2c3d4");
  const doc = parse(html);

  it("says the sentence in an alert, links Retry to the same URL, shows the reference; plain markup, no script", () => {
    expectPlainDocument(html);
    const message = doc.querySelector('[data-testid="error-message"]')!;
    expect(message.textContent).toBe("Something went wrong. Try again.");
    expect(message.getAttribute("role")).toBe("alert");
    const retry = [...doc.querySelectorAll("a")].find((a) => a.textContent === "Retry")!;
    // An empty href is the current address, so Retry reloads the very URL that failed, with no script.
    expect(retry.getAttribute("href")).toBe("");
    expect(doc.querySelector('[data-testid="error-reference"]')?.textContent).toBe(
      "Reference: a1b2c3d4",
    );
    expect(doc.querySelector("button")).toBeNull();
  });

  it("holds nothing of any page, no stack trace and no tenant text", () => {
    expect(html).not.toMatch(/\bat\s+\S+\s+\(|\.tsx?:\d+|node_modules|Error:/);
  });
});

describe("M8-03 what each route answers for each state", () => {
  beforeEach(() => {
    pageState.byHandle.mockReset();
    pageState.byId.mockReset();
    pageState.check.mockReset();
    pageState.primary.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const published = {
    kind: "published" as const,
    page: {
      pageId: PAGE_ID,
      document: waveGPublished,
      publishedAt: "2026-10-01T12:00:00.000Z",
      plan: "free",
    },
  };

  it("a handle host: published 200 with the page, unpublished 200 placeholder, suspended 404, missing 404", async () => {
    pageState.byHandle.mockResolvedValueOnce(published);
    const live = await handleResponse("mara");
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const liveHtml = await live.text();
    expect(liveHtml).toContain("data-page-root");
    expect(liveHtml).toContain(`data-page-id="${PAGE_ID}"`);
    expect(liveHtml).toContain('<meta property="og:url" content="http://mara.localhost:3000/">');
    expect(liveHtml).toMatch(/og:image" content="http:\/\/mara\.localhost:3000\/og\?v=\d+"/);

    pageState.byHandle.mockResolvedValueOnce({ kind: "unpublished", pageId: PAGE_ID });
    const placeholder = await handleResponse("mara");
    expect(placeholder.status).toBe(200);
    expect(await placeholder.text()).toContain("Nothing published here yet.");

    pageState.byHandle.mockResolvedValueOnce({ kind: "suspended" });
    const suspended = await handleResponse("mara");
    expect(suspended.status).toBe(404);
    const suspendedHtml = await suspended.text();
    expect(suspendedHtml).toContain("This page isn’t available.");
    expect(suspendedHtml).not.toContain("Claim");
    // A suspended page never asks the availability check: the handle is held, not offered.
    expect(pageState.check).not.toHaveBeenCalled();

    pageState.byHandle.mockResolvedValueOnce({ kind: "missing" });
    pageState.check.mockResolvedValueOnce({ handle: "mara", status: "available" });
    const missing = await handleResponse("mara");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("This address isn’t claimed.");
  });

  it("a missing handle follows the availability check: reserved, invalid, taken; a failed check is the plain 404", async () => {
    const answer = async (status: string | Error) => {
      pageState.byHandle.mockResolvedValueOnce({ kind: "missing" });
      if (status instanceof Error) pageState.check.mockRejectedValueOnce(status);
      else pageState.check.mockResolvedValueOnce({ handle: "zq", status });
      const response = await handleResponse("zq");
      return { status: response.status, html: await response.text() };
    };
    expect((await answer("reserved")).html).toContain("That address is reserved.");
    expect((await answer("invalid")).html).toContain("That address isn’t valid.");
    expect((await answer("taken")).html).toContain("Page not found");
    const failed = await answer(new Error("db down"));
    expect(failed.status).toBe(404);
    expect(failed.html).toContain("Page not found");
    expect(console.error).toHaveBeenCalled();
  });

  it("a custom host: the page names its primary domain; with none left it keeps the title and description only", async () => {
    pageState.byId.mockResolvedValue(published);
    pageState.primary.mockResolvedValueOnce("links.example.test");
    const withDomain = await siteResponse(PAGE_ID);
    const html = await withDomain.text();
    expect(withDomain.status).toBe(200);
    expect(html).toContain('<meta property="og:url" content="http://links.example.test:3000/">');
    expect(html).toContain("http://links.example.test:3000/og?v=");

    pageState.primary.mockResolvedValueOnce(null);
    const bare = await (await siteResponse(PAGE_ID)).text();
    const { escapeHtml } = await import("@/lib/tenant-render/escape");
    expect(bare).toContain(`<title>${escapeHtml(waveGPublished.profile.name)} - links</title>`);
    expect(bare).not.toContain("og:");
    expect(bare).not.toContain("twitter:");
  });

  it("a custom host's draft-only page, unknown id and the unknown-host sentinel are the plain 404; a suspended owner is 'isn’t available'", async () => {
    for (const state of [{ kind: "unpublished", pageId: PAGE_ID }, { kind: "missing" }]) {
      pageState.byId.mockResolvedValueOnce(state);
      const response = await siteResponse("unknown");
      expect(response.status).toBe(404);
      const html = await response.text();
      expect(html).toContain("Page not found");
      expect(html).not.toContain("Claim");
    }
    pageState.byId.mockResolvedValueOnce({ kind: "suspended" });
    const suspended = await siteResponse(PAGE_ID);
    expect(suspended.status).toBe(404);
    expect(await suspended.text()).toContain("This page isn’t available.");
  });

  it("a sub-path is the plain 404 on both routes' catch-alls", async () => {
    const response = plainNotFoundResponse();
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This page doesn’t exist or hasn’t been published yet.");
  });
});

describe("M8-03 a failure is a 500 panel, never a 404 and never cached", () => {
  beforeEach(() => {
    pageState.byHandle.mockReset();
    pageState.byId.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("when the public read or the handle lookup throws: status 500, no-store, noindex, the sentence, a reference, the log line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("connect ECONNREFUSED 127.0.0.1:54322 secret-detail");
    pageState.byHandle.mockRejectedValueOnce(failure);
    const response = await handleResponse("mara");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    const doc = parse(html);
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    expect(doc.querySelector('[data-testid="error-message"]')?.textContent).toBe(
      "Something went wrong. Try again.",
    );
    const reference = /Reference: ([a-z0-9]{8})/.exec(html)?.[1];
    expect(reference).toBeTruthy();
    expect(html).not.toMatch(/ECONNREFUSED|secret-detail|Error:/);
    // The same value is in the server log, next to the error.
    expect(error).toHaveBeenCalledWith(`[error ${reference}]`, failure);

    pageState.byId.mockRejectedValueOnce(failure);
    const site = await siteResponse(PAGE_ID);
    expect(site.status).toBe(500);
    expect(site.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the digest as the reference when the error carries one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pageState.byHandle.mockRejectedValueOnce(Object.assign(new Error("x"), { digest: "862441974" }));
    expect(await (await handleResponse("mara")).text()).toContain("Reference: 862441974");
  });
});

describe("M8-04 the failed response is kept out of the cache of a production server", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (globalThis as { __incrementalCache?: unknown }).__incrementalCache;
  });

  it("registers a one-second revalidate and a tag, then expires that tag through the cache handler after the response", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const registered: Array<{ tags?: string[]; revalidate?: number }> = [];
    const afterTasks: Array<() => unknown> = [];
    vi.doMock("next/cache", () => ({
      unstable_cache: (fn: () => unknown, _key: string[], options: { tags?: string[]; revalidate?: number }) => {
        registered.push(options);
        return fn;
      },
    }));
    vi.doMock("next/server", () => ({ after: (task: () => unknown) => afterTasks.push(task) }));
    const revalidateTag = vi.fn(async () => {});
    (globalThis as { __incrementalCache?: unknown }).__incrementalCache = { revalidateTag };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { failureResponse, FAILURE_TAG, FAILURE_REVALIDATE_SECONDS } = await import(
      "@/lib/tenant-render/failure"
    );
    const response = await failureResponse(new Error("boom"));
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(registered).toEqual([{ revalidate: FAILURE_REVALIDATE_SECONDS, tags: [FAILURE_TAG] }]);
    expect(FAILURE_REVALIDATE_SECONDS).toBe(1);
    expect(revalidateTag).not.toHaveBeenCalled(); // not before the response is sent
    expect(afterTasks).toHaveLength(1);
    // Expired twice, each time after the entry could have been written (an expiry counts against older entries only).
    vi.useFakeTimers();
    const done = afterTasks[0]!();
    await vi.advanceTimersByTimeAsync(39);
    expect(revalidateTag).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith([FAILURE_TAG]);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(revalidateTag).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("never throws itself: a cache that cannot register or expire still answers the 500", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.doMock("next/cache", () => ({
      unstable_cache: () => () => Promise.reject(new Error("cache down")),
    }));
    vi.doMock("next/server", () => ({ after: () => {} }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { failureResponse } = await import("@/lib/tenant-render/failure");
    const response = await failureResponse(new Error("boom"));
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalled();
  });

  it("does nothing special in development, where nothing is cached", async () => {
    vi.resetModules();
    const registered: unknown[] = [];
    vi.doMock("next/cache", () => ({ unstable_cache: () => registered.push(1) }));
    vi.doMock("next/server", () => ({ after: () => registered.push(2) }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { failureResponse } = await import("@/lib/tenant-render/failure");
    expect((await failureResponse(new Error("x"))).status).toBe(500);
    expect(registered).toEqual([]);
  });
});
