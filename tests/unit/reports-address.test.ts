import { describe, expect, it } from "vitest";
import { handleAddress, parseReportAddress } from "@/lib/reports";

/** M5-05: what the address field of the report form means. */
const handle = (h: string) => ({ kind: "handle", handle: h });
const domain = (d: string) => ({ kind: "domain", hostname: d });

describe("M5-05 report address", () => {
  describe.each([["localhost:3000"], ["hydlnk.com"]])("on root domain %s", (root) => {
    it.each([
      ["mara.hydlnk.com", handle("mara")],
      ["MARA.HYDLNK.COM", handle("mara")],
      ["mara.hydlnk.com.", handle("mara")],
      ["https://mara.hydlnk.com", handle("mara")],
      ["http://mara.hydlnk.com/links?x=1#top", handle("mara")],
      ["  https://user:pw@mara.hydlnk.com:8443/x  ", handle("mara")],
      ["mara", handle("mara")],
      ["zq-a-b1", handle("zq-a-b1")],
      ["links.example.com", domain("links.example.com")],
      ["https://Links.Example.com/x", domain("links.example.com")],
      ["links.example.com.:443", domain("links.example.com")],
    ])("%s", (text, expected) => {
      expect(parseReportAddress(text, root)).toEqual(expected);
    });

    it.each([
      "",
      "   ",
      "hydlnk.com",
      "www.hydlnk.com",
      "app.hydlnk.com",
      "a.b.hydlnk.com",
      "https://",
      "ma",
      "-bad-",
      "not a host",
      "javascript:alert(1)",
      "x".repeat(300),
      "bad_host.example.com",
      "exa mple.com",
      "a..b.com",
    ])("does not name a page: %j", (text) => {
      expect(parseReportAddress(text, root)).toBeNull();
    });
  });

  it("on a dev machine the root domain's own handle addresses work too", () => {
    expect(parseReportAddress("mara.localhost:3000", "localhost:3000")).toEqual(handle("mara"));
    expect(parseReportAddress("http://mara.localhost:3000/", "localhost:3000")).toEqual(
      handle("mara"),
    );
    expect(parseReportAddress("localhost:3000", "localhost:3000")).toBeNull();
    expect(parseReportAddress("app.localhost:3000", "localhost:3000")).toBeNull();
    // In production "mara.localhost:3000" is just some other host: a domain lookup that finds nothing.
    expect(parseReportAddress("mara.localhost:3000", "hydlnk.com")).toEqual(
      domain("mara.localhost"),
    );
  });

  it("handleAddress is brand copy, whatever the host", () => {
    expect(handleAddress("mara")).toBe("mara.hydlnk.com");
  });
});
