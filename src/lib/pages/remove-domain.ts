import "server-only";
import { readServerEnvSource } from "@/lib/env/server-schema";
import { readVercelApiConfig } from "./vercel-config";

/**
 * Takes one hostname off the Vercel project (`DELETE /v9/projects/{project}/domains/{hostname}`),
 * the call a page delete makes for each of its custom domains before the page row goes (M4-19).
 * Idempotent: a 404 means the project no longer has the hostname, which is what we wanted, so a
 * retry after a half-finished delete succeeds. Every other failure throws and the caller aborts.
 *
 * The token, project, team and API base URL come from `readVercelApiConfig` (the validated server
 * environment; `VERCEL_API_BASE_URL` is the local-stub override, refused in production by the env
 * schema). The hostname is a `domains.hostname` row value (already validated and lower-cased by the
 * table's checks) and is URL-encoded anyway. Fail closed: a missing token or project throws a
 * `VercelNotConfiguredError` before any request is made.
 */
export async function removeVercelDomain(
  hostname: string,
  fetchImpl: typeof fetch = fetch,
  source: Record<string, string | undefined> = readServerEnvSource(),
): Promise<void> {
  const { token, projectId, teamId, baseUrl } = readVercelApiConfig(source);

  const url = new URL(
    `${baseUrl}/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}`,
  );
  if (teamId) url.searchParams.set("teamId", teamId);

  const response = await fetchImpl(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(`Vercel refused to remove ${hostname}: HTTP ${response.status}`);
}
