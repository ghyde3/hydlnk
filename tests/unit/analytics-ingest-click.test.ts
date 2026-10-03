import { afterEach, describe, expect, it, vi } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { BLOCK_ID, DESKTOP_UA, IPHONE_UA, PAGE_ID, makeDeps, spyOnConsole } from "./analytics-ingest-helpers";

function click(
  headers: Record<string, string | null> = {},
  method = "GET",
  query = "",
): Request {
  const merged: Record<string, string> = {
    host: "mara.localhost:3000",
    "user-agent": IPHONE_UA,
    "x-forwarded-for": "203.0.113.7",
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${BLOCK_ID}${query}`, {
    method,
    headers: merged,
  });
}

const params = { pageId: PAGE_ID, blockId: BLOCK_ID };

afterEach(() => vi.restoreAllMocks());

describe("M4-22 the click redirect", () => {
  it("answers 302 with Location exactly the published URL, no-store and no cookie", async () => {
    const s = makeDeps();
    const response = await handleClick(click(), params, s.deps);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/book");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(s.resolveClickTarget).toHaveBeenCalledWith(PAGE_ID, BLOCK_ID);
  });

  it("is never a 301, 307 or 308", async () => {
    const response = await handleClick(click(), params, makeDeps().deps);
    expect([301, 307, 308]).not.toContain(response.status);
  });

  it("records one 'click' row AFTER the response, through the scheduler", async () => {
    const s = makeDeps();
    const response = await handleClick(click({ "x-vercel-ip-country": "de" }), params, s.deps);
    expect(response.status).toBe(302);
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(s.scheduled).toHaveLength(1);
    await s.flush();
    expect(s.inserted).toEqual([
      {
        page_id: PAGE_ID,
        block_id: BLOCK_ID,
        type: "click",
        referrer: null,
        device: "mobile",
        country: "DE",
        visitor_hash: "a".repeat(64),
      },
    ]);
  });

  it("an insert error inside the scheduled task is caught and logged, and the redirect was already 302", async () => {
    const log = spyOnConsole();
    const s = makeDeps({
      insertEvent: vi.fn(async () => {
        throw new Error("database is down");
      }),
    });
    const response = await handleClick(click(), params, s.deps);
    expect(response.status).toBe(302);
    await expect(s.flush()).resolves.toBeUndefined();
    expect(log.text()).toContain("database is down");
    log.restore();
  });

  it("the redirect does not wait for the insert (a slow insert only delays the scheduled task)", async () => {
    let release: () => void = () => undefined;
    const slowInsert = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const s = makeDeps({ insertEvent: slowInsert });
    const response = await handleClick(click(), params, s.deps);
    expect(response.status).toBe(302);
    expect(slowInsert).not.toHaveBeenCalled();
    const flushed = s.flush();
    expect(slowInsert).toHaveBeenCalledTimes(1);
    release();
    await flushed;
  });

  it("the uppercase form of the page id is looked up lower-case", async () => {
    const s = makeDeps();
    await handleClick(click(), { pageId: PAGE_ID.toUpperCase(), blockId: BLOCK_ID }, s.deps);
    expect(s.resolveClickTarget).toHaveBeenCalledWith(PAGE_ID, BLOCK_ID);
  });
});

describe("M4-22 open redirect and unknown targets", () => {
  it.each([
    "?url=https://evil.example",
    "?to=https://evil.example",
    "?redirect=https://evil.example",
    "?next=https://evil.example",
    "?u=//evil.example&target=javascript:alert(1)",
  ])("%s never changes Location", async (query) => {
    const s = makeDeps();
    const response = await handleClick(click({}, "GET", query), params, s.deps);
    expect(response.headers.get("location")).toBe("https://example.com/book");
    expect(s.resolveClickTarget).toHaveBeenCalledWith(PAGE_ID, BLOCK_ID);
  });

  it("X-Forwarded-Host and Referer never change Location or the host that is checked", async () => {
    const s = makeDeps();
    const response = await handleClick(
      click({ "x-forwarded-host": "evil.example", referer: "https://evil.example/" }),
      params,
      s.deps,
    );
    expect(response.headers.get("location")).toBe("https://example.com/book");
    const forged = await handleClick(
      click({ host: "evil.example", "x-forwarded-host": "mara.localhost:3000" }),
      params,
      makeDeps().deps,
    );
    expect(forged.status).toBe(404);
    expect(forged.headers.get("location")).toBeNull();
  });

  it("an unknown or non-link id (the lookup says null) is a 404 with no Location and no insert", async () => {
    const s = makeDeps();
    const response = await handleClick(click(), { pageId: PAGE_ID, blockId: "nosuchblock1" }, s.deps);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(s.scheduled).toHaveLength(0);
    expect(s.insertEvent).not.toHaveBeenCalled();
  });

  it("an unknown page id is a 404", async () => {
    const s = makeDeps();
    const response = await handleClick(
      click(),
      { pageId: "00000000-0000-4000-8000-0000000000ff", blockId: BLOCK_ID },
      s.deps,
    );
    expect(response.status).toBe(404);
  });

  it("a database error while loading the target is a 503, never a redirect", async () => {
    const log = spyOnConsole();
    const s = makeDeps({
      resolveClickTarget: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const response = await handleClick(click(), params, s.deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(s.scheduled).toHaveLength(0);
    log.restore();
  });

  it.each([
    ["a pageId that is not a uuid", { pageId: "not-a-uuid", blockId: BLOCK_ID }],
    ["a pageId with a path in it", { pageId: "../../etc", blockId: BLOCK_ID }],
    ["an empty blockId", { pageId: PAGE_ID, blockId: "" }],
    ["a blockId with a dot", { pageId: PAGE_ID, blockId: "block.id.1" }],
    ["a blockId with a space", { pageId: PAGE_ID, blockId: "block id 1" }],
    ["a blockId over 64 characters", { pageId: PAGE_ID, blockId: "a".repeat(65) }],
    ["a blockId with a slash", { pageId: PAGE_ID, blockId: "a/b" }],
    ["a blockId with an encoded newline", { pageId: PAGE_ID, blockId: "abc\n" }],
  ])("%s is a 404 without touching the limiter, the database or the scheduler", async (_name, bad) => {
    const s = makeDeps();
    const response = await handleClick(click(), bad, s.deps);
    expect(response.status).toBe(404);
    expect(s.rateLimit).not.toHaveBeenCalled();
    expect(s.resolveClickTarget).not.toHaveBeenCalled();
    expect(s.scheduled).toHaveLength(0);
  });

  it("a blockId of 64 characters passes the shape check", async () => {
    const s = makeDeps();
    await handleClick(click(), { pageId: PAGE_ID, blockId: "a".repeat(64) }, s.deps);
    expect(s.resolveClickTarget).toHaveBeenCalledTimes(1);
  });
});

describe("M4-22 the click is served only on the page's own hosts", () => {
  async function on(host: string | null, method = "GET") {
    const s = makeDeps();
    const response = await handleClick(click({ host }, method), params, s.deps);
    return { s, response };
  }

  it.each([
    ["the page's own handle host", "mara.localhost:3000"],
    ["the same host in upper case", "MARA.localhost:3000"],
    ["the same host with a trailing dot", "mara.localhost.:3000"],
    ["the same host with another port", "mara.localhost:8080"],
    ["a verified custom host of the page", "links.example.test"],
    ["a verified custom host with a port, a dot and capitals", "Links.Example.test.:443"],
  ])("302s on %s", async (_name, host) => {
    const { response } = await on(host);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/book");
  });

  it.each([
    ["another tenant's handle host", "victim.localhost:3000"],
    ["another verified custom domain", "victim.example.test"],
    ["the marketing host", "localhost:3000"],
    ["the app host", "app.localhost:3000"],
    ["www", "www.localhost:3000"],
    ["a host that merely ends with the page's host", "evil-mara.localhost:3000"],
    ["a host that merely starts with the custom host", "links.example.test.evil.example"],
    ["a deployment host", "hydlnk-abc.vercel.app"],
    ["no Host header at all", null],
    ["an empty Host header", ""],
  ])("404s on %s, with no Location, no insert and no scheduled task", async (_name, host) => {
    const { s, response } = await on(host);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(s.scheduled).toHaveLength(0);
    expect(s.insertEvent).not.toHaveBeenCalled();
  });

  it("a HEAD on a foreign host is a 404 without a body", async () => {
    const { response } = await on("victim.example.test", "HEAD");
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });

  it("a page with no verified custom host answers only on its handle host", async () => {
    const s = makeDeps({
      resolveClickTarget: vi.fn(async () => ({ url: "https://example.com/book", handle: "mara", customHosts: [] })),
    });
    const own = await handleClick(click(), params, s.deps);
    const foreign = await handleClick(click({ host: "links.example.test" }), params, s.deps);
    expect(own.status).toBe(302);
    expect(foreign.status).toBe(404);
  });
});

describe("M4-23 cross-site clicks", () => {
  it.each([["document"], [null]])("a Sec-Fetch-Dest of %s is recorded", async (dest) => {
    const s = makeDeps();
    const response = await handleClick(click({ "sec-fetch-dest": dest }), params, s.deps);
    expect(response.status).toBe(302);
    expect(s.scheduled).toHaveLength(1);
  });

  it.each([["image"], ["script"], ["iframe"], ["empty"], ["style"], ["embed"], ["Image"]])(
    "a Sec-Fetch-Dest of %s still redirects but records nothing",
    async (dest) => {
      const s = makeDeps();
      const response = await handleClick(click({ "sec-fetch-dest": dest }), params, s.deps);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://example.com/book");
      expect(s.scheduled).toHaveLength(0);
      expect(s.insertEvent).not.toHaveBeenCalled();
    },
  );

  it("a Sec-Fetch-Dest of DOCUMENT in capitals is treated as document", async () => {
    const s = makeDeps();
    await handleClick(click({ "sec-fetch-dest": "Document" }), params, s.deps);
    expect(s.scheduled).toHaveLength(1);
  });
});

describe("M4-23 bots and HEAD", () => {
  it("a bot still gets the 302 to the published URL but leaves no event", async () => {
    const s = makeDeps();
    const response = await handleClick(click({ "user-agent": "Slackbot-LinkExpanding 1.0" }), params, s.deps);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/book");
    expect(s.scheduled).toHaveLength(0);
    expect(s.insertEvent).not.toHaveBeenCalled();
  });

  it("a request with no user agent is a bot", async () => {
    const s = makeDeps();
    const response = await handleClick(click({ "user-agent": null }), params, s.deps);
    expect(response.status).toBe(302);
    expect(s.scheduled).toHaveLength(0);
  });

  it("HEAD answers the same status and Location with no body, and records nothing", async () => {
    const s = makeDeps();
    const get = await handleClick(click({ "user-agent": DESKTOP_UA }), params, makeDeps().deps);
    const head = await handleClick(click({ "user-agent": DESKTOP_UA }, "HEAD"), params, s.deps);
    expect(head.status).toBe(get.status);
    expect(head.headers.get("location")).toBe(get.headers.get("location"));
    expect(head.body).toBeNull();
    expect(s.scheduled).toHaveLength(0);
    expect(s.insertEvent).not.toHaveBeenCalled();
  });
});

describe("M5-02 the limit", () => {
  it("is 60 per 60 seconds per client, one bucket for every page and block, namespaced 'click:'", async () => {
    const s = makeDeps();
    await handleClick(click(), params, s.deps);
    await handleClick(click(), { pageId: PAGE_ID, blockId: "another-block-1" }, s.deps);
    expect(s.rateLimit.mock.calls).toEqual([
      ["click:203.0.113.7", 60, 60],
      ["click:203.0.113.7", 60, 60],
    ]);
  });

  it("a blocked request is a 429 with Retry-After, no Location, the message, and no lookup or insert", async () => {
    const s = makeDeps({ rateLimit: vi.fn(async () => ({ allowed: false, retryAfter: 42 })) });
    const response = await handleClick(click(), params, s.deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    const html = await response.text();
    expect(html).toContain("Too many clicks from your network. Try again in a minute.");
    expect(s.resolveClickTarget).not.toHaveBeenCalled();
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(s.scheduled).toHaveLength(0);
  });

  it("the 429 page speaks HYDLNK: --hl- tokens, no tenant token, a 44px link, no horizontal overflow rule", async () => {
    const s = makeDeps({ rateLimit: vi.fn(async () => ({ allowed: false, retryAfter: 1 })) });
    const html = await (await handleClick(click(), params, s.deps)).text();
    expect(html).toMatch(/--hl-page:/);
    expect(html).toMatch(/var\(--hl-/);
    expect(html).not.toMatch(/--t-/);
    expect(html).toMatch(/min-height:\s*44px/);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('href="http://localhost:3000/"');
  });

  it("a blocked HEAD has no body", async () => {
    const s = makeDeps({ rateLimit: vi.fn(async () => ({ allowed: false, retryAfter: 5 })) });
    const response = await handleClick(click({}, "HEAD"), params, s.deps);
    expect(response.status).toBe(429);
    expect(response.body).toBeNull();
  });

  it("a request with no client-IP header lands in the shared 'unknown' bucket", async () => {
    const s = makeDeps();
    await handleClick(click({ "x-forwarded-for": null }), params, s.deps);
    expect(s.rateLimit.mock.calls[0]![0]).toBe("click:unknown");
  });

  it("the key is never taken from the query string", async () => {
    const s = makeDeps();
    await handleClick(click({}, "GET", "?ip=9.9.9.9&key=x"), params, s.deps);
    expect(s.rateLimit.mock.calls[0]![0]).toBe("click:203.0.113.7");
  });

  it("a bot request is counted too (the limit runs before anything else)", async () => {
    const s = makeDeps();
    await handleClick(click({ "user-agent": "curl/8.4.0" }), params, s.deps);
    expect(s.rateLimit).toHaveBeenCalledTimes(1);
  });
});

describe("M4-20 the raw IP and user agent are never logged", () => {
  it("whatever the outcome", async () => {
    const log = spyOnConsole();
    const failing = makeDeps({
      insertEvent: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    });
    await handleClick(click(), params, failing.deps);
    await failing.flush();
    await handleClick(
      click(),
      params,
      makeDeps({
        resolveClickTarget: vi.fn(async () => {
          throw new Error("lookup failed");
        }),
      }).deps,
    );
    const logged = log.text();
    expect(logged).not.toContain("203.0.113.7");
    expect(logged).not.toContain("iPhone");
    log.restore();
  });
});
