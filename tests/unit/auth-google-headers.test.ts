import { describe, expect, it, vi } from "vitest";
import {
  APP_CONTENT_SECURITY_POLICY,
  APP_DIRECTIVES,
  buildContentSecurityPolicy,
  setAppHeaders,
} from "@/lib/routing/app-headers";
import { GOOGLE_GSI_CSP_SOURCES } from "@/lib/auth/google-shared";
import { setTenantHeaders } from "@/lib/routing/tenant-headers";
import { parseEnv, publicEnvSchema } from "@/lib/env/shared";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * The app host's headers around Google Identity Services, and the optional client id. Google's own
 * documentation lists what a CSP must allow for the button (script-src, frame-src, connect-src,
 * style-src); the app host's policy sets none of those directives today, so nothing blocks it.
 */

const GIS = GOOGLE_GSI_CSP_SOURCES;
const directivesOf = (policy: string) =>
  new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .map(([name, ...sources]) => [name!, sources] as const),
  );

describe("app-host Content-Security-Policy", () => {
  it("still forbids framing the app host", () => {
    expect(APP_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    const headers = new Headers();
    setAppHeaders(headers);
    expect(headers.get("content-security-policy")).toBe(APP_CONTENT_SECURITY_POLICY);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("lets Google's script, iframe, requests and styles through: every directive Google names is either absent or lists Google's origin", () => {
    const directives = directivesOf(APP_CONTENT_SECURITY_POLICY);
    const documented: Record<string, string> = {
      "script-src": GIS.script,
      "frame-src": GIS.frame,
      "connect-src": GIS.connect,
      "style-src": GIS.style,
      "default-src": GIS.frame,
    };
    for (const [name, origin] of Object.entries(documented)) {
      const sources = directives.get(name);
      // Absent = unrestricted = allowed. Present = must name Google.
      if (sources) expect(sources, `${name} must allow Google Identity Services`).toContain(origin);
    }
  });

  it("adds Google's documented origin to any directive that is added later", () => {
    const policy = buildContentSecurityPolicy({
      ...APP_DIRECTIVES,
      "default-src": ["'self'"],
      "script-src": ["'self'", "'nonce-abc'"],
      "frame-src": ["https://www.youtube-nocookie.com"],
      "connect-src": ["'self'", "https://project.supabase.co"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
    });
    const directives = directivesOf(policy);
    expect(directives.get("script-src")).toContain(GIS.script);
    expect(directives.get("frame-src")).toEqual(["https://www.youtube-nocookie.com", GIS.frame]);
    expect(directives.get("connect-src")).toContain(GIS.connect);
    expect(directives.get("style-src")).toContain(GIS.style);
    expect(directives.get("default-src")).toContain(GIS.frame);
    // Directives Google doesn't document are left alone, and nothing is added twice.
    expect(directives.get("img-src")).toEqual(["'self'", "data:"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(buildContentSecurityPolicy({ "script-src": [GIS.script] })).toBe(
      `script-src ${GIS.script}`,
    );
  });

  it("never sets Cross-Origin-Opener-Policy: same-origin, which leaves Google's popup blank", () => {
    const headers = new Headers();
    setAppHeaders(headers);
    const coop = headers.get("cross-origin-opener-policy");
    expect(coop === null || coop === "same-origin-allow-popups").toBe(true);
  });

  it("sets no Permissions-Policy that would block FedCM (identity-credentials-get)", () => {
    const headers = new Headers();
    setAppHeaders(headers);
    const policy = headers.get("permissions-policy");
    expect(policy === null || policy.includes("identity-credentials-get")).toBe(true);
  });

  it("only the app host gets it: the tenant policy never mentions Google", () => {
    const headers = new Headers();
    setTenantHeaders(headers);
    expect(headers.get("content-security-policy")).not.toContain("google");
  });
});

describe("NEXT_PUBLIC_GOOGLE_CLIENT_ID", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  };

  it("is optional: the app starts without it", () => {
    expect(parseEnv(publicEnvSchema, base, "client").NEXT_PUBLIC_GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("empty or whitespace-only reads as unset and can never stop the app", () => {
    for (const value of ["", "   ", "\n"]) {
      const env = parseEnv(
        publicEnvSchema,
        { ...base, NEXT_PUBLIC_GOOGLE_CLIENT_ID: value },
        "client",
      );
      expect(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID).toBeUndefined();
    }
  });

  it("is passed through, trimmed, when set", () => {
    const env = parseEnv(
      publicEnvSchema,
      { ...base, NEXT_PUBLIC_GOOGLE_CLIENT_ID: " abc.apps.googleusercontent.com " },
      "client",
    );
    expect(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID).toBe("abc.apps.googleusercontent.com");
  });
});
