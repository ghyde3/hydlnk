/**
 * A local stand-in for the parts of the Stripe API that HYDLNK calls (customers, Checkout
 * sessions, billing-portal sessions, subscriptions), for the billing specs. Run directly by Node
 * (`node tests/e2e/fixtures/stripe-stub-server.ts 12111`, erasable TypeScript only): the specs
 * start it on demand with stripe-stub.ts and the dev server reaches it through STRIPE_API_HOST
 * (127.0.0.1:12111, written to .env.local by scripts/init.sh).
 *
 * It records every API request (method, path, form fields, the Stripe-Version header) for the
 * specs to assert on, and exposes a control API under /__stub/ to seed subscriptions and inject
 * failures. It is shared by every spec worker, so nothing here is global-reset: specs filter the
 * request log by the customer or subscription ids they created. Exits after 20 idle minutes.
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 12111);
const IDLE_MS = 20 * 60 * 1000;

type Fields = Record<string, string>;
interface Recorded {
  n: number;
  method: string;
  path: string;
  query: Fields;
  form: Fields;
  stripeVersion: string | null;
  hasAuth: boolean;
  idempotencyKey: string | null;
}
interface Failure {
  method: string;
  contains: string;
  status: number;
  times: number;
}
interface Sub {
  id: string;
  customer: string;
  status: string;
  priceId: string;
  itemId: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number;
  metadata: Fields;
}
interface Session {
  id: string;
  customer: string | null;
  status: "open" | "complete" | "expired";
  /** Unix seconds, like Stripe's. A session seeded through the control API is an hour old unless said otherwise. */
  created: number;
}
interface Delay {
  method: string;
  contains: string;
  ms: number;
  times: number;
}

const requests: Recorded[] = [];
const customers = new Map<string, { id: string; email: string | null; metadata: Fields }>();
const customerByIdempotencyKey = new Map<string, string>();
const subs = new Map<string, Sub>();
const sessions = new Map<string, Session>();
const failures: Failure[] = [];
const delays: Delay[] = [];
/**
 * Idempotency keys of POST /v1/checkout/sessions, like Stripe's: the same key with the same body
 * replays the first answer (even after that session was expired); the same key with another body is
 * an idempotency_error; the same key while the first request is still being served (see the
 * /__stub/delay control) is a 409 idempotency_key_in_use.
 */
const sessionByKey = new Map<string, { fingerprint: string; body: unknown }>();
const keysInFlight = new Set<string>();
let counter = 0;
let lastActivity = Date.now();

const base = `http://127.0.0.1:${port}`;

function subJson(sub: Sub) {
  return {
    id: sub.id,
    object: "subscription",
    customer: sub.customer,
    status: sub.status,
    cancel_at_period_end: sub.cancelAtPeriodEnd,
    metadata: sub.metadata,
    items: {
      object: "list",
      data: [
        {
          id: sub.itemId,
          object: "subscription_item",
          current_period_end: sub.currentPeriodEnd,
          price: { id: sub.priceId, object: "price" },
        },
      ],
    },
  };
}

function sessionJson(session: Session, form: Fields = {}) {
  return {
    id: session.id,
    object: "checkout.session",
    mode: form.mode ?? "subscription",
    status: session.status,
    created: session.created,
    customer: session.customer,
    client_reference_id: form.client_reference_id ?? null,
    url: session.status === "open" ? `${base}/c/pay/${session.id}` : null,
  };
}

const notFound = (what: string) => ({
  status: 404,
  body: {
    error: { type: "invalid_request_error", code: "resource_missing", message: `No such ${what}` },
  },
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function takeDelay(method: string, haystack: string): number {
  const index = delays.findIndex((d) => d.method === method && haystack.includes(d.contains));
  if (index < 0) return 0;
  const delay = delays[index]!;
  delay.times -= 1;
  if (delay.times <= 0) delays.splice(index, 1);
  return delay.ms;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function takeFailure(method: string, haystack: string): Failure | undefined {
  const index = failures.findIndex((f) => f.method === method && haystack.includes(f.contains));
  if (index < 0) return undefined;
  const failure = failures[index]!;
  failure.times -= 1;
  if (failure.times <= 0) failures.splice(index, 1);
  return failure;
}

async function control(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const path = url.pathname;
  if (path === "/__stub/health") return send(res, 200, { ok: true, port });
  if (path === "/__stub/requests") return send(res, 200, requests);
  if (path === "/__stub/subscriptions" && req.method === "POST") {
    const input = JSON.parse(await readBody(req)) as Partial<Sub> & {
      id: string;
      customer: string;
    };
    const sub: Sub = {
      id: input.id,
      customer: input.customer,
      status: input.status ?? "active",
      priceId: input.priceId ?? "price_unset",
      itemId: input.itemId ?? `si_${input.id.replace(/^sub_/, "")}`,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: input.currentPeriodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400,
      metadata: input.metadata ?? {},
    };
    subs.set(sub.id, sub);
    return send(res, 200, subJson(sub));
  }
  if (path === "/__stub/sessions" && req.method === "POST") {
    // Seeds a Checkout Session without going through the recorded API (an open one, by default).
    const input = JSON.parse(await readBody(req)) as Partial<Session>;
    const id = `cs_test_seed_${Date.now().toString(36)}_${++counter}`;
    const session: Session = {
      id,
      customer: input.customer ?? null,
      status: input.status ?? "open",
      created: input.created ?? Math.floor(Date.now() / 1000) - 3600,
    };
    sessions.set(id, session);
    return send(res, 200, session);
  }
  if (path === "/__stub/customer-sessions" && req.method === "GET") {
    // Every session of one customer, whatever its status: the spec's view of what can still be paid.
    const customer = url.searchParams.get("customer");
    return send(
      res,
      200,
      [...sessions.values()].filter((s) => s.customer === customer),
    );
  }
  if (path === "/__stub/delay" && req.method === "POST") {
    // Makes the next `times` matching requests wait `ms` before they are served (an in-flight window).
    const input = JSON.parse(await readBody(req)) as Delay;
    delays.push({ ...input, times: input.times ?? 1 });
    return send(res, 200, { ok: true });
  }
  if (path === "/__stub/session" && req.method === "GET") {
    const session = sessions.get(url.searchParams.get("id") ?? "");
    return session ? send(res, 200, session) : send(res, 404, { error: "unknown" });
  }
  if (path === "/__stub/subscription" && req.method === "GET") {
    const sub = subs.get(url.searchParams.get("id") ?? "");
    return sub ? send(res, 200, subJson(sub)) : send(res, 404, { error: "unknown" });
  }
  if (path === "/__stub/fail" && req.method === "POST") {
    const input = JSON.parse(await readBody(req)) as Failure;
    failures.push({ ...input, times: input.times ?? 1 });
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

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const method = req.method ?? "GET";
  const raw = await readBody(req);
  const form: Fields = {};
  for (const [key, value] of new URLSearchParams(raw)) form[key] = value;
  const query: Fields = {};
  for (const [key, value] of url.searchParams) query[key] = value;

  requests.push({
    n: ++counter,
    method,
    path: url.pathname,
    query,
    form,
    stripeVersion: (req.headers["stripe-version"] as string | undefined) ?? null,
    hasAuth: typeof req.headers.authorization === "string" && req.headers.authorization.length > 10,
    idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? null,
  });

  const injected = takeFailure(method, `${url.pathname}${url.search} ${raw}`);
  if (injected) {
    return send(res, injected.status, {
      error: { type: "api_error", message: "Injected failure from the stub" },
    });
  }

  const path = url.pathname;
  let match: RegExpMatchArray | null;

  if (method === "POST" && path === "/v1/customers") {
    const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
    const known = key ? customerByIdempotencyKey.get(key) : undefined;
    if (known) return send(res, 200, { object: "customer", ...customers.get(known)! });
    const id = `cus_stub_${Date.now().toString(36)}_${counter}`;
    const metadata: Fields = {};
    for (const [name, value] of Object.entries(form)) {
      const m = /^metadata\[(.+)\]$/.exec(name);
      if (m) metadata[m[1]!] = value;
    }
    const customer = { id, email: form.email ?? null, metadata };
    customers.set(id, customer);
    if (key) customerByIdempotencyKey.set(key, id);
    return send(res, 200, { object: "customer", ...customer });
  }

  // The app asks Stripe whether a stored customer id still exists before it uses it (a sandbox id
  // can be gone after the switch to live). The specs write ids like `cus_zq...` straight into
  // accounts.stripe_customer_id, so an id the stub never created is a customer that exists; only an
  // id that starts with `cus_gone` stands for one Stripe no longer knows.
  if (method === "GET" && (match = path.match(/^\/v1\/customers\/([^/]+)$/))) {
    const id = decodeURIComponent(match[1]!);
    if (id.startsWith("cus_gone")) {
      const missing = notFound("customer");
      return send(res, missing.status, missing.body);
    }
    const known = customers.get(id) ?? { id, email: null, metadata: {} };
    customers.set(id, known);
    return send(res, 200, { object: "customer", ...known });
  }

  if (method === "POST" && path === "/v1/checkout/sessions") {
    const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
    const fingerprint = JSON.stringify(Object.entries(form).sort());
    const known = key ? sessionByKey.get(key) : undefined;
    if (known) {
      if (known.fingerprint !== fingerprint) {
        return send(res, 400, {
          error: {
            type: "idempotency_error",
            message:
              "Keys for idempotent requests can only be used with the same parameters they were first used with.",
          },
        });
      }
      return send(res, 200, known.body);
    }
    if (key && keysInFlight.has(key)) {
      return send(res, 409, {
        error: {
          type: "idempotency_error",
          code: "idempotency_key_in_use",
          message:
            "There is currently another in-progress request using this Idempotent Request key.",
        },
      });
    }
    if (key) keysInFlight.add(key);
    try {
      const wait = takeDelay(method, `${url.pathname}${url.search} ${raw}`);
      if (wait > 0) await sleep(wait);
      const id = `cs_test_stub_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
      sessions.set(id, {
        id,
        customer: form.customer ?? null,
        status: "open",
        created: Math.floor(Date.now() / 1000),
      });
      const body = sessionJson(sessions.get(id)!, form);
      if (key) sessionByKey.set(key, { fingerprint, body });
      return send(res, 200, body);
    } finally {
      if (key) keysInFlight.delete(key);
    }
  }

  if (method === "GET" && (match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) {
    const session = sessions.get(match[1]!);
    return session
      ? send(res, 200, sessionJson(session))
      : send(res, 404, notFound("checkout session").body);
  }

  if (method === "GET" && path === "/v1/checkout/sessions") {
    const customer = url.searchParams.get("customer");
    const status = url.searchParams.get("status");
    const data = [...sessions.values()]
      .filter((s) => !customer || s.customer === customer)
      .filter((s) => !status || s.status === status)
      .map((s) => sessionJson(s));
    return send(res, 200, { object: "list", data, has_more: false, url: "/v1/checkout/sessions" });
  }

  if (method === "POST" && (match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
    const session = sessions.get(match[1]!);
    if (!session) return send(res, 404, notFound("checkout session").body);
    if (session.status !== "open") {
      return send(res, 400, {
        error: {
          type: "invalid_request_error",
          message: 'Only Checkout Sessions with a status in ["open"] can be expired.',
        },
      });
    }
    session.status = "expired";
    return send(res, 200, sessionJson(session));
  }

  if (method === "POST" && path === "/v1/billing_portal/sessions") {
    const id = `bps_stub_${Date.now().toString(36)}_${counter}`;
    return send(res, 200, {
      id,
      object: "billing_portal.session",
      customer: form.customer ?? null,
      return_url: form.return_url ?? null,
      url: `${base}/p/session/${id}`,
    });
  }

  if (method === "GET" && path === "/v1/subscriptions") {
    const customer = url.searchParams.get("customer");
    const data = [...subs.values()]
      .filter((s) => !customer || s.customer === customer)
      .map(subJson);
    return send(res, 200, { object: "list", data, has_more: false, url: "/v1/subscriptions" });
  }

  if ((match = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
    const sub = subs.get(match[1]!);
    if (method === "GET")
      return sub ? send(res, 200, subJson(sub)) : send(res, 404, notFound("subscription").body);
    if (method === "DELETE") {
      if (!sub) return send(res, 404, notFound("subscription").body);
      sub.status = "canceled";
      return send(res, 200, subJson(sub));
    }
  }

  return send(res, 404, notFound("endpoint").body);
}

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  const url = new URL(req.url ?? "/", base);
  try {
    if (url.pathname.startsWith("/__stub/")) return await control(req, res, url);
    if (url.pathname.startsWith("/v1/")) return await api(req, res, url);
    if (url.pathname.startsWith("/c/pay/") || url.pathname.startsWith("/p/session/")) {
      const title = url.pathname.startsWith("/c/")
        ? "Stripe Checkout (stub)"
        : "Stripe portal (stub)";
      return send(
        res,
        200,
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><h1>${title}</h1>`,
        "text/html; charset=utf-8",
      );
    }
    return send(res, 404, { error: "not found" });
  } catch (error) {
    return send(res, 500, { error: String(error) });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  // Another spec worker started the stub first: nothing to do.
  if (error.code === "EADDRINUSE") process.exit(0);
  throw error;
});
server.listen(port, "127.0.0.1");
setInterval(() => {
  if (Date.now() - lastActivity > IDLE_MS) process.exit(0);
}, 60_000).unref();
