import { describe, expect, it } from "vitest";
import { classifyHost } from "@/lib/routing/host";

const PROD = "hydlnk.com";
const LOCAL = "localhost:3000";

describe("classifyHost, production root (hydlnk.com)", () => {
  it.each([
    ["the root host", "hydlnk.com"],
    ["the root host in upper case", "HYDLNK.COM"],
    ["the root host as a fully qualified name", "hydlnk.com."],
    ["surrounding whitespace", "  hydlnk.com  "],
  ])("classifies %s as marketing", (_label, host) => {
    expect(classifyHost(host, PROD)).toEqual({ kind: "marketing" });
  });

  it("classifies www as a redirect to the root", () => {
    expect(classifyHost("www.hydlnk.com", PROD)).toEqual({ kind: "www" });
  });

  it("classifies app as the editor", () => {
    expect(classifyHost("app.hydlnk.com", PROD)).toEqual({ kind: "app" });
  });

  it.each([
    ["mara.hydlnk.com", "mara"],
    ["my-brand.hydlnk.com", "my-brand"],
    ["abc.hydlnk.com", "abc"],
    ["a1b.hydlnk.com", "a1b"],
    ["0123456789.hydlnk.com", "0123456789"],
    [`${"a".repeat(30)}.hydlnk.com`, "a".repeat(30)],
    ["MARA.HYDLNK.COM", "mara"],
    ["mara.hydlnk.com.", "mara"],
  ])("classifies %s as the tenant %s", (host, handle) => {
    expect(classifyHost(host, PROD)).toEqual({ kind: "tenant", handle });
  });

  it.each([
    ["too short (2 chars)", "ab.hydlnk.com"],
    ["too short (1 char)", "a.hydlnk.com"],
    ["too long (31 chars)", `${"a".repeat(31)}.hydlnk.com`],
    ["leading hyphen", "-mara.hydlnk.com"],
    ["trailing hyphen", "mara-.hydlnk.com"],
    ["underscore", "ma_ra.hydlnk.com"],
    ["unicode letter", "mára.hydlnk.com"],
    ["empty label", ".hydlnk.com"],
  ])("does not treat an invalid handle (%s) as a tenant", (_label, host) => {
    expect(classifyHost(host, PROD)).toEqual({ kind: "custom" });
  });

  it.each([
    ["a.b.hydlnk.com"],
    ["mara.app.hydlnk.com"],
    ["x.mara.hydlnk.com"],
    ["a.b.c.hydlnk.com"],
    ["www.www.hydlnk.com"],
    ["app.app.hydlnk.com"],
  ])("treats the nested subdomain %s as a custom host, not a tenant", (host) => {
    expect(classifyHost(host, PROD)).toEqual({ kind: "custom" });
  });

  it.each([
    ["hydlnk-abc123.vercel.app"],
    ["hydlnk-git-m0-setup-ghyde3s-projects.vercel.app"],
    ["HYDLNK-ABC123.VERCEL.APP"],
  ])("serves the Vercel deployment host %s as marketing", (host) => {
    // A *.vercel.app host must never reach the custom-domain lookup.
    expect(classifyHost(host, PROD)).toEqual({ kind: "marketing" });
  });

  it.each([["links.example.com"], ["example.com"], ["www.example.com"], ["mara.example.com"]])(
    "sends the custom domain %s to the domain lookup",
    (host) => {
      expect(classifyHost(host, PROD)).toEqual({ kind: "custom" });
    },
  );

  it.each([
    ["hydlnk.com.evil.example"],
    ["evilhydlnk.com"],
    ["mara.evilhydlnk.com"],
    ["hydlnk.co"],
    ["hydlnk.com:3000"],
  ])("does not mistake the lookalike %s for the root domain or a tenant", (host) => {
    expect(classifyHost(host, PROD)).toEqual({ kind: "custom" });
  });

  it.each([["127.0.0.1:3000"], ["[::1]:3000"], ["0.0.0.0:3000"]])(
    "does not treat the loopback address %s as the root in production",
    (host) => {
      expect(classifyHost(host, PROD)).toEqual({ kind: "custom" });
    },
  );

  it("sends an empty host, or an empty root, to the domain lookup", () => {
    expect(classifyHost("", PROD)).toEqual({ kind: "custom" });
    expect(classifyHost("   ", PROD)).toEqual({ kind: "custom" });
    expect(classifyHost("hydlnk.com", "")).toEqual({ kind: "custom" });
  });
});

describe("classifyHost, local root (localhost:3000)", () => {
  it("classifies the root host with its port as marketing", () => {
    expect(classifyHost("localhost:3000", LOCAL)).toEqual({ kind: "marketing" });
  });

  it("classifies www.localhost:3000 as a redirect to the root", () => {
    expect(classifyHost("www.localhost:3000", LOCAL)).toEqual({ kind: "www" });
  });

  it("classifies app.localhost:3000 as the editor", () => {
    expect(classifyHost("app.localhost:3000", LOCAL)).toEqual({ kind: "app" });
  });

  it.each([
    ["mara.localhost:3000", "mara"],
    ["MARA.localhost:3000", "mara"],
    ["my-brand.localhost:3000", "my-brand"],
  ])("classifies %s as the tenant %s", (host, handle) => {
    expect(classifyHost(host, LOCAL)).toEqual({ kind: "tenant", handle });
  });

  it.each([["127.0.0.1:3000"], ["[::1]:3000"], ["0.0.0.0:3000"]])(
    "treats the loopback address %s as the root host",
    (host) => {
      expect(classifyHost(host, LOCAL)).toEqual({ kind: "marketing" });
    },
  );

  it.each([
    ["localhost"],
    ["localhost:3001"],
    ["localhost:80"],
    ["app.localhost"],
    ["app.localhost:3001"],
    ["mara.localhost"],
    ["mara.localhost:3001"],
    ["127.0.0.1:3001"],
    ["127.0.0.1"],
    ["app.127.0.0.1:3000"],
  ])("does not match %s when the port or host differs from the root", (host) => {
    expect(classifyHost(host, LOCAL)).toEqual({ kind: "custom" });
  });

  it.each([["ab.localhost:3000"], ["a.b.localhost:3000"], ["mara.app.localhost:3000"]])(
    "does not treat %s as a tenant (invalid handle or nested subdomain)",
    (host) => {
      expect(classifyHost(host, LOCAL)).toEqual({ kind: "custom" });
    },
  );

  it("serves a Vercel deployment host as marketing whatever the root domain is", () => {
    expect(classifyHost("hydlnk-abc123.vercel.app", LOCAL)).toEqual({ kind: "marketing" });
  });

  it("returns a handle only for tenants", () => {
    for (const host of ["localhost:3000", "app.localhost:3000", "www.localhost:3000", "x.test"]) {
      expect(classifyHost(host, LOCAL)).not.toHaveProperty("handle");
    }
  });
});
