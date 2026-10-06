/**
 * The Vercel Domains API as the custom-domains feature uses it. No `server-only` import and no
 * environment read, so Vitest and the Playwright integration specs can build a client against a
 * stub; "./vercel" wires the real one to the validated server environment.
 *
 * Endpoints (https://vercel.com/docs/rest-api, checked 2026-10-03). Every request carries
 * `Authorization: Bearer <token>` and, when a team owns the project, `?teamId=<team>`:
 *   add      POST   /v10/projects/{project}/domains            body {name}
 *   get      GET    /v9/projects/{project}/domains/{domain}
 *   verify   POST   /v9/projects/{project}/domains/{domain}/verify
 *   config   GET    /v6/domains/{domain}/config?projectIdOrName={project}
 *   remove   DELETE /v9/projects/{project}/domains/{domain}
 *
 * The only host this module ever calls is the configured API host. The custom hostname is only ever
 * a URL-encoded path segment or a JSON field, never a URL of its own, so the server cannot be made
 * to request a hostname an owner typed (SSRF). Redirects are not followed.
 */

export interface VercelClientConfig {
  token: string;
  projectId: string;
  teamId?: string | undefined;
  /** Without a trailing slash. */
  baseUrl: string;
  /** Per request; the add call has to give up after eight seconds (M4-11). */
  timeoutMs?: number;
}

export interface VerificationChallenge {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

/** What GET/POST on a project domain returns, trimmed to what the feature reads. */
export interface ProjectDomain {
  name: string;
  apexName: string;
  verified: boolean;
  verification: VerificationChallenge[];
}

export interface DomainConfig {
  /** Vercel's verdict: the DNS is not pointing at Vercel (or a certificate cannot be issued). */
  misconfigured: boolean;
  configuredBy: string | null;
  /** rank 1 is the preferred value. */
  recommendedCNAME: { rank: number; value: string }[];
  recommendedIPv4: { rank: number; value: string[] }[];
}

export type VercelFailureKind =
  /** The name is already connected somewhere else on Vercel, or Vercel will not take it. */
  | "conflict"
  /** The project is at its domain cap (the Hobby 50-domain limit) or payment is needed. */
  | "capacity"
  /** Vercel says the name is not a valid domain. */
  | "invalid"
  /** 404: the project has no such domain. */
  | "not_found"
  /** 401 or a 403 that is not about the domain: our token is wrong. */
  | "unauthorized"
  /** Timeout, network error, 5xx, or anything unexpected. */
  | "unavailable";

export class VercelApiError extends Error {
  readonly kind: VercelFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  constructor(kind: VercelFailureKind, status: number | null, code: string | null, detail: string) {
    // The detail never carries the token, the URL or a hostname: it is logged as is.
    super(`Vercel API ${kind}${status ? ` (HTTP ${status})` : ""}${code ? ` [${code}]` : ""}: ${detail}`);
    this.name = "VercelApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Maps a failed response of the add call to a kind. Exported for the unit tests. */
export function classifyFailure(status: number, code: string | null): VercelFailureKind {
  const c = (code ?? "").toLowerCase();
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  // A rate limit (429) is a wait, not a cap: it falls through to "unavailable" below.
  if (status === 429) return "unavailable";
  if (/too_many|domain_limit|limit_exceeded|exceeded|max_domains|quota/.test(c) || status === 402) {
    return "capacity";
  }
  if (
    status === 409 ||
    status === 403 ||
    /domain_already_in_use|domain_taken|existing_project_domain|forbidden/.test(c)
  ) {
    return "conflict";
  }
  if (status === 400 && /invalid/.test(c)) return "invalid";
  // Everything else (429, 5xx, an unexpected 4xx such as a failed latest deployment) is our
  // host's problem, not something the owner typed.
  return "unavailable";
}

const DEFAULT_TIMEOUT_MS = 8_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseProjectDomain(body: unknown): ProjectDomain {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const verification = Array.isArray(data.verification) ? data.verification : [];
  return {
    name: asString(data.name),
    apexName: asString(data.apexName),
    verified: data.verified === true,
    verification: verification
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        type: asString(entry.type),
        domain: asString(entry.domain),
        value: asString(entry.value),
        reason: asString(entry.reason),
      })),
  };
}

function parseConfig(body: unknown): DomainConfig {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const cnames = Array.isArray(data.recommendedCNAME) ? data.recommendedCNAME : [];
  const ipv4 = Array.isArray(data.recommendedIPv4) ? data.recommendedIPv4 : [];
  return {
    misconfigured: data.misconfigured !== false,
    configuredBy: typeof data.configuredBy === "string" ? data.configuredBy : null,
    recommendedCNAME: cnames
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({ rank: Number(e.rank), value: asString(e.value) }))
      .filter((e) => Number.isFinite(e.rank) && e.value !== ""),
    recommendedIPv4: ipv4
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        rank: Number(e.rank),
        value: Array.isArray(e.value) ? e.value.filter((v): v is string => typeof v === "string") : [],
      }))
      .filter((e) => Number.isFinite(e.rank) && e.value.length > 0),
  };
}

export interface VercelClient {
  /** Adds the hostname to the project. Throws VercelApiError: conflict, capacity, invalid, unavailable. */
  addProjectDomain(hostname: string): Promise<ProjectDomain>;
  /** The project's record of the hostname (verified flag and ownership challenges). */
  getProjectDomain(hostname: string): Promise<ProjectDomain>;
  /**
   * Asks Vercel to check the ownership challenge. A 400 (no TXT record yet, or a mismatch) is an
   * answer, not a failure: `{ verified: false }`. Anything else that is not a 200 throws.
   */
  verifyProjectDomain(hostname: string): Promise<{ verified: boolean }>;
  /** DNS configuration: the recommended records and whether the DNS points at Vercel. */
  getDomainConfig(hostname: string): Promise<DomainConfig>;
  /** Takes the hostname off the project. A 404 (already gone) counts as removed. */
  removeProjectDomain(hostname: string): Promise<void>;
}

export function createVercelClient(
  config: VercelClientConfig,
  fetchImpl: typeof fetch = fetch,
): VercelClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const project = encodeURIComponent(config.projectId);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<{ status: number; body: unknown }> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    if (config.teamId) url.searchParams.set("teamId", config.teamId);

    const headers: Record<string, string> = { Authorization: `Bearer ${config.token}` };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new VercelApiError("unavailable", null, null, timedOut ? "timed out" : "network error");
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }

  function fail(status: number, body: unknown): never {
    const error =
      body && typeof body === "object" && "error" in body
        ? ((body as { error?: unknown }).error as { code?: unknown } | undefined)
        : undefined;
    const code = typeof error?.code === "string" ? error.code : null;
    throw new VercelApiError(status >= 500 ? "unavailable" : classifyFailure(status, code), status, code, "request refused");
  }

  const domainPath = (hostname: string) =>
    `/v9/projects/${project}/domains/${encodeURIComponent(hostname)}`;

  return {
    async addProjectDomain(hostname) {
      const { status, body } = await call("POST", `/v10/projects/${project}/domains`, {
        body: { name: hostname },
      });
      if (status !== 200) fail(status, body);
      return parseProjectDomain(body);
    },

    async getProjectDomain(hostname) {
      const { status, body } = await call("GET", domainPath(hostname));
      if (status !== 200) fail(status, body);
      return parseProjectDomain(body);
    },

    async verifyProjectDomain(hostname) {
      const { status, body } = await call("POST", `${domainPath(hostname)}/verify`);
      if (status === 200) {
        return { verified: !!body && typeof body === "object" && (body as { verified?: unknown }).verified === true };
      }
      if (status === 400) return { verified: false };
      return fail(status, body);
    },

    async getDomainConfig(hostname) {
      const { status, body } = await call("GET", `/v6/domains/${encodeURIComponent(hostname)}/config`, {
        query: { projectIdOrName: config.projectId },
      });
      if (status !== 200) fail(status, body);
      return parseConfig(body);
    },

    async removeProjectDomain(hostname) {
      const { status, body } = await call("DELETE", domainPath(hostname));
      if (status >= 200 && status < 300) return;
      if (status === 404) return;
      fail(status, body);
    },
  };
}
