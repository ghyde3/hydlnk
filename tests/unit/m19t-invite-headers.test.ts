import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { rewriteWithSession } = await import("@/lib/routing/session");

/**
 * Team access attack pass, note 4a (M19-08): GET /invite/{token} sets `Referrer-Policy: no-referrer`,
 * but the proxy's app headers replace a route's own (setAppHeaders sets strict-origin-when-cross-origin),
 * so the response a browser got carried the app default and the token could leave in a Referer. The
 * session helper now sets no-referrer for /invite/* itself, as it does for the OAuth decisions.
 * (tests/e2e/team/invite.spec.ts reads the header off the production build's real response.)
 */
const TOKEN = "A".repeat(43);
const headerFor = async (path: string) => {
  const response = await rewriteWithSession(
    new NextRequest(`http://app.localhost:3000${path}`),
    new URL(`http://app.localhost:3000/app${path}`),
  );
  return response.headers.get("referrer-policy");
};

describe("note 4a: the invite link never sends a Referer", () => {
  it("/invite/{token} answers no-referrer through the proxy's session helper", async () => {
    expect(await headerFor(`/invite/${TOKEN}`)).toBe("no-referrer");
  });

  it("the OAuth decisions keep no-referrer; other app paths keep the app default", async () => {
    expect(await headerFor("/oauth/consent")).toBe("no-referrer");
    expect(await headerFor("/invite")).toBe("strict-origin-when-cross-origin");
    expect(await headerFor("/editor")).toBe("strict-origin-when-cross-origin");
  });
});
