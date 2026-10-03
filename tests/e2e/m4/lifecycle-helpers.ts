import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { rand } from "../fixtures/data";
import { rawRequest, type RawResponse } from "../fixtures/http";

/**
 * Shared by the Wave E lifecycle specs (M4-33 downgrade, M4-34 account deletion): seeding custom
 * domains and uploads with the secret key, asking a custom host for its page, and the guards that
 * tell a spec whether the feature of another Wave E job it depends on has landed.
 */

export const BUCKET = "page-media";
export const MIB = 1024 * 1024;

const repo = (path: string) => resolve(process.cwd(), path);

// ---------------------------------------------------------------------------------------------
// Dependencies on other jobs of the wave (a spec that needs one is skipped with the reason until it exists)
// ---------------------------------------------------------------------------------------------

/**
 * Custom hosts serve their page (M4-09): `resolveCustomDomain` is no longer the TODO(M4) stub that
 * answers null for every host. Until then a custom host is always the plain 404.
 */
export function customHostRoutingLanded(): boolean {
  try {
    return !/TODO\(M4\)/.test(readFileSync(repo("src/lib/routing/custom-domain.ts"), "utf8"));
  } catch {
    return false;
  }
}

/** The server actions of the Domains screen have bodies (domains-core): the skeleton says "Not built yet.". */
export function domainActionsLanded(): boolean {
  try {
    return !/Not built yet\./.test(readFileSync(repo("src/lib/domains/actions.ts"), "utf8"));
  } catch {
    return false;
  }
}

/** The Domains screen is built (its page is no longer the placeholder card). */
export function domainsScreenLanded(): boolean {
  try {
    return !/PlaceholderCard/.test(
      readFileSync(repo("src/app/(editor)/app/(screens)/domains/page.tsx"), "utf8"),
    );
  } catch {
    return false;
  }
}

/** The Analytics screen is built (its page is no longer the placeholder card). */
export function analyticsScreenLanded(): boolean {
  try {
    return !/PlaceholderCard/.test(
      readFileSync(repo("src/app/(editor)/app/(screens)/analytics/page.tsx"), "utf8"),
    );
  } catch {
    return false;
  }
}

/** The analytics migration (daily_dim_stats, the Free-window policies) exists in the tree. */
export function analyticsMigrationLanded(): boolean {
  return existsSync(repo("supabase/migrations/20261004000002_analytics.sql"));
}

// ---------------------------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------------------------

/** A hostname no real DNS knows: `zq-<label>-<random>.example.test`. */
export const customHostname = (label: string): string => `zq-${label}-${rand(6)}.example.test`;

/** Verified custom domain rows for a page (secret key; the domains limit trigger still applies). */
export async function addVerifiedDomains(pageId: string, hosts: string[]): Promise<void> {
  const { error } = await adminClient()
    .from("domains")
    .insert(
      hosts.map((hostname) => ({
        page_id: pageId,
        hostname,
        status: "verified",
        verified_at: new Date().toISOString(),
      })),
    );
  if (error) throw new Error(`seeding domains failed: ${error.message}`);
}

export async function domainHostsOf(pageIds: string[]): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("domains")
    .select("hostname")
    .in("page_id", pageIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.hostname as string).sort();
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

const seeded: string[] = [];

/** Removes whatever `seedImages` left behind (a deleted account's own are already gone: removing a missing object is a no-op). */
export async function cleanupSeededImages(): Promise<void> {
  const paths = seeded.splice(0);
  if (paths.length > 0) await adminClient().storage.from(BUCKET).remove(paths);
}

/** Uploads `count` small images under `{userId}/` in the page-media bucket and returns their names. */
export async function seedImages(userId: string, count = 2): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `${rand(8)}.png`;
    const { error } = await adminClient()
      .storage.from(BUCKET)
      .upload(`${userId}/${name}`, PNG, { contentType: "image/png" });
    if (error) throw new Error(`seeding an image failed: ${error.message}`);
    seeded.push(`${userId}/${name}`);
    names.push(name);
  }
  return names;
}

export async function imagesOf(userId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(BUCKET).list(userId, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((entry) => entry.name).sort();
}

export async function userExists(id: string): Promise<boolean> {
  return (await adminClient().auth.admin.getUserById(id)).data.user !== null;
}

export async function pageRowExists(pageId: string): Promise<boolean> {
  const { data, error } = await adminClient().from("pages").select("id").eq("id", pageId);
  if (error) throw new Error(error.message);
  return (data ?? []).length === 1;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

/** One request to the dev server naming `hostname` as the Host: what a visitor's browser sends to a custom domain. */
export const customGet = (hostname: string, path = "/"): Promise<RawResponse> =>
  rawRequest(hostname, path);

export interface RecordedAction {
  headers: Record<string, string>;
  body: string;
}

/**
 * Runs `trigger` (a click that submits a Server Action form) and captures the action POST instead
 * of sending it: the id of the action, its headers and its body, ready for `replayAction`.
 */
export async function captureAction(
  page: Page,
  routeGlob: string,
  trigger: () => Promise<void>,
): Promise<RecordedAction> {
  let recorded: RecordedAction | undefined;
  await page.route(routeGlob, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      recorded = { headers: request.headers(), body: request.postData() ?? "" };
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await trigger();
  const deadline = Date.now() + 15_000;
  while (!recorded && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  await page.unroute(routeGlob);
  if (!recorded) throw new Error("no Server Action request was captured");
  return recorded;
}

/** Sends a captured Server Action POST to the app host as plain HTTP with the given Cookie header (or none). */
export function replayAction(
  recorded: RecordedAction,
  path: string,
  cookie?: string,
): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  for (const name of ["next-action", "content-type", "accept", "next-router-state-tree"]) {
    if (recorded.headers[name]) headers[name] = recorded.headers[name]!;
  }
  return rawRequest("app.localhost:3000", path, {
    method: "POST",
    ...(cookie ? { cookie } : {}),
    headers: { ...headers, origin: "http://app.localhost:3000" },
    body: recorded.body,
  });
}

/** True when a replayed, session-less Server Action POST was refused the way every unauthenticated call is: 401 or a redirect to /login. */
export function refusedAsSignedOut(response: RawResponse): boolean {
  const location = String(response.headers.location ?? "");
  const actionRedirect = String(response.headers["x-action-redirect"] ?? "");
  return (
    response.status === 401 || location.includes("/login") || actionRedirect.includes("/login")
  );
}
