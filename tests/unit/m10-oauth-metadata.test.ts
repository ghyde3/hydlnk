import { describe, expect, it, vi } from "vitest";
import {
  authorizationServerMetadata,
  connectPageUrl,
  issuerFor,
  mcpResourceUrl,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from "@/lib/oauth/metadata";

vi.mock("server-only", () => ({}));

/**
 * M10-03: the two discovery documents, built from the root domain and nothing else.
 */

const PROD = "hydlnk.com";
const LOCAL = "localhost:3000";

describe("M10-03 issuer and resource", () => {
  it("the issuer is the app origin, no trailing slash", () => {
    expect(issuerFor(PROD)).toBe("https://app.hydlnk.com");
    expect(issuerFor(LOCAL)).toBe("http://app.localhost:3000");
  });

  it("the resource is the issuer plus /mcp, what a person types into Claude or ChatGPT", () => {
    expect(mcpResourceUrl(PROD)).toBe("https://app.hydlnk.com/mcp");
    expect(mcpResourceUrl(LOCAL)).toBe("http://app.localhost:3000/mcp");
  });

  it("the 401 challenge points at the path-insertion form of the metadata", () => {
    expect(protectedResourceMetadataUrl(PROD)).toBe(
      "https://app.hydlnk.com/.well-known/oauth-protected-resource/mcp",
    );
    expect(protectedResourceMetadataUrl(LOCAL)).toBe(
      "http://app.localhost:3000/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("the documentation address is the marketing /connect page", () => {
    expect(connectPageUrl(PROD)).toBe("https://hydlnk.com/connect");
    expect(connectPageUrl(LOCAL)).toBe("http://localhost:3000/connect");
  });
});

describe("M10-03 authorization server metadata", () => {
  const document = authorizationServerMetadata(PROD);

  it("has exactly these members, no more", () => {
    expect(Object.keys(document).sort()).toEqual(
      [
        "issuer",
        "authorization_endpoint",
        "token_endpoint",
        "registration_endpoint",
        "revocation_endpoint",
        "scopes_supported",
        "response_types_supported",
        "response_modes_supported",
        "grant_types_supported",
        "code_challenge_methods_supported",
        "token_endpoint_auth_methods_supported",
        "revocation_endpoint_auth_methods_supported",
        "client_id_metadata_document_supported",
        "authorization_response_iss_parameter_supported",
        "service_documentation",
      ].sort(),
    );
  });

  it("holds the values of the spec", () => {
    expect(document).toEqual({
      issuer: "https://app.hydlnk.com",
      authorization_endpoint: "https://app.hydlnk.com/oauth/authorize",
      token_endpoint: "https://app.hydlnk.com/oauth/token",
      registration_endpoint: "https://app.hydlnk.com/oauth/register",
      revocation_endpoint: "https://app.hydlnk.com/oauth/revoke",
      scopes_supported: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: "https://hydlnk.com/connect",
    });
  });

  it("every endpoint sits under the issuer and is https for the production root", () => {
    const issuer = document.issuer as string;
    for (const name of [
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
      "revocation_endpoint",
    ]) {
      const value = document[name] as string;
      expect(value.startsWith(`${issuer}/`)).toBe(true);
      expect(value.startsWith("https://")).toBe(true);
    }
  });

  it("builds the same shape for the local root, all under http://app.localhost:3000", () => {
    const local = authorizationServerMetadata(LOCAL);
    expect(local.issuer).toBe("http://app.localhost:3000");
    expect(local.token_endpoint).toBe("http://app.localhost:3000/oauth/token");
    expect(local.service_documentation).toBe("http://localhost:3000/connect");
  });

  it("names no jwks, userinfo or introspection endpoint and no offline_access scope", () => {
    for (const name of ["jwks_uri", "userinfo_endpoint", "introspection_endpoint"]) {
      expect(document).not.toHaveProperty(name);
    }
    expect(document.scopes_supported).not.toContain("offline_access");
  });

  /*
   * Two members clients depend on (vendor documents read on 2026-10-04):
   *  - Claude uses a Client ID Metadata Document only when the metadata advertises BOTH
   *    client_id_metadata_document_supported: true AND 'none' in token_endpoint_auth_methods_supported,
   *    otherwise it falls back to Dynamic Client Registration
   *    (claude.com/docs/connectors/building/authentication).
   *  - ChatGPT refuses a server whose metadata lacks code_challenge_methods_supported: ['S256'] or
   *    authorization_response_iss_parameter_supported: true (developers.openai.com/apps-sdk/build/auth).
   */
  it("advertises what Claude needs to use a metadata document", () => {
    expect(document.client_id_metadata_document_supported).toBe(true);
    expect(document.token_endpoint_auth_methods_supported).toContain("none");
  });

  it("advertises what ChatGPT needs", () => {
    expect(document.code_challenge_methods_supported).toEqual(["S256"]);
    expect(document.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe("M10-03 protected resource metadata", () => {
  const document = protectedResourceMetadata(PROD);

  it("has the members of RFC 9728 the spec lists", () => {
    expect(document).toEqual({
      resource: "https://app.hydlnk.com/mcp",
      authorization_servers: ["https://app.hydlnk.com"],
      scopes_supported: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
      bearer_methods_supported: ["header"],
      resource_name: "HYDLNK",
      resource_documentation: "https://hydlnk.com/connect",
    });
  });

  it("names one authorization server, and the resource equals the URL a person types", () => {
    expect((document.authorization_servers as string[]).length).toBe(1);
    expect(document.resource).toBe(mcpResourceUrl(PROD));
  });

  it("builds for the local root too", () => {
    expect(protectedResourceMetadata(LOCAL).resource).toBe("http://app.localhost:3000/mcp");
    expect(protectedResourceMetadata(LOCAL).authorization_servers).toEqual([
      "http://app.localhost:3000",
    ]);
  });
});

describe("M10-03 nothing secret or local leaks into a production document", () => {
  const text = JSON.stringify([authorizationServerMetadata(PROD), protectedResourceMetadata(PROD)]);

  it("names no localhost, Supabase address or key", () => {
    expect(text).not.toMatch(/localhost/i);
    expect(text).not.toMatch(/supabase/i);
    expect(text).not.toMatch(/sb_/);
    expect(text).not.toMatch(/eyJ[\w-]{10,}/);
  });

  it("names no host but the app host and the root host", () => {
    const hosts = new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((match) => match[1]));
    expect([...hosts].sort()).toEqual(["app.hydlnk.com", "hydlnk.com"]);
  });
});
