import { describe, expect, it } from "vitest";
import { countryFromHeaders } from "@/lib/analytics/ingest/country";
import { deviceFromUserAgent } from "@/lib/analytics/ingest/device";
import { allowedOriginHost } from "@/lib/analytics/ingest/origin";
import { referrerHost } from "@/lib/analytics/ingest/referrer";
import { findLinkUrl, locationFor } from "@/lib/analytics/ingest/target";
import { blocks, fullPublished } from "./fixtures/page-document";

describe("M4-21 device", () => {
  it.each([
    [
      "iPhone Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "mobile",
    ],
    [
      "iPad Safari",
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "tablet",
    ],
    [
      "Android phone Chrome",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      "mobile",
    ],
    [
      "Android tablet Chrome (no Mobile token)",
      "Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "tablet",
    ],
    [
      "desktop Chrome",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "desktop",
    ],
    ["unmatched", "SomethingElse/1.0", "desktop"],
    ["empty", "", "desktop"],
  ])("%s is %s", (_name, ua, expected) => {
    expect(deviceFromUserAgent(ua)).toBe(expected);
  });
  it("null and undefined are desktop", () => {
    expect(deviceFromUserAgent(null)).toBe("desktop");
    expect(deviceFromUserAgent(undefined)).toBe("desktop");
  });
});

describe("M4-21 country comes from x-vercel-ip-country only", () => {
  const h = (value?: string) => new Headers(value === undefined ? {} : { "x-vercel-ip-country": value });
  it("two letters, upper-cased", () => {
    expect(countryFromHeaders(h("US"))).toBe("US");
    expect(countryFromHeaders(h("de"))).toBe("DE");
    expect(countryFromHeaders(h(" gb "))).toBe("GB");
  });
  it("anything else is null", () => {
    expect(countryFromHeaders(h())).toBeNull();
    expect(countryFromHeaders(h(""))).toBeNull();
    expect(countryFromHeaders(h("USA"))).toBeNull();
    expect(countryFromHeaders(h("U1"))).toBeNull();
    expect(countryFromHeaders(h("<script>"))).toBeNull();
  });
  it("no other header is consulted", () => {
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "FR", "accept-language": "de-DE" }))).toBeNull();
  });
});

describe("M4-21 referrer", () => {
  it.each([
    ["https://l.instagram.com/?u=x", "l.instagram.com"],
    ["https://www.Example.COM/path/to?token=secret#frag", "example.com"],
    ["http://t.co/abc", "t.co"],
    ["https://news.ycombinator.com:8443/item?id=1", "news.ycombinator.com"],
  ])("%s becomes %s", (raw, expected) => {
    expect(referrerHost(raw)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "not a url",
    "ftp://example.com/x",
    "javascript:alert(1)",
    "data:text/html,x",
    "android-app://com.google.android.gm",
    "x".repeat(3000),
  ])("%j becomes null", (raw) => {
    expect(referrerHost(raw)).toBeNull();
  });

  it("non-strings become null", () => {
    expect(referrerHost(undefined)).toBeNull();
    expect(referrerHost(null)).toBeNull();
    expect(referrerHost(42)).toBeNull();
    expect(referrerHost({ href: "https://example.com" })).toBeNull();
  });

  it("the page's own host becomes null, port and www aside", () => {
    expect(referrerHost("http://mara.localhost:3000/x", ["mara.localhost"])).toBeNull();
    expect(referrerHost("https://www.links.example.test/", ["links.example.test"])).toBeNull();
    expect(referrerHost("https://other.example/", ["mara.localhost"])).toBe("other.example");
  });
});

describe("M4-21 who may report a view", () => {
  const rules = (rootDomain: string) => ({
    handle: "mara",
    customHosts: ["links.example.test"],
    rootDomain,
  });
  it("the page's own tenant origin, in dev and in production", () => {
    expect(allowedOriginHost("http://mara.localhost:3000", rules("localhost:3000"))).toBe("mara.localhost");
    expect(allowedOriginHost("https://mara.hydlnk.com", rules("hydlnk.com"))).toBe("mara.hydlnk.com");
  });
  it("one of its verified custom hosts", () => {
    expect(allowedOriginHost("https://links.example.test", rules("hydlnk.com"))).toBe("links.example.test");
    // Local development serves custom hosts over http on the dev port.
    expect(allowedOriginHost("http://links.example.test:3000", rules("localhost:3000"))).toBe(
      "links.example.test",
    );
  });
  it.each([
    ["missing", null],
    ["empty", ""],
    ["another site", "https://evil.example"],
    ["another handle", "http://other.localhost:3000"],
    ["the root host", "http://localhost:3000"],
    ["the app host", "http://app.localhost:3000"],
    ["a path", "http://mara.localhost:3000/"],
    ["credentials", "http://mara.localhost:3000@evil.example"],
    ["a wrong port", "http://mara.localhost:3001"],
    ["https in dev", "https://mara.localhost:3000"],
    ["the string null", "null"],
    ["a lookalike suffix", "http://mara.localhost:3000.evil.example"],
    ["an unverified custom host", "http://unverified.example.test:3000"],
  ])("%s is refused", (_name, origin) => {
    expect(allowedOriginHost(origin, rules("localhost:3000"))).toBeNull();
  });
  it("http is refused in production, and so is a non-default port on a custom host", () => {
    expect(allowedOriginHost("http://mara.hydlnk.com", rules("hydlnk.com"))).toBeNull();
    expect(allowedOriginHost("http://links.example.test", rules("hydlnk.com"))).toBeNull();
    expect(allowedOriginHost("https://links.example.test:8443", rules("hydlnk.com"))).toBeNull();
  });
});

describe("M4-22 the target of a link", () => {
  it("is the url under a link, card or image block id, a social icon id or a grid cell id", () => {
    expect(findLinkUrl(fullPublished, blocks.link.id)).toBe("https://maraokafor.com/book/portraits");
    expect(findLinkUrl(fullPublished, blocks.card.id)).toBe("https://maraokafor.com/night-market");
    expect(findLinkUrl(fullPublished, blocks.image.id)).toBe("https://maraokafor.com/studio");
    expect(findLinkUrl(fullPublished, "icon-instagram")).toBe("https://instagram.com/maraokafor");
    expect(findLinkUrl(fullPublished, "cell-prints-01")).toBe("https://maraokafor.com/prints");
    expect(findLinkUrl(fullPublished, "cell-works-001")).toBe("https://maraokafor.com/workshops");
  });

  it("is null for ids that are not links", () => {
    for (const id of [
      blocks.text.id,
      blocks.header.id,
      blocks.divider.id,
      blocks.embed.id,
      blocks.social.id,
      blocks.grid.id,
      "icon-email-001",
      "no-such-id",
      "",
    ]) {
      expect(findLinkUrl(fullPublished, id), id).toBeNull();
    }
  });

  it("is null for a link whose url is not plain http(s), whatever the document says", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "ftp://x.test/", ""]) {
      const doc = {
        ...fullPublished,
        blocks: [{ ...blocks.link, url: bad }],
      };
      expect(findLinkUrl(doc, blocks.link.id), bad).toBeNull();
    }
  });

  it("an image block without a link has no target", () => {
    const { url: _unused, ...withoutUrl } = blocks.image;
    void _unused;
    expect(findLinkUrl({ ...fullPublished, blocks: [withoutUrl] }, blocks.image.id)).toBeNull();
  });

  it("the Location is the published string exactly, re-serialised only when it is not Latin-1", () => {
    expect(locationFor("https://example.com")).toBe("https://example.com");
    expect(locationFor("https://example.com/book?a=1&b=2#x")).toBe("https://example.com/book?a=1&b=2#x");
    expect(locationFor("https://example.com/café")).toBe("https://example.com/caf%C3%A9");
  });
});
