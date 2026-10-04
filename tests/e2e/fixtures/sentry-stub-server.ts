/**
 * A local stand-in for Sentry's ingest endpoint (M9-10): it accepts the envelopes the SDKs post,
 * records them, and answers 200, so a build started with NEXT_PUBLIC_SENTRY_DSN pointing here can be
 * tested without any network. Run directly by Node (`node tests/e2e/fixtures/sentry-stub-server.ts
 * 12114`, erasable TypeScript only), once, by whoever starts the DSN-set build; the specs in
 * tests/e2e/m9/sentry-stub.spec.ts reach it over HTTP, so any number of Playwright workers share it.
 *
 *   POST /api/{project}/envelope/     the SDK's envelope (the browser and the server both post here;
 *                                     CORS is open so the browser's fetch can read the answer)
 *   GET  /__stub/envelopes            every envelope so far, in order: { n, receivedAt, items: [...] }
 *   GET  /__stub/health               ok
 *
 * The DSN to build with: http://stubkey@127.0.0.1:12114/1 (an http DSN is accepted for a loopback
 * host only, src/lib/sentry/dsn.ts).
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 12114);

interface Item {
  type: string;
  payload: unknown;
}
interface Recorded {
  n: number;
  receivedAt: number;
  origin: string | null;
  items: Item[];
}

const envelopes: Recorded[] = [];

/** An envelope is newline-delimited JSON: its header, then pairs of an item header and its payload. */
function parseEnvelope(body: string): Item[] {
  const lines = body.split("\n");
  const items: Item[] = [];
  for (let i = 1; i < lines.length; i += 2) {
    const header = lines[i];
    const payload = lines[i + 1];
    if (!header) continue;
    try {
      const { type } = JSON.parse(header) as { type?: string };
      let parsed: unknown = payload;
      try {
        parsed = JSON.parse(payload ?? "");
      } catch {
        // A payload that is not JSON stays as the text it was.
      }
      items.push({ type: type ?? "unknown", payload: parsed });
    } catch {
      // A line that is not an item header ends the envelope.
      break;
    }
  }
  return items;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/__stub/health") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (req.method === "GET" && url.pathname === "/__stub/envelopes") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(envelopes));
      return;
    }
    if (req.method === "POST" && /^\/api\/[^/]+\/envelope\/?$/.test(url.pathname)) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        envelopes.push({
          n: envelopes.length,
          receivedAt: Date.now(),
          origin: typeof req.headers.origin === "string" ? req.headers.origin : null,
          items: parseEnvelope(Buffer.concat(chunks).toString("utf8")),
        });
        res.writeHead(200, { ...CORS, "content-type": "application/json" }).end("{}");
      });
      return;
    }
    res.writeHead(404, CORS).end();
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`sentry stub on http://127.0.0.1:${port}`);
  });
