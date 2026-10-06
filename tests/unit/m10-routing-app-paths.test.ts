import { NextRequest, NextResponse } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
import { BEARER_PATH_LIST, classifyAppPath } from "@/lib/routing/app-paths";
import { bearerPathProxy } from "@/lib/routing/bearer-proxy";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
const rewriteWithSession = vi.fn(async (_request: NextRequest, url: URL) =>
  NextResponse.rewrite(url),
);
vi.mock("@/lib/routing/session", () => ({ rewriteWithSession }));
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain: vi.fn() }));

const { config, proxy } = await import("@/proxy");

/**
 * M10-02: the app-host paths of the connector skip the session. One pure function lists them, the
 * proxy handles them before `rewriteWithSession` (the way `/share/{token}` is), and the matcher still
 * runs the proxy for every one of them.
 */

describe("M10-02 classifyAppPath: exact matches only", () => {
  it.each([
    ["/mcp", "endpoint"],
    ["/oauth/token", "endpoint"],
    ["/oauth/register", "endpoint"],
    ["/oauth/revoke", "endpoint"],
    ["/.well-known/oauth-authorization-server", "metadata"],
    ["/.well-known/oauth-protected-resource", "metadata"],
    ["/.well-known/oauth-protected-resource/mcp", "metadata"],
  ])("%s is a bearer path (%s)", (path, kind) => {
    expect(classifyAppPath(path)).toBe(kind);
  });

  it.each([
    "/mcp/",
    "/mcp/x",
    "/MCP",
    "/oauth/tokenx",
    "/oauth/token/",
    "/oauth/token/x",
    "/oauth/authorize",
    "/oauth/consent",
    "/oauth",
    "/oauth/",
    "/.well-known/oauth-protected-resource/other",
    "/.well-known/oauth-authorization-server/mcp",
    "/.well-known/openid-configuration",
    "/.well-known/",
    "/.well-known",
    "/",
    "",
    "/editor",
    "/share/abc",
    "/__proto__",
    "/constructor",
    "/toString",
    "/hasOwnProperty",
  ])("%j is not", (path) => {
    expect(classifyAppPath(path)).toBeNull();
  });

  it("the list holds exactly the seven paths", () => {
    expect(BEARER_PATH_LIST).toHaveLength(7);
    expect(new Set(BEARER_PATH_LIST).size).toBe(7);
  });
});

describe("M10-02 the proxy matcher runs for all seven paths", () => {
  it.each(BEARER_PATH_LIST)("%s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);
  });
});

function request(
  path: string,
  init: { method?: string; cookie?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`http://app.localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: {
      host: "app.localhost:3000",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...init.headers,
    },
  });
}

describe("M10-02 bearerPathProxy", () => {
  it("rewrites to the internal path with the request's cookie and share-token headers dropped, and sets no cookie", () => {
    const response = bearerPathProxy(
      request("/oauth/token", {
        cookie: "sb-x-auth-token=abc; hl_oauth_resume=r",
        headers: { "x-hl-share-token": "t" },
      }),
      new URL("http://app.localhost:3000/app/oauth/token"),
      "endpoint",
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://app.localhost:3000/app/oauth/token",
    );
    const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(overridden).not.toContain("cookie");
    expect(overridden).not.toContain("x-hl-share-token");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("answers with its own headers: no-store, nosniff, no-referrer; the metadata documents are public for five minutes", () => {
    const endpoint = bearerPathProxy(
      request("/mcp"),
      new URL("http://app.localhost:3000/app/mcp"),
      "endpoint",
    );
    expect(endpoint.headers.get("cache-control")).toBe("no-store");
    expect(endpoint.headers.get("x-content-type-options")).toBe("nosniff");
    expect(endpoint.headers.get("referrer-policy")).toBe("no-referrer");
    const metadata = bearerPathProxy(
      request("/.well-known/oauth-authorization-server"),
      new URL("http://app.localhost:3000/app/.well-known/oauth-authorization-server"),
      "metadata",
    );
    expect(metadata.headers.get("cache-control")).toBe("public, max-age=300");
    expect(metadata.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("sets no CORS header of its own: a header the proxy sets replaces the route's", () => {
    const response = bearerPathProxy(
      request("/oauth/register"),
      new URL("http://app.localhost:3000/app/oauth/register"),
      "endpoint",
    );
    expect(
      [...response.headers.keys()].filter((name) => name.startsWith("access-control-")),
    ).toEqual([]);
  });
});

describe("M10-02 the proxy handles the paths before the session helper", () => {
  it.each(BEARER_PATH_LIST)("%s never reaches rewriteWithSession", async (path) => {
    rewriteWithSession.mockClear();
    const response = await proxy(request(path, { cookie: "sb-x-auth-token=abc" }));
    expect(rewriteWithSession).not.toHaveBeenCalled();
    expect(response?.headers.get("x-middleware-rewrite")).toBe(
      `http://app.localhost:3000/app${path}`,
    );
    expect(response?.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    "/oauth/authorize",
    "/oauth/consent",
    "/editor",
    "/mcp/",
    "/.well-known/openid-configuration",
  ])("%s stays on the ordinary session path", async (path) => {
    rewriteWithSession.mockClear();
    await proxy(request(path));
    expect(rewriteWithSession).toHaveBeenCalledTimes(1);
  });

  it("other hosts change nothing: the marketing host never reaches the bearer branch", async () => {
    rewriteWithSession.mockClear();
    const response = await proxy(
      new NextRequest("http://localhost:3000/oauth/token", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );
    expect(rewriteWithSession).not.toHaveBeenCalled();
    // The marketing host just passes on (there is no such route there, so Next answers 404 itself):
    // no rewrite into the app tree and none of the bearer branch's headers.
    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(response?.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response?.headers.get("cache-control")).toBeNull();
    expect(response?.headers.get("referrer-policy")).toBeNull();
  });

  it("the internal /app/ tree stays a 404 on the marketing host, bearer paths included", async () => {
    rewriteWithSession.mockClear();
    const response = await proxy(
      new NextRequest("http://localhost:3000/app/oauth/token", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }),
    );
    expect(rewriteWithSession).not.toHaveBeenCalled();
    expect(response?.headers.get("x-middleware-rewrite")).toContain("404-not-found");
  });
});
