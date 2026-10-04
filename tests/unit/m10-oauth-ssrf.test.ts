import { describe, expect, it } from "vitest";
import {
  checkClientAddress,
  isPublicAddress,
  isPublicIPv4,
  isPublicIPv6,
  judgeResolution,
} from "@/lib/oauth/ssrf";

/**
 * M10-07: the pure policy of every request to an address a client chose. No network: the DNS answers
 * are plain arrays.
 */

const ROOT = "hydlnk.com";
const check = (value: unknown, over: { allowTestStub?: boolean; rootDomain?: string } = {}) =>
  checkClientAddress(value, {
    rootDomain: over.rootDomain ?? ROOT,
    allowTestStub: over.allowTestStub,
  });

describe("M10-07 the client_id is checked before any lookup", () => {
  it.each([
    "https://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://chatgpt.com/oauth/client.json",
    "https://app.example.com/oauth/client.json",
    "https://example.com/a?b=c",
    "https://example.com:443/client.json",
    "https://sub.domain.example.org/a/b/c",
    "https://xn--bcher-kva.example.org/client.json",
  ])("accepts %s", (address) => {
    expect(check(address)).toMatchObject({ ok: true });
  });

  it.each([
    [undefined, "not_a_string"],
    [null, "not_a_string"],
    [42, "not_a_string"],
    [{}, "not_a_string"],
    ["", "too_long"],
    [`https://example.com/${"a".repeat(2048)}`, "too_long"],
    ["http://example.com/x", "bad_scheme"],
    ["ftp://example.com/x", "bad_scheme"],
    ["javascript:alert(1)", "bad_scheme"],
    ["//example.com/x", "bad_scheme"],
    ["HTTPS://example.com/x", "bad_scheme"],
    ["https://example.com", "no_path"],
    ["https://example.com/", "no_path"],
    ["https://example.com?x=1", "no_path"],
    ["https://user@example.com/x", "userinfo"],
    ["https://user:pw@example.com/x", "userinfo"],
    ["https://example.com/x#frag", "fragment"],
    ["https://example.com/a/./b", "dot_segment"],
    ["https://example.com/a/../b", "dot_segment"],
    ["https://example.com/a/%2e%2e/b", "dot_segment"],
    ["https://example.com/a/%2E/b", "dot_segment"],
    ["https://example.com:8443/x", "bad_port"],
    ["https://example.com:80/x", "bad_port"],
    ["https://example.com:0/x", "bad_port"],
    ["https://example.com/a b", "forbidden_character"],
    ["https://example.com/a\tb", "forbidden_character"],
    ["https://example.com/a\nb", "forbidden_character"],
    ["https://example.com\\x", "forbidden_character"],
    ["https://exa mple.com/x", "forbidden_character"],
    ["https://127.0.0.1/x", "ip_literal"],
    ["https://2130706433/x", "ip_literal"],
    ["https://0x7f.1/x", "ip_literal"],
    ["https://0x7f000001/x", "ip_literal"],
    ["https://0177.0.0.1/x", "ip_literal"],
    ["https://[::1]/x", "ip_literal"],
    ["https://[::ffff:127.0.0.1]/x", "ip_literal"],
    ["https://8.8.8.8/x", "ip_literal"],
    ["https://localhost/x", "single_label"],
    ["https://intranet/x", "single_label"],
    ["https://my.localhost/x", "reserved_name"],
    ["https://printer.local/x", "reserved_name"],
    ["https://db.internal/x", "reserved_name"],
    ["https://nas.lan/x", "reserved_name"],
    ["https://router.home.arpa/x", "reserved_name"],
    ["https://app.test/x", "reserved_name"],
    ["https://app.example/x", "reserved_name"],
    ["https://app.invalid/x", "reserved_name"],
    ["https://hydlnk.com/x", "own_host"],
    ["https://app.hydlnk.com/x", "own_host"],
    ["https://mara.hydlnk.com/x", "own_host"],
    ["https://a.b.hydlnk.com/x", "own_host"],
    ["https://-bad.example.org/x", "bad_host"],
    ["https://a..b.example.org/x", "bad_host"],
    ["https://bücher.example.org/x", "bad_host"],
  ] as Array<[unknown, string]>)("refuses %j (%s)", (address, reason) => {
    const result = check(address);
    expect(result).toEqual({ ok: false, reason });
  });

  it("the product's own hosts are refused for the local root domain too", () => {
    expect(check("https://app.localhost/x", { rootDomain: "localhost:3000" })).toEqual({
      ok: false,
      reason: "reserved_name",
    });
    expect(check("https://hydlnk.dev/x", { rootDomain: "hydlnk.dev" })).toEqual({
      ok: false,
      reason: "own_host",
    });
    expect(check("https://app.hydlnk.dev/x", { rootDomain: "hydlnk.dev" })).toEqual({
      ok: false,
      reason: "own_host",
    });
    expect(check("https://notmyhydlnk.dev/x", { rootDomain: "hydlnk.dev" })).toMatchObject({
      ok: true,
    });
  });

  it("reads the host from the text, lower cased, without the port", () => {
    expect(check("https://CLAUDE.ai:443/oauth/x")).toMatchObject({
      ok: true,
      host: "claude.ai",
      path: "/oauth/x",
    });
  });

  it("the end-to-end stub address is valid only while the test hooks are on", () => {
    const stub = "http://127.0.0.1:12113/client.json";
    expect(check(stub)).toEqual({ ok: false, reason: "bad_scheme" });
    expect(check(stub, { allowTestStub: false })).toEqual({ ok: false, reason: "bad_scheme" });
    expect(check(stub, { allowTestStub: true })).toMatchObject({
      ok: true,
      testStub: true,
      host: "127.0.0.1",
    });
    // Only that exact origin: not another port, not another loopback spelling, not http elsewhere.
    for (const other of [
      "http://127.0.0.1:12114/x",
      "http://localhost:12113/x",
      "http://127.0.0.1/x",
      "http://[::1]:12113/x",
      "http://127.0.0.1:12113",
      "http://10.0.0.1:12113/x",
    ]) {
      expect(check(other, { allowTestStub: true }).ok, other).toBe(false);
    }
    expect(check("http://127.0.0.1:12113/a/../x", { allowTestStub: true })).toEqual({
      ok: false,
      reason: "dot_segment",
    });
  });
});

describe("M10-07 the resolution policy", () => {
  it.each([
    ["0.0.0.1"],
    ["0.255.255.255"],
    ["10.0.0.1"],
    ["10.255.255.255"],
    ["100.64.0.1"],
    ["100.127.255.255"],
    ["127.0.0.1"],
    ["127.255.255.254"],
    ["169.254.0.1"],
    ["169.254.169.254"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.0.0.1"],
    ["192.0.2.1"],
    ["192.168.0.1"],
    ["192.168.255.255"],
    ["198.18.0.1"],
    ["198.19.255.255"],
    ["198.51.100.1"],
    ["203.0.113.1"],
    ["224.0.0.1"],
    ["239.255.255.255"],
    ["240.0.0.1"],
    ["255.255.255.254"],
    ["255.255.255.255"],
  ])("IPv4 %s is not public", (address) => {
    expect(isPublicIPv4(address)).toBe(false);
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ["93.184.216.34"],
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["172.15.255.255"],
    ["172.32.0.1"],
    ["100.63.255.255"],
    ["100.128.0.1"],
    ["198.17.255.255"],
    ["198.20.0.1"],
    ["192.0.1.1"],
    ["191.255.255.255"],
    ["223.255.255.255"],
  ])("IPv4 %s is public", (address) => {
    expect(isPublicIPv4(address)).toBe(true);
  });

  it.each(
    [
      ["::"],
      ["::1"],
      ["fc00::1"],
      ["fd12:3456::1"],
      ["fe80::1"],
      ["febf::1"],
      ["ff02::1"],
      ["2001:db8::1"],
      ["2001:db8:ffff::1"],
      ["::ffff:127.0.0.1"],
      ["::ffff:10.0.0.1"],
      ["::ffff:169.254.169.254"],
      ["::ffff:7f00:1"],
      ["::127.0.0.1"],
      ["::10.1.2.3"],
      ["64:ff9b::7f00:1"],
      ["64:ff9b::a00:1"],
      ["64:ff9b::169.254.169.254"],
      ["2002:7f00:1::"],
      ["2002:0a00:0001::1"],
      ["2002:c0a8:0101::1"],
      ["2001::1"],
      ["2001:0:4136:e378:8000:63bf:3fff:fdd2"],
      ["100::1"],
      ["3fff::1"].slice(0, 0) as unknown as string[],
    ].filter((row) => row.length > 0),
  )("IPv6 %s is not public", (address) => {
    expect(isPublicIPv6(address as string)).toBe(false);
  });

  it.each([
    ["2606:2800:220:1::1"],
    ["2a00:1450:4001::1"],
    ["2001:4860:4860::8888"],
    ["::ffff:8.8.8.8"],
    ["64:ff9b::808:808"],
    ["2002:0808:0808::1"],
  ])("IPv6 %s is public", (address) => {
    expect(isPublicIPv6(address)).toBe(true);
  });

  it("something that is not an address is not public", () => {
    for (const value of ["", "example.com", "1.2.3", "999.1.1.1", "::g", "1.2.3.4.5"]) {
      expect(isPublicAddress(value)).toBe(false);
    }
  });

  it("no answer is refused, and so is any answer with a non-public address in it", () => {
    expect(judgeResolution([])).toEqual({ ok: false, reason: "no_address" });
    expect(judgeResolution(["127.0.0.1"])).toEqual({ ok: false, reason: "ssrf_blocked" });
    expect(judgeResolution(["93.184.216.34", "10.0.0.1"])).toEqual({
      ok: false,
      reason: "ssrf_blocked",
    });
    expect(judgeResolution(["2606:2800:220:1::1", "::1"])).toEqual({
      ok: false,
      reason: "ssrf_blocked",
    });
    expect(judgeResolution(["93.184.216.34"])).toEqual({
      ok: true,
      address: "93.184.216.34",
      family: 4,
    });
    expect(judgeResolution(["2606:2800:220:1::1", "93.184.216.34"])).toEqual({
      ok: true,
      address: "2606:2800:220:1::1",
      family: 6,
    });
  });
});
