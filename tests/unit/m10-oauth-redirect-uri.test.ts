import { describe, expect, it } from "vitest";
import {
  LOOPBACK_LABEL,
  MAX_REDIRECT_URIS,
  isLoopbackOnly,
  matchesAnyRedirectUri,
  parseRedirectUri,
  redirectHostLabel,
  redirectUriMatches,
  validateRedirectUriList,
} from "@/lib/oauth/redirect-uri";

/**
 * M10-06: which redirect URIs a client may declare, register or ask for, and when a requested one
 * matches. One rule for every kind of client; exact match with the one RFC 8252 loopback-port
 * exception. Both directions of every case.
 */

const ACCEPTED = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chatgpt.com/connector/oauth/abc123",
  "https://a.example/cb",
  "https://A.example/cb",
  "https://a.example:8443/cb?x=1&y=2",
  "https://a.example",
  "https://xn--bcher-kva.example/cb",
  "https://127.0.0.1.evil.example/cb",
  "http://localhost/callback",
  "http://localhost:3118/callback",
  "http://127.0.0.1/callback",
  "http://127.0.0.1:51234/callback",
  "http://[::1]/callback",
  "http://[::1]:8080/callback",
];

const REFUSED: Array<[string, string]> = [
  ["cursor://x", "bad_scheme"],
  ["vscode://x", "bad_scheme"],
  ["com.example.app:/cb", "bad_scheme"],
  ["javascript:alert(1)", "bad_scheme"],
  ["data:text/html,hi", "bad_scheme"],
  ["file:///etc/passwd", "bad_scheme"],
  ["ftp://a.example/cb", "bad_scheme"],
  ["HTTPS://a.example/cb", "bad_scheme"],
  ["//a.example/cb", "bad_scheme"],
  ["/cb", "bad_scheme"],
  ["http://example.com/cb", "bad_scheme"],
  ["http://192.168.1.5/cb", "bad_scheme"],
  ["http://10.0.0.1/cb", "bad_scheme"],
  ["http://0x7f.0.0.1/cb", "bad_scheme"],
  ["http://2130706433/cb", "bad_scheme"],
  ["http://LOCALHOST/cb", "bad_scheme"],
  ["http://localhost.evil.example/cb", "bad_scheme"],
  ["http://127.0.0.1.evil.example:51234/callback", "bad_scheme"],
  ["http://0x7f.0.0.1:51234/callback", "bad_scheme"],
  ["http://127.0.0.1@evil.example/callback", "userinfo"],
  ["https://127.0.0.1/cb", "bad_host"],
  ["https://localhost/cb", "bad_host"],
  ["https://[::1]/cb", "bad_host"],
  ["https://intranet/cb", "bad_host"],
  ["https://2130706433/cb", "bad_host"],
  ["https://0x7f.0.0.1/cb", "bad_host"],
  ["https://-a.example/cb", "bad_host"],
  ["https://a..example/cb", "bad_host"],
  ["https:///cb", "bad_host"],
  ["https://a.example/cb#x", "fragment"],
  ["https://a.example/cb#", "fragment"],
  ["https://user:pw@a.example/cb", "userinfo"],
  ["https://a.example@evil.example/cb", "userinfo"],
  ["https://a.example/cb*", "forbidden_character"],
  ["https://*.example/cb", "forbidden_character"],
  ["https://a.example/c b", "forbidden_character"],
  ["https://a.example/c\tb", "forbidden_character"],
  ["https://a.example/cb\n", "forbidden_character"],
  ["https://a.example\\cb", "forbidden_character"],
  ["https://a.example/c\u0000b", "forbidden_character"],
  ["https://bücher.example/cb", "not_ascii"],
  ["https://a.example/cb/é", "not_ascii"],
  ["https://a.example:0/cb", "bad_port"],
  ["https://a.example:65536/cb", "bad_port"],
  ["https://a.example:08/cb", "bad_port"],
  ["https://a.example:abc/cb", "bad_port"],
  ["http://localhost:0/cb", "bad_port"],
  ["http://localhost:65536/cb", "bad_port"],
  ["https://a.example/cb/../x", "bad_path"],
  ["https://a.example/./cb", "bad_path"],
  ["https://a.example/%2e%2e/cb", "bad_path"],
  ["https://a.example/%2E/cb", "bad_path"],
  ["", "too_long"],
];

describe("M10-06 parseRedirectUri", () => {
  it.each(ACCEPTED)("accepts %s", (uri) => {
    const parsed = parseRedirectUri(uri);
    expect(parsed.ok).toBe(true);
  });

  it.each(REFUSED)("refuses %j (%s)", (uri, reason) => {
    const parsed = parseRedirectUri(uri);
    expect(parsed).toEqual({ ok: false, reason });
  });

  it("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 5, {}, [], ["https://a.example/cb"], true]) {
      expect(parseRedirectUri(value)).toEqual({ ok: false, reason: "not_a_string" });
    }
  });

  it("refuses a URI of 2,049 characters and accepts one of 2,048", () => {
    const base = "https://a.example/";
    expect(parseRedirectUri(base + "a".repeat(2048 - base.length)).ok).toBe(true);
    expect(parseRedirectUri(base + "a".repeat(2049 - base.length))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("reads the host and port as written, not as a URL parser would normalize them", () => {
    expect(parseRedirectUri("https://A.example:8443/cb?x=1")).toMatchObject({
      ok: true,
      scheme: "https",
      host: "A.example",
      port: 8443,
      rest: "/cb?x=1",
      loopback: false,
    });
    expect(parseRedirectUri("http://[::1]:8080/cb")).toMatchObject({
      host: "[::1]",
      port: 8080,
      loopback: true,
    });
    expect(parseRedirectUri("http://localhost/callback")).toMatchObject({
      host: "localhost",
      port: null,
      loopback: true,
    });
  });
});

describe("M10-06 redirectUriMatches: exact", () => {
  const registered = "https://a.example/cb";

  it("matches the same string", () => {
    expect(redirectUriMatches(registered, registered)).toBe(true);
    expect(
      redirectUriMatches(
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/api/mcp/auth_callback",
      ),
    ).toBe(true);
  });

  it.each([
    "https://a.example/cb/",
    "https://a.example/cb?x=1",
    "https://a.example.evil.example/cb",
    "https://evil.example/cb#https://a.example/cb",
    "https://a.example@evil.example/cb",
    "https://a.example/cb/../x",
    "https://A.example/cb",
    "https://a.example:443/cb",
    "http://a.example/cb",
    "https://a.example/%63b",
    "https://a.example/CB",
    "https://a.example/cb ",
    "https://a.example",
    "https://b.example/cb",
    "",
  ])("%j is a mismatch", (requested) => {
    expect(redirectUriMatches(registered, requested)).toBe(false);
  });

  it("matches a registered Claude callback only with that exact string", () => {
    const claude = "https://claude.ai/api/mcp/auth_callback";
    expect(redirectUriMatches(claude, "https://claude.ai/api/mcp/auth_callback/")).toBe(false);
    expect(redirectUriMatches(claude, "https://claude.ai/api/mcp/auth_callback?code=1")).toBe(
      false,
    );
    expect(redirectUriMatches(claude, "https://www.claude.ai/api/mcp/auth_callback")).toBe(false);
  });

  it("a query parameter added, removed or reordered is a mismatch", () => {
    expect(redirectUriMatches("https://a.example/cb?x=1&y=2", "https://a.example/cb?y=2&x=1")).toBe(
      false,
    );
    expect(redirectUriMatches("https://a.example/cb?x=1", "https://a.example/cb")).toBe(false);
    expect(redirectUriMatches("https://a.example/cb", "https://a.example/cb?x=1")).toBe(false);
    expect(redirectUriMatches("https://a.example/cb?x=1", "https://a.example/cb?x=1")).toBe(true);
  });

  it("never matches a requested URI that is not a valid redirect URI, even if it equals the registered string", () => {
    expect(redirectUriMatches("cursor://x", "cursor://x")).toBe(false);
    expect(redirectUriMatches("javascript:alert(1)", "javascript:alert(1)")).toBe(false);
    expect(redirectUriMatches("http://example.com/cb", "http://example.com/cb")).toBe(false);
  });

  it("refuses non-strings", () => {
    expect(redirectUriMatches(registered, undefined as unknown as string)).toBe(false);
    expect(redirectUriMatches(undefined as unknown as string, registered)).toBe(false);
  });
});

describe("M10-06 redirectUriMatches: the loopback port", () => {
  it("a registered loopback URI without a port matches any port from 1 to 65535", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const registered = `http://${host}/callback`;
      for (const port of [1, 80, 3118, 51234, 65535]) {
        expect(redirectUriMatches(registered, `http://${host}:${port}/callback`)).toBe(true);
      }
      expect(redirectUriMatches(registered, `http://${host}/callback`)).toBe(true);
    }
  });

  it("Claude Code's two declared URIs match what it redirects to", () => {
    const declared = ["http://localhost/callback", "http://127.0.0.1/callback"];
    expect(matchesAnyRedirectUri(declared, "http://localhost:51234/callback")).toBe(true);
    expect(matchesAnyRedirectUri(declared, "http://127.0.0.1:3118/callback")).toBe(true);
    expect(matchesAnyRedirectUri(declared, "http://[::1]:3118/callback")).toBe(false);
  });

  it("a registered URI that names a port matches only that port", () => {
    expect(
      redirectUriMatches("http://localhost:3118/callback", "http://localhost:3118/callback"),
    ).toBe(true);
    expect(
      redirectUriMatches("http://localhost:3118/callback", "http://localhost:3119/callback"),
    ).toBe(false);
    expect(redirectUriMatches("http://localhost:3118/callback", "http://localhost/callback")).toBe(
      false,
    );
  });

  it("localhost and 127.0.0.1 never match each other, and the path is still exact", () => {
    expect(redirectUriMatches("http://localhost/callback", "http://127.0.0.1:5000/callback")).toBe(
      false,
    );
    expect(redirectUriMatches("http://127.0.0.1/callback", "http://localhost:5000/callback")).toBe(
      false,
    );
    expect(redirectUriMatches("http://127.0.0.1/callback", "http://[::1]:5000/callback")).toBe(
      false,
    );
    expect(redirectUriMatches("http://localhost/callback", "http://localhost:5000/other")).toBe(
      false,
    );
    expect(redirectUriMatches("http://localhost/callback", "http://localhost:5000/callback/")).toBe(
      false,
    );
    expect(
      redirectUriMatches("http://localhost/callback", "http://localhost:5000/callback?x=1"),
    ).toBe(false);
  });

  it.each([
    "http://127.0.0.1.evil.example:51234/callback",
    "http://0x7f.0.0.1:51234/callback",
    "http://127.0.0.1@evil.example/callback",
    "http://127.0.0.1:0/callback",
    "http://127.0.0.1:65536/callback",
    "https://127.0.0.1:51234/callback",
    "http://127.0.0.1:51234/callback#x",
  ])("%s is not accepted for a registered 127.0.0.1 URI", (requested) => {
    expect(redirectUriMatches("http://127.0.0.1/callback", requested)).toBe(false);
  });

  it("the port exception never applies to an https URI or to a registered URI that is not loopback", () => {
    expect(redirectUriMatches("https://a.example/cb", "https://a.example:8443/cb")).toBe(false);
    expect(
      redirectUriMatches("https://localhost.example/cb", "https://localhost.example:8443/cb"),
    ).toBe(false);
  });
});

describe("M10-06 the list a client declares", () => {
  it("accepts one to ten distinct valid URIs", () => {
    expect(validateRedirectUriList(["https://a.example/cb"])).toEqual({
      ok: true,
      uris: ["https://a.example/cb"],
    });
    const ten = Array.from({ length: MAX_REDIRECT_URIS }, (_, i) => `https://a.example/cb${i}`);
    expect(validateRedirectUriList(ten)).toEqual({ ok: true, uris: ten });
  });

  it("drops duplicates before counting, so eleven entries with a repeat are ten", () => {
    const ten = Array.from({ length: MAX_REDIRECT_URIS }, (_, i) => `https://a.example/cb${i}`);
    expect(validateRedirectUriList([...ten, ten[0]])).toEqual({ ok: true, uris: ten });
  });

  it("refuses an eleventh distinct URI, an empty list, a non-array and one bad entry", () => {
    const eleven = Array.from(
      { length: MAX_REDIRECT_URIS + 1 },
      (_, i) => `https://a.example/cb${i}`,
    );
    const refusal = { ok: false, reason: "invalid_redirect_uri" };
    expect(validateRedirectUriList(eleven)).toEqual(refusal);
    expect(validateRedirectUriList([])).toEqual(refusal);
    expect(validateRedirectUriList("https://a.example/cb")).toEqual(refusal);
    expect(validateRedirectUriList(undefined)).toEqual(refusal);
    expect(validateRedirectUriList(["https://a.example/cb", "cursor://x"])).toEqual(refusal);
    expect(validateRedirectUriList(["https://a.example/cb", 5])).toEqual(refusal);
  });
});

describe("M10-06 what the consent screen shows", () => {
  it("an https host is shown exactly as stored, punycode included", () => {
    expect(redirectHostLabel("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHostLabel("https://xn--bcher-kva.example/cb")).toBe("xn--bcher-kva.example");
    expect(redirectHostLabel("https://a.example:8443/cb")).toBe("a.example");
  });

  it("a loopback URI is 'this computer (localhost)', whichever spelling", () => {
    for (const uri of ["http://localhost/cb", "http://127.0.0.1:5000/cb", "http://[::1]/cb"]) {
      expect(redirectHostLabel(uri)).toBe(LOOPBACK_LABEL);
    }
    expect(LOOPBACK_LABEL).toBe("this computer (localhost)");
  });

  it("an invalid string has no label", () => {
    expect(redirectHostLabel("cursor://x")).toBe("");
  });

  it("isLoopbackOnly flags a client whose every URI is loopback", () => {
    expect(isLoopbackOnly(["http://localhost/callback", "http://127.0.0.1/callback"])).toBe(true);
    expect(isLoopbackOnly(["http://localhost/callback", "https://a.example/cb"])).toBe(false);
    expect(isLoopbackOnly(["https://a.example/cb"])).toBe(false);
    expect(isLoopbackOnly([])).toBe(false);
  });
});
