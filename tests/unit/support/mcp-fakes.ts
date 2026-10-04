import type { ActivityRow, OwnedPage, ToolDeps, ToolIdentity } from "@/lib/mcp/types";

/**
 * Fakes for the MCP tests (Wave L): dependencies with spies, so a test can prove the ORDER of the
 * checks in `runTool` and that nothing was read or written when a check refused the call.
 */

// The public environment the modules under test validate at import. Defaults only: a real value in
// the environment (a CI job, a loaded .env.local) wins.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
process.env.NEXT_PUBLIC_ROOT_DOMAIN ??= "localhost:3000";

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const PAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const METADATA_URL = "http://app.localhost:3000/.well-known/oauth-protected-resource/mcp";

export function identity(over: Partial<ToolIdentity> = {}): ToolIdentity {
  return {
    userId: USER_A,
    clientId: "hlc_" + "a".repeat(32),
    grantId: "33333333-3333-4333-8333-333333333333",
    tokenId: "44444444-4444-4444-8444-444444444444",
    scopes: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
    ...over,
  };
}

export function ownedPage(over: Partial<OwnedPage> = {}): OwnedPage {
  return {
    id: PAGE_A,
    name: "Main page",
    handle: "mara",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    publishedAt: null,
    ...over,
  };
}

export function makeDeps(over: Partial<ToolDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const activity: ActivityRow[] = [];
  const deferred: Array<() => unknown> = [];
  const deps: ToolDeps = {
    admin: {} as never,
    limit: async (key) => {
      calls.push(`limit:${key}`);
      return { allowed: true, retryAfter: 0 };
    },
    isSuspended: async () => {
      calls.push("suspended");
      return false;
    },
    loadPage: async (_userId, pageId) => {
      calls.push("page");
      return { ok: true, page: ownedPage({ id: pageId ?? PAGE_A }) };
    },
    recordActivity: async (row) => {
      calls.push("activity");
      activity.push(row);
    },
    defer: (work) => {
      deferred.push(work);
    },
    now: () => new Date("2026-10-04T12:00:00Z"),
    log: (line) => {
      logs.push(line);
    },
    resourceMetadataUrl: METADATA_URL,
    ...over,
  };
  return {
    deps,
    calls,
    logs,
    activity,
    deferred,
    /** Runs what was deferred (the activity row), as `after()` does once the response is sent. */
    async flush() {
      for (const work of deferred.splice(0)) await work();
    },
  };
}
