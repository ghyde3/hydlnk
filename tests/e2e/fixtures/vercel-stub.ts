import { requireLocalEnv } from "./stripe-stub";

/**
 * Helpers for the specs that exercise custom-domain removal: the local Vercel stub
 * (vercel-stub-server.ts, started by Playwright as a second webServer) and the placeholder project
 * and team ids the dev server sends to it (VERCEL_PROJECT_ID, VERCEL_TEAM_ID from .env.local, never
 * real values). The stub is shared by every worker and never reset: filter its request log by the
 * hostnames a spec created.
 */

export interface VercelStubRequest {
  n: number;
  method: string;
  path: string;
  query: Record<string, string>;
  hasBearer: boolean;
}

function stubBase(): string {
  return requireLocalEnv("VERCEL_API_BASE_URL").replace(/\/+$/, "");
}

export const vercelIds = () => ({
  project: requireLocalEnv("VERCEL_PROJECT_ID"),
  team: requireLocalEnv("VERCEL_TEAM_ID"),
});

/** The path the app must call to take `hostname` off the project. */
export const domainPath = (hostname: string): string =>
  `/v9/projects/${encodeURIComponent(vercelIds().project)}/domains/${encodeURIComponent(hostname)}`;

export async function vercelStubRequests(): Promise<VercelStubRequest[]> {
  const res = await fetch(`${stubBase()}/__stub/requests`);
  return (await res.json()) as VercelStubRequest[];
}

/** Every domain-removal request the stub saw for `hostname`. */
export async function removalCalls(hostname: string): Promise<VercelStubRequest[]> {
  const path = domainPath(hostname);
  return (await vercelStubRequests()).filter(
    (request) => request.method === "DELETE" && request.path === path,
  );
}

/** Makes the next `times` stub requests whose path contains `contains` fail with `status`. */
export async function failVercelStub(contains: string, status = 500, times = 1): Promise<void> {
  await fetch(`${stubBase()}/__stub/fail`, {
    method: "POST",
    body: JSON.stringify({ contains, status, times }),
  });
}

export async function clearVercelFailures(): Promise<void> {
  await fetch(`${stubBase()}/__stub/clear-failures`, { method: "POST" });
}
