import "server-only";
import { parseServerEnv, readServerEnvSource } from "@/lib/env/server-schema";

/**
 * What a call to the Vercel REST API needs, read from the validated server environment at the
 * point of use (never at build or startup: `VERCEL_API_TOKEN` is optional there, because
 * production has no token until the custom-domains wave). Every operation that talks to the
 * Vercel API (adding a custom domain, removing one) starts here, so a missing token or project is
 * one clear error and no request is made: fail closed, never "skip the call".
 *
 * Nothing that works without custom domains goes through this file. Deleting an account or a page
 * that has no domain rows never asks for the token: it only reaches the Vercel client once per
 * domain row (see `removeAccountDomains` and `deletePageWithClient`).
 *
 * `VERCEL_API_BASE_URL` is the local-stub override; the env schema refuses it when
 * VERCEL_ENV=production. Errors name the variable and never print a value.
 */

export interface VercelApiConfig {
  token: string;
  projectId: string;
  /** The team that owns the project; sent as `teamId` when set. */
  teamId: string | undefined;
  /** Without a trailing slash. */
  baseUrl: string;
}

/** The Vercel API is not configured for this deployment: a custom domain cannot be added or removed. */
export class VercelNotConfiguredError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `Vercel is not configured: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        "Adding or removing a custom domain needs the Vercel API, so nothing was sent to Vercel.",
    );
    this.name = "VercelNotConfiguredError";
    this.missing = missing;
  }
}

export function readVercelApiConfig(
  source: Record<string, string | undefined> = readServerEnvSource(),
): VercelApiConfig {
  const env = parseServerEnv(source, { requireM4: false });
  const missing: string[] = [];
  if (!env.VERCEL_API_TOKEN) missing.push("VERCEL_API_TOKEN");
  if (!env.VERCEL_PROJECT_ID) missing.push("VERCEL_PROJECT_ID");
  if (!env.VERCEL_API_TOKEN || !env.VERCEL_PROJECT_ID) throw new VercelNotConfiguredError(missing);
  return {
    token: env.VERCEL_API_TOKEN,
    projectId: env.VERCEL_PROJECT_ID,
    teamId: env.VERCEL_TEAM_ID,
    baseUrl: env.VERCEL_API_BASE_URL.replace(/\/+$/, ""),
  };
}
