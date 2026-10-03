/**
 * A local stand-in for the part of the Vercel REST API that HYDLNK calls: the project-domain
 * endpoints of the custom-domains feature (add, get, verify, config, remove) and the removal that
 * page and account deletion make. Run directly by Node (`node tests/e2e/fixtures/vercel-stub-server.ts
 * 12112`, erasable TypeScript only): Playwright starts it as a second `webServer`
 * (playwright.config.ts), and the dev server reaches it through VERCEL_API_BASE_URL
 * (http://127.0.0.1:12112, written to .env.local with placeholder token, project and team ids by
 * scripts/lib/local-env-placeholders.sh). Never a real token, never the real API.
 *
 * Endpoints (the shapes of https://vercel.com/docs/rest-api, 2026-10-03):
 *   POST   /v10/projects/{project}/domains            add: 200 {name, apexName, projectId, verified, verification}
 *                                                      a name already added answers 400 existing_project_domain
 *   GET    /v9/projects/{project}/domains/{domain}    the project domain (creates a default state when unseen)
 *   POST   /v9/projects/{project}/domains/{domain}/verify    200 {..., verified}
 *   GET    /v6/domains/{domain}/config                {configuredBy, misconfigured, recommendedCNAME, recommendedIPv4, ...}
 *   DELETE /v9/projects/{project}/domains/{domain}    200 {} (the Vercel behaviour for a hostname the project holds)
 *
 * Every API request is recorded (method, path, teamId and other query values, whether a Bearer
 * token came with it, the hostname it was about, its JSON body) for the specs to assert on, and a
 * control API under /__stub/ configures it:
 *   GET  /__stub/requests[?host=<hostname>]      the request log (all, or one hostname's)
 *   POST /__stub/fail {contains,status,times}    the next `times` requests whose path contains `contains` fail
 *   POST /__stub/clear-failures [{contains}]     drop all injected failures, or only those injected for `contains`
 *   POST /__stub/domain/{hostname} {patch}       merge into one hostname's state (see DomainState)
 *   GET  /__stub/domain/{hostname}               that state
 *   POST /__stub/forget/{hostname}               drop that state
 * It is shared by every spec worker and never reset by a spec: a spec uses hostnames of its own and
 * filters the log by them. Playwright owns its lifecycle, so it never exits on its own.
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 12112);

interface Recorded {
  n: number;
  method: string;
  path: string;
  query: Record<string, string>;
  hasBearer: boolean;
  /** The hostname the request is about (path segment or body name), or null. */
  host: string | null;
  body: unknown;
}
interface Failure {
  contains: string;
  status: number;
  times: number;
}

/** What the stub says about one hostname; every field is settable through POST /__stub/domain/{host}. */
interface DomainState {
  added: boolean;
  /** Ownership verified for the project. */
  verified: boolean;
  /** The DNS does not point at Vercel (or no certificate can be issued yet). */
  misconfigured: boolean;
  apexName: string;
  verification: { type: string; domain: string; value: string; reason: string }[];
  recommendedCNAME: { rank: number; value: string }[];
  recommendedIPv4: { rank: number; value: string[] }[];
  /** Answer the add with this error (status, error.code) instead of 200. */
  addError: { status: number; code: string } | null;
  /** Status for DELETE (e.g. 404 for "already gone", 500). */
  removeStatus: number | null;
  /** Status for GET config (e.g. 500). */
  configStatus: number | null;
  /** Status for POST verify (e.g. 500). */
  verifyStatus: number | null;
  /** Hold the add response this long (a timeout test). */
  addDelayMs: number;
}

const requests: Recorded[] = [];
const failures: Failure[] = [];
const states = new Map<string, DomainState>();
let counter = 0;

const base = `http://127.0.0.1:${port}`;

function defaultState(host: string): DomainState {
  const labels = host.split(".");
  return {
    added: false,
    verified: false,
    misconfigured: true,
    apexName: labels.slice(-2).join("."),
    verification: [],
    recommendedCNAME: [{ rank: 1, value: "abc123.vercel-dns-017.com." }],
    recommendedIPv4: [{ rank: 1, value: ["203.0.113.10"] }],
    addError: null,
    removeStatus: null,
    configStatus: null,
    verifyStatus: null,
    addDelayMs: 0,
  };
}

function stateOf(host: string): DomainState {
  let state = states.get(host);
  if (!state) {
    state = defaultState(host);
    states.set(host, state);
  }
  return state;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

const errorBody = (code: string, message = "Injected by the stub") => ({
  error: { code, message },
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function control(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const path = url.pathname;
  if (path === "/__stub/health") return send(res, 200, { ok: true, port });
  if (path === "/__stub/requests") {
    const host = url.searchParams.get("host");
    return send(res, 200, host ? requests.filter((r) => r.host === host) : requests);
  }
  if (path === "/__stub/fail" && req.method === "POST") {
    const input = JSON.parse(await readBody(req)) as Partial<Failure> & { contains: string };
    failures.push({
      contains: input.contains,
      status: input.status ?? 500,
      times: input.times ?? 1,
    });
    return send(res, 200, { ok: true });
  }
  if (path === "/__stub/clear-failures" && req.method === "POST") {
    // With {contains}, only the failures injected for that text go (a spec cleaning up after itself
    // must not wipe another spec's); with no body, all of them.
    const raw = await readBody(req);
    const scope = raw ? (JSON.parse(raw) as { contains?: string }).contains : undefined;
    if (scope === undefined) failures.length = 0;
    else
      for (let i = failures.length - 1; i >= 0; i--)
        if (failures[i]!.contains === scope) failures.splice(i, 1);
    return send(res, 200, { ok: true });
  }
  const domainMatch = /^\/__stub\/(domain|forget)\/([^/]+)$/.exec(path);
  if (domainMatch) {
    const host = decodeURIComponent(domainMatch[2]!);
    if (domainMatch[1] === "forget") {
      states.delete(host);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST") {
      const patch = JSON.parse((await readBody(req)) || "{}") as Partial<DomainState>;
      Object.assign(stateOf(host), patch);
    }
    return send(res, 200, stateOf(host));
  }
  if (path === "/__stub/shutdown") {
    send(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 20);
    return;
  }
  return send(res, 404, { error: "unknown control path" });
}

function projectDomainBody(host: string, state: DomainState, projectId: string) {
  return {
    name: host,
    apexName: state.apexName,
    projectId,
    verified: state.verified,
    ...(state.verified ? {} : { verification: state.verification }),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

const PROJECT_DOMAINS = /^\/v10\/projects\/([^/]+)\/domains$/;
const PROJECT_DOMAIN = /^\/v9\/projects\/([^/]+)\/domains\/([^/]+)$/;
const PROJECT_DOMAIN_VERIFY = /^\/v9\/projects\/([^/]+)\/domains\/([^/]+)\/verify$/;
const DOMAIN_CONFIG = /^\/v6\/domains\/([^/]+)\/config$/;

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const method = req.method ?? "GET";
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  const auth = req.headers.authorization;
  const raw = method === "POST" || method === "PUT" ? await readBody(req) : "";
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  const addMatch = PROJECT_DOMAINS.exec(url.pathname);
  const verifyMatch = PROJECT_DOMAIN_VERIFY.exec(url.pathname);
  const domainMatch = PROJECT_DOMAIN.exec(url.pathname);
  const configMatch = DOMAIN_CONFIG.exec(url.pathname);
  let host: string | null = null;
  if (addMatch && body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string") {
    host = (body as { name: string }).name;
  } else if (verifyMatch) host = decodeURIComponent(verifyMatch[2]!);
  else if (domainMatch) host = decodeURIComponent(domainMatch[2]!);
  else if (configMatch) host = decodeURIComponent(configMatch[1]!);

  requests.push({
    n: ++counter,
    method,
    path: url.pathname,
    query,
    hasBearer: typeof auth === "string" && /^Bearer \S{8,}$/.test(auth),
    host,
    body,
  });

  const index = failures.findIndex((failure) => url.pathname.includes(failure.contains));
  if (index >= 0) {
    const failure = failures[index]!;
    failure.times -= 1;
    if (failure.times <= 0) failures.splice(index, 1);
    return send(res, failure.status, errorBody("injected", "Injected failure from the stub"));
  }

  // add
  if (method === "POST" && addMatch) {
    if (!host) return send(res, 400, errorBody("invalid_request", "name is required"));
    const state = stateOf(host);
    if (state.addDelayMs > 0) await new Promise((r) => setTimeout(r, state.addDelayMs));
    if (state.addError) {
      return send(res, state.addError.status, errorBody(state.addError.code));
    }
    if (state.added) return send(res, 400, errorBody("existing_project_domain", "Already on the project"));
    state.added = true;
    return send(res, 200, projectDomainBody(host, state, decodeURIComponent(addMatch[1]!)));
  }

  // verify
  if (method === "POST" && verifyMatch && host) {
    const state = stateOf(host);
    if (state.verifyStatus) return send(res, state.verifyStatus, errorBody("injected"));
    if (!state.verified) {
      return send(res, 400, errorBody("missing_txt_record", "No TXT record verifies the domain"));
    }
    return send(res, 200, projectDomainBody(host, state, decodeURIComponent(verifyMatch[1]!)));
  }

  // get project domain
  if (method === "GET" && domainMatch && host) {
    return send(res, 200, projectDomainBody(host, stateOf(host), decodeURIComponent(domainMatch[1]!)));
  }

  // remove
  if (method === "DELETE" && domainMatch && host) {
    const state = states.get(host);
    if (state?.removeStatus) return send(res, state.removeStatus, errorBody("injected"));
    states.delete(host);
    return send(res, 200, {});
  }

  // config
  if (method === "GET" && configMatch && host) {
    const state = stateOf(host);
    if (state.configStatus) return send(res, state.configStatus, errorBody("injected"));
    return send(res, 200, {
      acceptedChallenges: ["dns-01", "http-01"],
      configuredBy: state.misconfigured ? null : "CNAME",
      misconfigured: state.misconfigured,
      recommendedCNAME: state.recommendedCNAME,
      recommendedIPv4: state.recommendedIPv4,
    });
  }

  return send(res, 404, errorBody("not_found", "Not found"));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", base);
  try {
    if (url.pathname.startsWith("/__stub/")) return await control(req, res, url);
    return await api(req, res, url);
  } catch (error) {
    return send(res, 500, { error: String(error) });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  // Another process started the stub first: nothing to do.
  if (error.code === "EADDRINUSE") process.exit(0);
  throw error;
});
server.listen(port, "127.0.0.1");
