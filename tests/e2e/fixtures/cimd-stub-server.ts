/**
 * A local stand-in for a client's website, for the end-to-end run of one Client ID Metadata Document
 * pass (M10-07, M10-08). Two ways to use it, one file:
 *
 *  1. As a script. `node tests/e2e/fixtures/cimd-stub-server.ts 12113` (erasable TypeScript only):
 *     Playwright starts it beside the Vercel stub (playwright.config.ts) and every spec worker shares
 *     it through the control API below.
 *  2. As a module. `startCimdStub(redirectUri)` and `stopCimdStub(handle)` publish one ready-made
 *     document at `CIMD_CLIENT_ID` for a spec that only needs "a client with a metadata document":
 *     they talk to the shared script when it is up and start a private server on the same port when
 *     it is not.
 *
 * The app fetches `http://127.0.0.1:12113/...` only while the test hooks are on
 * (`testHooksEnabled()`, the CI production build and a preview deployment, never a Vercel
 * production deployment): with them off the same address is refused, and a spec skips.
 *
 *   GET  /<path>                        the document the spec set for <path> (404 until it did)
 *   POST /__stub/set                    {path, status?, headers?, json? | text? | base64?, delayMs?}
 *   GET  /__stub/hits?path=<path>       the requests that asked for <path>: method, accept,
 *                                       accept-encoding, user-agent, and whether a cookie or an
 *                                       Authorization header came with it
 *   GET  /__stub/health                 200 when it is up
 *
 * Shared by every spec worker and never reset: a spec uses a path of its own. The ready-made
 * document of `startCimdStub` lives at `/client.json`.
 */
import http from "node:http";

const DEFAULT_PORT = 12113;

/** The metadata-document client the ready-made document describes. */
export const CIMD_CLIENT_ID = `http://127.0.0.1:${DEFAULT_PORT}/client.json`;

interface Entry {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  delayMs: number;
}
interface Hit {
  n: number;
  method: string;
  accept: string | null;
  acceptEncoding: string | null;
  userAgent: string | null;
  hasCookie: boolean;
  hasAuthorization: boolean;
}

interface SetInput {
  path: string;
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  base64?: string;
  delayMs?: number;
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function createStubServer(port: number): http.Server {
  const entries = new Map<string, Entry>();
  const hits = new Map<string, Hit[]>();
  let counter = 0;

  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (url.pathname === "/__stub/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }

    if (url.pathname === "/__stub/set" && request.method === "POST") {
      const input = JSON.parse(await readBody(request)) as SetInput;
      const body =
        input.base64 !== undefined
          ? Buffer.from(input.base64, "base64")
          : Buffer.from(input.json !== undefined ? JSON.stringify(input.json) : (input.text ?? ""));
      const headers: Record<string, string> = {
        "content-type": input.json !== undefined ? "application/json" : "text/plain",
        ...(input.headers ?? {}),
      };
      entries.set(input.path, {
        status: input.status ?? 200,
        headers,
        body,
        delayMs: input.delayMs ?? 0,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }

    if (url.pathname === "/__stub/hits") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(hits.get(url.searchParams.get("path") ?? "") ?? []));
      return;
    }

    const entry = entries.get(url.pathname);
    const list = hits.get(url.pathname) ?? [];
    list.push({
      n: ++counter,
      method: request.method ?? "GET",
      accept: (request.headers.accept as string | undefined) ?? null,
      acceptEncoding: (request.headers["accept-encoding"] as string | undefined) ?? null,
      userAgent: (request.headers["user-agent"] as string | undefined) ?? null,
      hasCookie: request.headers.cookie !== undefined,
      hasAuthorization: request.headers.authorization !== undefined,
    });
    hits.set(url.pathname, list);

    if (!entry) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not set");
      return;
    }
    if (entry.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
    response.writeHead(entry.status, {
      ...entry.headers,
      "content-length": String(entry.body.length),
    });
    response.end(entry.body);
  });
}

// --- the module half ----------------------------------------------------------------------------

const STUB_ORIGIN = `http://127.0.0.1:${DEFAULT_PORT}`;

/** What `startCimdStub` returns: whether this call started the server itself. */
export interface CimdStubHandle {
  /** The private server this call started, or null when the shared script answered. */
  owned: http.Server | null;
}

async function setOnStub(input: SetInput): Promise<void> {
  const response = await fetch(`${STUB_ORIGIN}/__stub/set`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`The CIMD stub refused a document (${response.status}).`);
}

async function stubIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${STUB_ORIGIN}/__stub/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Publish a metadata document for `CIMD_CLIENT_ID` whose only redirect URI is `redirectUri`. The
 * document names itself "Metadata document app" and allows a one-minute cache so a repeat is cheap.
 */
export async function startCimdStub(redirectUri: string): Promise<CimdStubHandle> {
  let owned: http.Server | null = null;
  if (!(await stubIsUp())) {
    owned = createStubServer(DEFAULT_PORT);
    await new Promise<void>((resolve, reject) => {
      owned!.once("error", reject);
      owned!.listen(DEFAULT_PORT, "127.0.0.1", () => resolve());
    });
  }
  await setOnStub({
    path: "/client.json",
    json: {
      client_id: CIMD_CLIENT_ID,
      client_name: "Metadata document app",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    headers: { "cache-control": "max-age=60" },
  });
  return { owned };
}

/** Take the document down: close a private server, or answer 404 at `/client.json` on the shared one. */
export async function stopCimdStub(handle: CimdStubHandle): Promise<void> {
  if (handle.owned) {
    const server = handle.owned;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return;
  }
  await setOnStub({ path: "/client.json", status: 404, text: "gone" });
}

// --- the script half ----------------------------------------------------------------------------

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("cimd-stub-server.ts")) {
  createStubServer(Number(process.argv[2] ?? DEFAULT_PORT)).listen(
    Number(process.argv[2] ?? DEFAULT_PORT),
    "127.0.0.1",
  );
}
