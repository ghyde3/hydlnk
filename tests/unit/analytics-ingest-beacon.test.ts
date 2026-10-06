import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBeacon } from "@/lib/analytics/ingest/beacon";
import { DESKTOP_UA, IPHONE_UA, ORIGIN, PAGE_ID, makeDeps, spyOnConsole } from "./analytics-ingest-helpers";

const URL_E = "http://mara.localhost:3000/api/e";

function beacon(
  body: unknown = { pageId: PAGE_ID, referrer: "https://l.instagram.com/?u=x" },
  headers: Record<string, string | null> = {},
  method = "POST",
): Request {
  const merged: Record<string, string> = {
    "user-agent": IPHONE_UA,
    origin: ORIGIN,
    "x-forwarded-for": "203.0.113.7",
    "content-type": "text/plain;charset=UTF-8",
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const init: RequestInit = { method, headers: merged };
  if (method !== "GET" && method !== "HEAD") {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(URL_E, init);
}

afterEach(() => vi.restoreAllMocks());

describe("M4-21 the view beacon records a view", () => {
  it("answers 204 with Cache-Control no-store and no cookie, and inserts one 'view' row", async () => {
    const s = makeDeps();
    const response = await handleBeacon(
      beacon(undefined, { "x-vercel-ip-country": "us" }),
      s.deps,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
    expect(s.inserted).toEqual([
      {
        page_id: PAGE_ID,
        block_id: "",
        type: "view",
        referrer: "l.instagram.com",
        device: "mobile",
        country: "US",
        visitor_hash: "a".repeat(64),
      },
    ]);
    expect(s.visitorHash).toHaveBeenCalledWith({
      ip: "203.0.113.7",
      userAgent: IPHONE_UA,
      now: new Date("2026-10-03T12:00:00Z"),
    });
  });

  it("records the insert inline: the row exists when the 204 is sent", async () => {
    const s = makeDeps();
    await handleBeacon(beacon(), s.deps);
    expect(s.insertEvent).toHaveBeenCalledTimes(1);
    expect(s.scheduled).toHaveLength(0);
  });

  it("device is desktop for desktop Chrome, country null without the header, referrer null when direct", async () => {
    const s = makeDeps();
    await handleBeacon(beacon({ pageId: PAGE_ID, referrer: "" }, { "user-agent": DESKTOP_UA }), s.deps);
    expect(s.inserted[0]).toMatchObject({ device: "desktop", country: null, referrer: null });
  });

  it("the page's own host and a non-http referrer become null", async () => {
    const s = makeDeps();
    await handleBeacon(beacon({ pageId: PAGE_ID, referrer: "http://mara.localhost:3000/x" }), s.deps);
    await handleBeacon(beacon({ pageId: PAGE_ID, referrer: "android-app://com.x" }), s.deps);
    expect(s.inserted.map((row) => row.referrer)).toEqual([null, null]);
  });

  it("uses 0.0.0.0 for the hash when no IP header is present", async () => {
    const s = makeDeps();
    await handleBeacon(beacon(undefined, { "x-forwarded-for": null }), s.deps);
    expect(s.visitorHash.mock.calls[0]![0].ip).toBe("0.0.0.0");
  });

  it("accepts a verified custom host as the origin", async () => {
    const s = makeDeps({ rootDomain: "hydlnk.com" });
    await handleBeacon(beacon(undefined, { origin: "https://links.example.test" }), s.deps);
    expect(s.inserted).toHaveLength(1);
  });

  it("takes the page id case-insensitively and stores it lower-case", async () => {
    const s = makeDeps();
    await handleBeacon(beacon({ pageId: PAGE_ID.toUpperCase() }), s.deps);
    expect(s.inserted[0]!.page_id).toBe(PAGE_ID);
  });
});

describe("M4-21 everything ignored answers the same 204 and inserts nothing (no oracle)", () => {
  const ignored: Array<[string, () => Request]> = [
    ["an unknown page id", () => beacon({ pageId: "00000000-0000-4000-8000-0000000000ff" })],
    ["a malformed page id", () => beacon({ pageId: "not-a-uuid" })],
    ["a page id that is not a string", () => beacon({ pageId: 7 })],
    ["no page id", () => beacon({ referrer: "" })],
    ["a body that is not JSON", () => beacon("not json {")],
    ["a JSON array", () => beacon("[1,2]")],
    ["an empty body", () => beacon("")],
    ["an Origin that is not the page's", () => beacon(undefined, { origin: "https://evil.example" })],
    ["another handle's origin", () => beacon(undefined, { origin: "http://other.localhost:3000" })],
    ["a missing Origin", () => beacon(undefined, { origin: null })],
    ["a bot user agent", () => beacon(undefined, { "user-agent": "Googlebot/2.1" })],
    ["a missing user agent", () => beacon(undefined, { "user-agent": null })],
  ];

  it.each(ignored)("%s", async (_name, make) => {
    const s = makeDeps();
    const reference = await handleBeacon(beacon(), makeDeps().deps);
    const response = await handleBeacon(make(), s.deps);
    expect(response.status).toBe(204);
    expect([...response.headers.entries()].sort()).toEqual([...reference.headers.entries()].sort());
    expect(s.insertEvent).not.toHaveBeenCalled();
  });

  it("a page that is not published or is suspended (the lookup says null)", async () => {
    const s = makeDeps({ lookupBeaconPage: vi.fn(async () => null) });
    const response = await handleBeacon(beacon(), s.deps);
    expect(response.status).toBe(204);
    expect(s.insertEvent).not.toHaveBeenCalled();
  });
});

describe("M4-21 size", () => {
  it("a body over 2 KB returns 413 and inserts nothing", async () => {
    const s = makeDeps();
    const big = JSON.stringify({ pageId: PAGE_ID, referrer: "x".repeat(2100) });
    const response = await handleBeacon(beacon(big), s.deps);
    expect(response.status).toBe(413);
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(s.lookupBeaconPage).not.toHaveBeenCalled();
  });

  it("a streamed body over 2 KB with no Content-Length is cut off at 413 too", async () => {
    const s = makeDeps();
    const chunk = new TextEncoder().encode("x".repeat(1500));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(URL_E, {
      method: "POST",
      headers: { "user-agent": IPHONE_UA, origin: ORIGIN },
      body: stream,
      // @ts-expect-error duplex is required by Node for a streamed body
      duplex: "half",
    });
    const response = await handleBeacon(request, s.deps);
    expect(response.status).toBe(413);
    expect(s.insertEvent).not.toHaveBeenCalled();
  });

  it("a declared Content-Length over 2 KB is refused before the body is read", async () => {
    const s = makeDeps();
    const response = await handleBeacon(
      beacon(undefined, { "content-length": "999999" }),
      s.deps,
    );
    expect(response.status).toBe(413);
  });

  it("a body of exactly 2 KB is accepted", async () => {
    const s = makeDeps();
    const base = JSON.stringify({ pageId: PAGE_ID, referrer: "" });
    const padded = JSON.stringify({ pageId: PAGE_ID, referrer: "https://a.example/" + "x".repeat(2048 - base.length - 21) });
    expect(new TextEncoder().encode(padded).length).toBeLessThanOrEqual(2048);
    const response = await handleBeacon(beacon(padded), s.deps);
    expect(response.status).toBe(204);
    expect(s.insertEvent).toHaveBeenCalledTimes(1);
  });
});

describe("M4-23 methods", () => {
  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])("%s answers 405 and inserts nothing", async (method) => {
    const s = makeDeps();
    const response = await handleBeacon(beacon(undefined, {}, method), s.deps);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(s.lookupBeaconPage).not.toHaveBeenCalled();
  });
});

describe("M5-01 the limit runs first and counts every request", () => {
  it("is 120 per 60 seconds, keyed by the client IP and namespaced 'beacon:'", async () => {
    const s = makeDeps();
    await handleBeacon(beacon(), s.deps);
    expect(s.rateLimit).toHaveBeenCalledWith("beacon:203.0.113.7", 120, 60);
  });

  it("a blocked request gets 429 with Retry-After, and no lookup, no body read, no insert", async () => {
    const s = makeDeps({ rateLimit: vi.fn(async () => ({ allowed: false, retryAfter: 17 })) });
    const response = await handleBeacon(beacon(), s.deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(s.lookupBeaconPage).not.toHaveBeenCalled();
    expect(s.visitorHash).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed body", () => beacon("{{{")],
    ["a bot", () => beacon(undefined, { "user-agent": "curl/8.4.0" })],
    ["a HEAD request", () => beacon(undefined, {}, "HEAD")],
    ["a GET request", () => beacon(undefined, {}, "GET")],
    ["an oversized body", () => beacon("x".repeat(5000))],
    ["a forged origin", () => beacon(undefined, { origin: "https://evil.example" })],
  ])("%s is counted too", async (_name, make) => {
    const s = makeDeps();
    await handleBeacon(make(), s.deps);
    expect(s.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("the key is the platform client IP, never a value from the body", async () => {
    const s = makeDeps();
    await handleBeacon(
      beacon({ pageId: PAGE_ID, ip: "9.9.9.9", key: "x", "x-forwarded-for": "9.9.9.9" }),
      s.deps,
    );
    expect(s.rateLimit.mock.calls[0]![0]).toBe("beacon:203.0.113.7");
  });

  it("a request with no client-IP header lands in the shared 'unknown' bucket", async () => {
    const s = makeDeps();
    await handleBeacon(beacon(undefined, { "x-forwarded-for": null }), s.deps);
    expect(s.rateLimit.mock.calls[0]![0]).toBe("beacon:unknown");
  });

  it("two IPs are two buckets", async () => {
    const s = makeDeps();
    await handleBeacon(beacon(undefined, { "x-forwarded-for": "198.51.100.9" }), s.deps);
    await handleBeacon(beacon(), s.deps);
    expect(s.rateLimit.mock.calls.map((c) => c[0])).toEqual(["beacon:198.51.100.9", "beacon:203.0.113.7"]);
  });
});

describe("M4-21 a database failure never breaks a page view", () => {
  it("an insert error is logged (the message only) and the beacon still answers 204", async () => {
    const log = spyOnConsole();
    const s = makeDeps({
      insertEvent: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });
    const response = await handleBeacon(beacon(), s.deps);
    expect(response.status).toBe(204);
    expect(log.text()).toContain("connection refused");
    log.restore();
  });

  it("a lookup error is logged and answers 204 with nothing recorded", async () => {
    const log = spyOnConsole();
    const s = makeDeps({
      lookupBeaconPage: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    const response = await handleBeacon(beacon(), s.deps);
    expect(response.status).toBe(204);
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(log.text()).toContain("timeout");
    log.restore();
  });
});

describe("M4-20 the raw IP and user agent are never logged", () => {
  it("in no outcome of the handler, errors included", async () => {
    const log = spyOnConsole();
    const failing = makeDeps({
      insertEvent: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    });
    await handleBeacon(beacon(), failing.deps);
    await handleBeacon(beacon(undefined, { "user-agent": "curl/8.4.0" }), makeDeps().deps);
    await handleBeacon(beacon("garbage"), makeDeps().deps);
    await handleBeacon(
      beacon(),
      makeDeps({ rateLimit: vi.fn(async () => ({ allowed: false, retryAfter: 3 })) }).deps,
    );
    const logged = log.text();
    expect(logged).not.toContain("203.0.113.7");
    expect(logged).not.toContain("iPhone");
    expect(logged).not.toContain("curl/8.4.0");
    log.restore();
  });
});
