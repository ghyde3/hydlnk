import { describe, expect, it } from "vitest";
import { isAppRequestUrl } from "@/lib/sentry/filter";
import { createBeforeSend, createBeforeSendTransaction } from "@/lib/sentry/hooks";
import { requestUrlOf } from "@/lib/sentry/server";

/**
 * M9-10 scope: Sentry reports the app host only. A server event whose request URL is not on the app
 * host, or whose path starts with /t/, /sites/, /r/, /api/e, /media/ or /_t/, is dropped by
 * beforeSend (and its transaction by beforeSendTransaction).
 */

const ROOT = "hydlnk.com";
const LOCAL = "localhost:3000";

const KEPT: Array<[string, string, string]> = [
  ["the editor", "https://app.hydlnk.com/editor", ROOT],
  ["the design screen with a query", "https://app.hydlnk.com/design?tab=colors", ROOT],
  ["an app API route", "https://app.hydlnk.com/api/pages", ROOT],
  ["the domains poll", "https://app.hydlnk.com/api/domains/abc", ROOT],
  ["a server action's page", "https://app.hydlnk.com/settings", ROOT],
  ["a path that only starts like an excluded one (/api/editor...)", "https://app.hydlnk.com/api/editor", ROOT],
  ["the same host in capitals and with a trailing dot", "https://APP.HYDLNK.COM./editor", ROOT],
  ["local development", "http://app.localhost:3000/editor", LOCAL],
  ["local sign-in", "http://app.localhost:3000/login?next=/editor", LOCAL],
];

const DROPPED: Array<[string, string, string]> = [
  ["the marketing site", "https://hydlnk.com/", ROOT],
  ["a marketing page", "https://hydlnk.com/pricing", ROOT],
  ["www", "https://www.hydlnk.com/", ROOT],
  ["a tenant subdomain", "https://mara.hydlnk.com/", ROOT],
  ["a tenant page by path", "https://mara.hydlnk.com/t/mara", ROOT],
  ["a custom domain", "https://links.example.com/", ROOT],
  ["a deployment host", "https://hydlnk-abc.vercel.app/", ROOT],
  ["the app host's look-alike", "https://app.hydlnk.com.evil.test/editor", ROOT],
  ["another root's app host", "https://app.example.com/editor", ROOT],
  ["/t/ on the app host", "https://app.hydlnk.com/t/mara", ROOT],
  ["/sites/ on the app host", "https://app.hydlnk.com/sites/abc", ROOT],
  ["/r/ the click redirect", "https://app.hydlnk.com/r/page/block", ROOT],
  ["/api/e the beacon", "https://app.hydlnk.com/api/e", ROOT],
  ["/api/e with a query", "https://app.hydlnk.com/api/e?x=1", ROOT],
  ["/api/e/ with more", "https://app.hydlnk.com/api/e/x", ROOT],
  ["/media/", "https://app.hydlnk.com/media/u/f.webp", ROOT],
  ["/_t/ the tenant assets", "https://app.hydlnk.com/_t/p.abc.js", ROOT],
  ["the local marketing site", "http://localhost:3000/", LOCAL],
  ["the local tenant", "http://mara.localhost:3000/", LOCAL],
  ["the local app host with a wrong port", "http://app.localhost:3001/editor", LOCAL],
  ["not an address", "mara", ROOT],
  ["a non-http scheme", "ftp://app.hydlnk.com/editor", ROOT],
  ["empty", "", ROOT],
];

describe("M9-10 isAppRequestUrl", () => {
  it.each(KEPT)("keeps %s", (_label, url, root) => {
    expect(isAppRequestUrl(url, root)).toBe(true);
  });

  it.each(DROPPED)("drops %s", (_label, url, root) => {
    expect(isAppRequestUrl(url, root)).toBe(false);
  });

  it("drops an event with no address, a non-string address and a missing root domain", () => {
    expect(isAppRequestUrl(undefined, ROOT)).toBe(false);
    expect(isAppRequestUrl(null, ROOT)).toBe(false);
    expect(isAppRequestUrl(42, ROOT)).toBe(false);
    expect(isAppRequestUrl("https://app.hydlnk.com/editor", undefined)).toBe(false);
    expect(isAppRequestUrl("https://app.hydlnk.com/editor", "")).toBe(false);
  });
});

describe("M9-10 beforeSend and beforeSendTransaction", () => {
  const beforeSend = createBeforeSend({ rootDomain: ROOT });
  const beforeSendTransaction = createBeforeSendTransaction({ rootDomain: ROOT });

  it.each(DROPPED)("an error event about %s is dropped", (_label, url, root) => {
    const hook = createBeforeSend({ rootDomain: root });
    expect(hook({ message: "x", request: { url } })).toBeNull();
    expect(createBeforeSendTransaction({ rootDomain: root })({ type: "transaction", request: { url } })).toBeNull();
  });

  it.each(KEPT)("an error event about %s is kept, scrubbed and without its query string", (_label, url, root) => {
    const out = createBeforeSend({ rootDomain: root })({ message: "owner gary@example.com", request: { url, headers: { Cookie: "x" } } })!;
    expect(out).not.toBeNull();
    expect(out.message).toBe("owner [email]");
    expect(out.request).toEqual({ url: url.split("?")[0] });
  });

  it("an event with no request at all is dropped (it cannot be told apart from a tenant's)", () => {
    expect(beforeSend({ message: "x" })).toBeNull();
    expect(beforeSend({ message: "x", request: {} })).toBeNull();
    expect(beforeSendTransaction({ type: "transaction" })).toBeNull();
  });

  it("the filter reads the raw address first: a tenant address is dropped even though scrubbing would rewrite it", () => {
    expect(beforeSend({ request: { url: "https://mara.hydlnk.com/t/mara?code=1" } })).toBeNull();
  });

  it("a kept transaction has every span scrubbed", () => {
    const out = beforeSendTransaction({
      type: "transaction",
      transaction: "GET /app/api/pages",
      request: { url: "https://app.hydlnk.com/api/pages?x=1" },
      spans: [{ op: "http.client", description: "GET https://x.supabase.co/rest/v1/pages?handle=eq.mara&email=eq.gary%40example.com" }],
    } as never) as unknown as { spans: Array<{ description: string }> };
    expect(out.spans[0]!.description).toBe("GET https://x.supabase.co/rest/v1/pages");
  });
});

describe("M9-10 the address of a server request error", () => {
  it("is built from the Host header and the path without its query string", () => {
    expect(requestUrlOf({ path: "/editor?x=1", method: "GET", headers: { host: "app.hydlnk.com" } }, ROOT)).toBe("https://app.hydlnk.com/editor");
    expect(requestUrlOf({ path: "/editor", method: "POST", headers: { host: "app.localhost:3000" } }, LOCAL)).toBe("http://app.localhost:3000/editor");
    expect(requestUrlOf({ path: "/t/mara", method: "GET", headers: { host: "mara.hydlnk.com", "x-forwarded-host": "mara.hydlnk.com" } }, ROOT)).toBe("https://mara.hydlnk.com/t/mara");
  });

  it("prefers the forwarded host, and has none when the request names no host", () => {
    expect(requestUrlOf({ path: "/a", method: "GET", headers: { host: "internal", "x-forwarded-host": ["app.hydlnk.com"] } }, ROOT)).toBe("https://app.hydlnk.com/a");
    expect(requestUrlOf({ path: "/a", method: "GET", headers: {} }, ROOT)).toBeUndefined();
  });

  it("the address it builds is judged by the same filter", () => {
    for (const [host, kept] of [["app.hydlnk.com", true], ["mara.hydlnk.com", false], ["hydlnk.com", false], ["links.example.com", false]] as const) {
      const url = requestUrlOf({ path: "/x", method: "GET", headers: { host } }, ROOT);
      expect(isAppRequestUrl(url, ROOT), host).toBe(kept);
    }
  });
});
