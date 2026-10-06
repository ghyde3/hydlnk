import { requireLocalEnv } from "./stripe-stub";

/**
 * Helpers for the specs that exercise custom domains: the local Vercel stub
 * (vercel-stub-server.ts, started by Playwright as a second webServer) and the placeholder project
 * and team ids the dev server sends to it (VERCEL_PROJECT_ID, VERCEL_TEAM_ID from .env.local, never
 * real values). The stub is shared by every worker and never reset: use hostnames of your own and
 * filter its request log by them (`requestsFor`).
 */

export interface VercelStubRequest {
  n: number;
  method: string;
  path: string;
  query: Record<string, string>;
  hasBearer: boolean;
  /** The hostname the request is about (a path segment, or the name in an add body). */
  host: string | null;
  /** The parsed JSON body of a POST, or null. */
  body: unknown;
}

/** What the stub says about one hostname (see vercel-stub-server.ts). Every field is optional in a patch. */
export interface VercelDomainState {
  added: boolean;
  verified: boolean;
  misconfigured: boolean;
  apexName: string;
  verification: { type: string; domain: string; value: string; reason: string }[];
  recommendedCNAME: { rank: number; value: string }[];
  recommendedIPv4: { rank: number; value: string[] }[];
  addError: { status: number; code: string } | null;
  removeStatus: number | null;
  configStatus: number | null;
  verifyStatus: number | null;
  addDelayMs: number;
}

export function stubBase(): string {
  return requireLocalEnv("VERCEL_API_BASE_URL").replace(/\/+$/, "");
}

export const vercelIds = () => ({
  project: requireLocalEnv("VERCEL_PROJECT_ID"),
  team: requireLocalEnv("VERCEL_TEAM_ID"),
});

/** The path the app must call to take `hostname` off the project. */
export const domainPath = (hostname: string): string =>
  `/v9/projects/${encodeURIComponent(vercelIds().project)}/domains/${encodeURIComponent(hostname)}`;

/** The path the app must call to add a hostname to the project (the name travels in the body). */
export const addPath = (): string => `/v10/projects/${encodeURIComponent(vercelIds().project)}/domains`;

export const verifyPath = (hostname: string): string => `${domainPath(hostname)}/verify`;
export const configPath = (hostname: string): string =>
  `/v6/domains/${encodeURIComponent(hostname)}/config`;

export async function vercelStubRequests(): Promise<VercelStubRequest[]> {
  const res = await fetch(`${stubBase()}/__stub/requests`);
  return (await res.json()) as VercelStubRequest[];
}

/** Every request the stub saw about `hostname` (optionally only one method). */
export async function requestsFor(hostname: string, method?: string): Promise<VercelStubRequest[]> {
  const res = await fetch(`${stubBase()}/__stub/requests?host=${encodeURIComponent(hostname)}`);
  const all = (await res.json()) as VercelStubRequest[];
  return method ? all.filter((request) => request.method === method) : all;
}

/** Every domain-removal request the stub saw for `hostname`. */
export async function removalCalls(hostname: string): Promise<VercelStubRequest[]> {
  const path = domainPath(hostname);
  return (await vercelStubRequests()).filter(
    (request) => request.method === "DELETE" && request.path === path,
  );
}

/** The add-project-domain requests the stub saw for `hostname`. */
export async function addCalls(hostname: string): Promise<VercelStubRequest[]> {
  return (await requestsFor(hostname, "POST")).filter((request) => request.path === addPath());
}

/** The verify requests the stub saw for `hostname` (what the cooldown limits). */
export async function verifyCalls(hostname: string): Promise<VercelStubRequest[]> {
  return (await requestsFor(hostname, "POST")).filter((request) => request.path === verifyPath(hostname));
}

/** Sets what the stub answers for `hostname` (merged into its state). */
export async function setDomainState(
  hostname: string,
  patch: Partial<VercelDomainState>,
): Promise<VercelDomainState> {
  const res = await fetch(`${stubBase()}/__stub/domain/${encodeURIComponent(hostname)}`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
  return (await res.json()) as VercelDomainState;
}

/** Makes the stub report the domain verified and correctly configured: the DNS check passes. */
export const markDnsReady = (hostname: string) =>
  setDomainState(hostname, { verified: true, misconfigured: false });

export async function forgetDomain(hostname: string): Promise<void> {
  await fetch(`${stubBase()}/__stub/forget/${encodeURIComponent(hostname)}`, { method: "POST" });
}

/** Makes the next `times` stub requests whose path contains `contains` fail with `status`. */
export async function failVercelStub(contains: string, status = 500, times = 1): Promise<void> {
  await fetch(`${stubBase()}/__stub/fail`, {
    method: "POST",
    body: JSON.stringify({ contains, status, times }),
  });
}

/**
 * Drops injected failures. Pass the same `contains` text a `failVercelStub` call used (a hostname of
 * your own) to drop only those: the stub is shared by every worker, so a spec's cleanup must never
 * wipe a failure another spec just injected. With no argument it drops every failure (use it only
 * from a spec that owns the whole stub).
 */
export async function clearVercelFailures(contains?: string): Promise<void> {
  await fetch(`${stubBase()}/__stub/clear-failures`, {
    method: "POST",
    body: JSON.stringify(contains === undefined ? {} : { contains }),
  });
}
