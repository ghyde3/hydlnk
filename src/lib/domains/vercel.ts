import "server-only";
import { readVercelApiConfig } from "@/lib/pages/vercel-config";
import {
  createVercelClient,
  type DomainConfig,
  type ProjectDomain,
  type VercelClient,
} from "./vercel-client";

export { VercelApiError, classifyFailure } from "./vercel-client";
export type {
  DomainConfig,
  ProjectDomain,
  VercelClient,
  VercelFailureKind,
  VerificationChallenge,
} from "./vercel-client";

/**
 * The Vercel client bound to the validated server environment (VERCEL_API_TOKEN,
 * VERCEL_PROJECT_ID, VERCEL_TEAM_ID, and VERCEL_API_BASE_URL for the local stub, which the env
 * schema refuses in production). Built per call, so a missing token or project is one clear
 * `VercelNotConfiguredError` at the point of use and no request is made: fail closed.
 */
export function vercelClient(): VercelClient {
  return createVercelClient(readVercelApiConfig());
}

export async function addProjectDomain(hostname: string): Promise<ProjectDomain> {
  return vercelClient().addProjectDomain(hostname);
}

export async function getProjectDomain(hostname: string): Promise<ProjectDomain> {
  return vercelClient().getProjectDomain(hostname);
}

export async function verifyProjectDomain(hostname: string): Promise<{ verified: boolean }> {
  return vercelClient().verifyProjectDomain(hostname);
}

export async function getDomainConfig(hostname: string): Promise<DomainConfig> {
  return vercelClient().getDomainConfig(hostname);
}

/**
 * Takes the hostname off the project; a 404 (already gone) counts as removed. Account and page
 * deletion call this for every domain they hold, so a failure throws and the caller stops.
 */
export async function removeProjectDomain(hostname: string): Promise<void> {
  return vercelClient().removeProjectDomain(hostname);
}
