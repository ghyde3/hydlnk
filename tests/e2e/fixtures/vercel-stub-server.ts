/**
 * A local stand-in for the one part of the Vercel REST API that HYDLNK calls today: taking a
 * hostname off the project (`DELETE /v9/projects/{project}/domains/{hostname}`), which deleting a
 * page or an account does for every custom domain it holds (M4-19, M4-34). Run directly by Node
 * (`node tests/e2e/fixtures/vercel-stub-server.ts 12112`, erasable TypeScript only): Playwright
 * starts it as a second `webServer` (playwright.config.ts), and the dev server reaches it through
 * VERCEL_API_BASE_URL (http://127.0.0.1:12112, written to .env.local with placeholder token, project
 * and team ids by scripts/lib/local-env-placeholders.sh). Never a real token, never the real API.
 *
 * It answers 200 `{}` to a delete (the Vercel behaviour for a hostname the project holds), records
 * every API request for the specs to assert on, and exposes a control API under /__stub/ to inject
 * a failure for one hostname. It is shared by every spec worker, so nothing here is reset by a
 * spec: specs filter the request log by the hostnames they created. Playwright owns its lifecycle
 * (it starts it before the run and stops it after), so it never exits on its own: a run of any length
 * keeps it.
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 12112);

interface Recorded {
  n: number;
  method: string;
  path: string;
  query: Record<string, string>;
  hasBearer: boolean;
}
interface Failure {
  contains: string;
  status: number;
  times: number;
}

const requests: Recorded[] = [];
const failures: Failure[] = [];
let counter = 0;

const base = `http://127.0.0.1:${port}`;

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

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
  if (path === "/__stub/requests") return send(res, 200, requests);
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
    failures.length = 0;
    return send(res, 200, { ok: true });
  }
  if (path === "/__stub/shutdown") {
    send(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 20);
    return;
  }
  return send(res, 404, { error: "unknown control path" });
}

function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const method = req.method ?? "GET";
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  const auth = req.headers.authorization;
  requests.push({
    n: ++counter,
    method,
    path: url.pathname,
    query,
    hasBearer: typeof auth === "string" && /^Bearer \S{8,}$/.test(auth),
  });

  const index = failures.findIndex((failure) => url.pathname.includes(failure.contains));
  if (index >= 0) {
    const failure = failures[index]!;
    failure.times -= 1;
    if (failure.times <= 0) failures.splice(index, 1);
    return send(res, failure.status, {
      error: { code: "injected", message: "Injected failure from the stub" },
    });
  }

  if (method === "DELETE" && /^\/v9\/projects\/[^/]+\/domains\/[^/]+$/.test(url.pathname)) {
    return send(res, 200, {});
  }
  return send(res, 404, { error: { code: "not_found", message: "Not found" } });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", base);
  try {
    if (url.pathname.startsWith("/__stub/")) return await control(req, res, url);
    return api(req, res, url);
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
