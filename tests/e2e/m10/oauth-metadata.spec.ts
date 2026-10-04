import { expect, test } from "@playwright/test";
import { desktopOnly } from "../fixtures/data";
import { appRaw, rawRequest } from "../fixtures/http";
import { ISSUER, RESOURCE, ownIp } from "../fixtures/oauth";

/**
 * M10-03: the two discovery documents, over HTTP against the dev server, and every endpoint they name
 * exists. Raw requests with an explicit Host header: no browser, nothing signed in.
 */

const AS_PATH = "/.well-known/oauth-authorization-server";
const PR_PATHS = [
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-protected-resource",
];

test.describe("M10-03 authorization server metadata", () => {
  test("the document has exactly the members of the spec and names only the app origin", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const res = await appRaw(AS_PATH);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toMatch(/^application\/json/);
    const doc = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(
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
    expect(doc).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      revocation_endpoint: `${ISSUER}/oauth/revoke`,
      scopes_supported: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: "http://localhost:3000/connect",
    });
    // The issuer is the origin the document was fetched from, no trailing slash (RFC 8414 section 3.3).
    expect(doc.issuer).toBe("http://app.localhost:3000");
  });

  test("no jwks, userinfo or introspection endpoint, no offline_access, and nothing secret", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const res = await appRaw(AS_PATH);
    for (const name of ["jwks_uri", "userinfo_endpoint", "introspection_endpoint"]) {
      expect(res.body).not.toContain(name);
    }
    expect(res.body).not.toContain("offline_access");
    expect(res.body).not.toMatch(/sb_|eyJ[\w-]{10,}|127\.0\.0\.1/);
  });

  test("openid-configuration is the app's 404, and a sub-path of the document is a 404", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    expect((await appRaw("/.well-known/openid-configuration")).status).toBe(404);
    expect((await appRaw(`${AS_PATH}/mcp`)).status).toBe(404);
    expect((await appRaw("/.well-known")).status).toBe(404);
  });

  test("HEAD and OPTIONS work, the other methods are 405", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const head = await appRaw(AS_PATH, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const options = await appRaw(AS_PATH, {
      method: "OPTIONS",
      headers: { origin: "https://claude.ai" },
    });
    expect([200, 204]).toContain(options.status);
    expect(options.body).toBe("");
    expect(options.headers["access-control-allow-origin"]).toBe("*");
    expect(options.headers["access-control-max-age"]).toBe("86400");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await appRaw(AS_PATH, { method })).status, method).toBe(405);
    }
  });

  test("it is readable from any origin and never allows credentials", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const res = await appRaw(AS_PATH, { headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

test.describe("M10-02 the proxy treats the discovery and endpoint paths as session-free", () => {
  test("a metadata document is cacheable for five minutes and carries the safety headers", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    for (const path of [AS_PATH, ...PR_PATHS]) {
      const res = await appRaw(path);
      expect(res.headers["cache-control"], path).toBe("public, max-age=300");
      expect(res.headers["x-content-type-options"], path).toBe("nosniff");
      expect(res.headers["referrer-policy"], path).toBe("no-referrer");
    }
  });

  test("an endpoint answer is never stored and never carries a cookie", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    for (const path of ["/oauth/token", "/oauth/register", "/oauth/revoke"]) {
      const res = await appRaw(path, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": ownIp(),
        },
        body: "",
      });
      expect(res.headers["cache-control"], path).toContain("no-store");
      expect(res.setCookies, path).toEqual([]);
      expect(res.headers["referrer-policy"], path).toBe("no-referrer");
    }
  });

  test("a session cookie sent along is never read, refreshed or echoed back", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    // A cookie that would make the session helper try a refresh if it ever looked: it must not.
    const cookie = "sb-127-auth-token=base64-bm90LWEtc2Vzc2lvbg";
    for (const path of [AS_PATH, ...PR_PATHS]) {
      const res = await appRaw(path, { cookie });
      expect(res.status, path).toBe(200);
      expect(res.setCookies, path).toEqual([]);
      expect(res.headers["cache-control"], path).toBe("public, max-age=300");
    }
    const token = await appRaw("/oauth/token", {
      method: "POST",
      cookie,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ownIp() },
      body: "",
    });
    expect(token.status).toBe(400);
    expect(token.setCookies).toEqual([]);
  });
});

test.describe("M10-03 protected resource metadata", () => {
  for (const path of PR_PATHS) {
    test(`${path} holds the document of RFC 9728 for the resource at /mcp`, async ({}, info) => {
      test.skip(!desktopOnly(info), "raw HTTP, no UI");
      const res = await appRaw(path);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
        bearer_methods_supported: ["header"],
        resource_name: "HYDLNK",
        resource_documentation: "http://localhost:3000/connect",
      });
    });
  }

  test("another path is a 404, and the methods are as for the other document", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    expect((await appRaw("/.well-known/oauth-protected-resource/other")).status).toBe(404);
    expect((await appRaw(PR_PATHS[0]!, { method: "HEAD" })).status).toBe(200);
    expect((await appRaw(PR_PATHS[0]!, { method: "OPTIONS" })).status).toBeLessThan(300);
    expect((await appRaw(PR_PATHS[0]!, { method: "POST" })).status).toBe(405);
  });
});

test.describe("M10-02 / M10-03 the host header steers nothing", () => {
  const evil = {
    "x-forwarded-host": "evil.example",
    forwarded: "host=evil.example;proto=http",
    "x-forwarded-proto": "http",
  };

  for (const path of [AS_PATH, ...PR_PATHS]) {
    test(`${path} names only the configured origin whatever the forwarding headers say`, async ({}, info) => {
      test.skip(!desktopOnly(info), "raw HTTP, no UI");
      const res = await appRaw(path, { headers: evil });
      expect(res.status).toBe(200);
      expect(res.body).not.toContain("evil.example");
      expect(JSON.parse(res.body)).toMatchObject(
        path === AS_PATH
          ? { issuer: ISSUER }
          : { resource: RESOURCE, authorization_servers: [ISSUER] },
      );
    });
  }
});

test.describe("M10-03 every endpoint the metadata names exists", () => {
  test("authorize answers the 400 error page, token, register and revoke answer a 4xx JSON error to an empty POST", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    const doc = JSON.parse((await appRaw(AS_PATH)).body) as Record<string, string>;
    const path = (value: string) => new URL(value).pathname;

    const authorize = await appRaw(path(doc.authorization_endpoint!), {
      headers: { "x-forwarded-for": ownIp() },
    });
    expect(authorize.status).toBe(400);
    expect(authorize.body).toContain("This sign-in request isn’t valid.");

    for (const key of ["token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
      const res = await appRaw(path(doc[key]!), {
        method: "POST",
        headers: { "x-forwarded-for": ownIp() },
        body: "",
      });
      expect(res.status, key).toBeGreaterThanOrEqual(400);
      expect(res.status, key).toBeLessThan(500);
      expect(JSON.parse(res.body), key).toHaveProperty("error");
    }
  });

  test("the metadata and the endpoints exist on the app host only", async ({}, info) => {
    test.skip(!desktopOnly(info), "raw HTTP, no UI");
    for (const host of ["localhost:3000", "mara.localhost:3000"]) {
      for (const path of [
        AS_PATH,
        PR_PATHS[0]!,
        PR_PATHS[1]!,
        "/oauth/token",
        "/oauth/register",
        "/oauth/revoke",
      ]) {
        const res = await rawRequest(host, path, {
          method: path.startsWith("/oauth") ? "POST" : "GET",
          body: path.startsWith("/oauth") ? "" : undefined,
        });
        expect(res.status, `${host}${path}`).toBe(404);
        expect(res.headers["access-control-allow-origin"], `${host}${path}`).toBeUndefined();
        expect(res.body, `${host}${path}`).not.toContain('"issuer"');
      }
    }
  });
});
