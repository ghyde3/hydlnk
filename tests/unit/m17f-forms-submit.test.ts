import { afterEach, describe, expect, it, vi } from "vitest";
import { blockDefaults, type FormBlock } from "@/lib/document";
import type { FormTarget } from "@/lib/analytics/ingest/types";
import type { PlanId } from "@/lib/limits";
import type { RateLimitResult } from "@/lib/rate-limit";
import type { FormRenderState, RecordStatus } from "@/lib/forms/contract";
import { contactFormBlock } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

// The real limiter runs in two tests below with in-memory stores: no secret, no database.
vi.mock("@/lib/analytics/ingest/secret", () => ({ visitorHashSecret: () => "unused" }));
vi.mock("@/lib/rate-limit/store", () => ({
  createSupabaseRateLimitStore: () => {
    throw new Error("the tests pass their own store");
  },
}));

const {
  handleFormOpen,
  handleFormPost,
  handleFormSent,
  formMethodNotAllowed,
  formSiteHourlyLimit,
  MIN_FILL_SECONDS,
} = await import("@/lib/forms/submit");
const { notice } = await import("@/lib/analytics/ingest/click-common");
const { rateLimit, rateLimitAge, rateLimitPeek } = await import("@/lib/rate-limit");
const { issueFormToken } = await import("@/lib/forms/token");
const { TENANT_PAGE_CSP } = await import("@/lib/routing/tenant-headers");

/**
 * M17-05, M17-06, M17-10 (the hand-off): every step of POST /f/{pageId}/{blockId} in its order, with
 * spies for everything outside the request. Proves: nothing is looked up before the limiter, nothing
 * is stored before the last step, the dropped cases answer a success byte for byte, the Location is
 * built from the ids alone, and nothing a visitor typed reaches the console.
 */

const PAGE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const SIGNUP: FormBlock = { ...(blockDefaults.form() as FormBlock), id: "formSign01" };
const CONTACT: FormBlock = { ...contactFormBlock, id: "formCont01" };
const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IP = "203.0.113.77";
const SECRET = "test-secret";
const NOW = new Date("2026-11-26T12:00:00.000Z");

const PII = ["visitor@example.test", "Vera Visitor", "secret message text", IP, UA];

/** A target as the tests write it: the plan defaults to Free. */
type TestTarget = Omit<FormTarget, "plan"> & { plan?: PlanId };

interface Setup {
  block?: FormBlock;
  target?: TestTarget | null | Error;
  /** Seconds since the open marker; null = none. */
  openedAgo?: number | null;
  limits?: Record<string, RateLimitResult>;
  status?: RecordStatus | Error;
  blocked?: boolean | Error;
  html?: string | null;
}

function setup(over: Setup = {}) {
  const calls: string[] = [];
  const block = over.block ?? SIGNUP;
  const raw: TestTarget | null | Error =
    over.target === undefined
      ? { block, handle: "mara", customHosts: ["links.example.test"] }
      : over.target;
  const target: FormTarget | null | Error =
    raw === null || raw instanceof Error ? raw : { plan: "free", ...raw };
  const scheduled: (() => Promise<void>)[] = [];
  const rendered: FormRenderState[] = [];
  const deps = {
    rateLimit: vi.fn(async (key: string, ..._rest: number[]): Promise<RateLimitResult> => {
      const prefix = key.split(":")[0]!;
      calls.push(`limit:${prefix}`);
      return over.limits?.[prefix] ?? { allowed: true, retryAfter: 0 };
    }),
    rateLimitPeek: vi.fn(async (key: string, ..._rest: number[]): Promise<RateLimitResult> => {
      const prefix = key.split(":")[0]!;
      calls.push(`peek:${prefix}`);
      return over.limits?.[prefix] ?? { allowed: true, retryAfter: 0 };
    }),
    rateLimitAge: vi.fn(async (key: string, ..._rest: number[]): Promise<number | null> => {
      calls.push(`age:${key.split(":")[0]!}`);
      return over.openedAgo === undefined ? 10 : over.openedAgo;
    }),
    now: () => NOW,
    visitorHash: vi.fn(() => "a".repeat(64)),
    tokenSecret: () => SECRET,
    resolveFormBlock: vi.fn(async () => {
      calls.push("resolve");
      if (target instanceof Error) throw target;
      return target;
    }),
    lookupSite: vi.fn(async () => {
      calls.push("lookupSite");
      return target instanceof Error || target === null
        ? null
        : { handle: target.handle, customHosts: target.customHosts };
    }),
    renderFormPage: vi.fn(async ({ state }: { state: FormRenderState }) => {
      calls.push(`render:${state.view}`);
      rendered.push(state);
      return over.html === undefined ? `<html>${state.view}</html>` : over.html;
    }),
    hasBlockedLink: vi.fn(async () => {
      calls.push("blocklist");
      if (over.blocked instanceof Error) throw over.blocked;
      return over.blocked ?? false;
    }),
    recordSubmission: vi.fn(async (_row?: { blockId: string; email: string }) => {
      calls.push("record");
      if (over.status instanceof Error) throw over.status;
      return { status: over.status ?? "stored", ownerId: "owner-0000-0001" };
    }),
    insertEvent: vi.fn(async () => undefined),
    notifyOwnerOfMessage: vi.fn(async () => "sent"),
    notifyOwnerOfLimit: vi.fn(async () => "sent"),
    schedule: vi.fn((task: () => Promise<void>) => {
      scheduled.push(task);
    }),
    rootDomain: "localhost:3000",
    homeHref: "http://localhost:3000/",
  };
  const flush = async () => {
    for (const task of scheduled.splice(0)) await task();
  };
  return { deps, calls, scheduled, rendered, flush };
}

function post(
  body: Record<string, string> | string,
  headers: Record<string, string | null> = {},
  url = `http://mara.localhost:3000/f/${PAGE}/formSign01`,
): Request {
  const merged: Record<string, string> = {
    host: "mara.localhost:3000",
    origin: "http://mara.localhost:3000",
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "document",
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    "x-forwarded-for": IP,
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return new Request(url, {
    method: "POST",
    headers: merged,
    body: typeof body === "string" ? body : new URLSearchParams(body).toString(),
  });
}

const signupBody = { email: "visitor@example.test", hl_confirm: "", t: "" };
const contactBody = {
  name: "Vera Visitor",
  email: "visitor@example.test",
  message: "secret message text",
  hl_confirm: "",
  t: "",
};
const params = (blockId = "formSign01") => ({ pageId: PAGE, blockId });

async function shape(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers.entries()],
    body: await response.text(),
  };
}

/** One in-memory store behind every limiter call, like rate_limit_hit, _age and _peek. */
function sharedStore(clock: () => number) {
  const hits = new Map<string, number[]>();
  const live = (bucket: string, window: number) =>
    (hits.get(bucket) ?? []).filter((at) => at > clock() - window * 1000);
  return {
    async hit(bucket: string, limit: number, window: number) {
      const rows = live(bucket, window);
      hits.set(bucket, rows);
      if (rows.length >= limit) return { allowed: false, retryAfter: 1 };
      rows.push(clock());
      return { allowed: true, retryAfter: 0 };
    },
    async peek(bucket: string, limit: number, window: number) {
      return live(bucket, window).length >= limit
        ? { allowed: false, retryAfter: 1 }
        : { allowed: true, retryAfter: 0 };
    },
    async age(bucket: string, window: number) {
      const rows = live(bucket, window);
      return rows.length === 0 ? null : Math.floor((clock() - rows[0]!) / 1000);
    },
  };
}

/**
 * `s.deps` with the real limiter over one in-memory store; with `marker`, the open marker's read too
 * (otherwise the setup's marker of 10 seconds stands).
 */
function realLimiter(
  s: ReturnType<typeof setup>,
  clock: () => number = () => 5_000_000,
  marker = false,
) {
  const store = sharedStore(clock);
  s.deps.rateLimit = vi.fn((key: string, limit: number, window: number) =>
    rateLimit(key, limit, window, { store, secret: SECRET }),
  );
  s.deps.rateLimitPeek = vi.fn((key: string, limit: number, window: number) =>
    rateLimitPeek(key, limit, window, { store, secret: SECRET }),
  );
  if (marker) {
    s.deps.rateLimitAge = vi.fn((key: string, window: number) =>
      rateLimitAge(key, window, { store, secret: SECRET }),
    );
  }
  return store;
}

let logged: string[] = [];
afterEach(() => {
  // Nothing a visitor typed, and no IP address or user agent, was written to the console.
  for (const line of logged) for (const value of PII) expect(line).not.toContain(value);
  logged = [];
  vi.restoreAllMocks();
});
function spyConsole() {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
}

describe("M17-06 a stored submission", () => {
  it("answers 303 to the sent page, stores once, and records the click after the response", async () => {
    spyConsole();
    const s = setup();
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/f/${PAGE}/formSign01`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(s.deps.recordSubmission).toHaveBeenCalledTimes(1);
    expect(s.deps.recordSubmission).toHaveBeenCalledWith({
      siteId: PAGE,
      blockId: "formSign01",
      entryId: null,
      kind: "signup",
      email: "visitor@example.test",
      name: "",
      message: "",
    });
    expect(s.deps.insertEvent).not.toHaveBeenCalled();
    await s.flush();
    expect(s.deps.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ page_id: PAGE, block_id: "formSign01", type: "click" }),
    );
  });

  it("the order: cross-site and ids, limiter, body, block, fields, fill time, the per-form limit and the site's hour (read), the drops, the store, then the site's hour counted", async () => {
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
    });
    await handleFormPost(post(contactBody), params("formCont01"), s.deps);
    expect(s.calls).toEqual([
      "limit:form-post",
      "resolve",
      "age:form-open",
      "limit:form-block",
      "peek:form-site",
      "blocklist",
      "record",
      "limit:form-site",
    ]);
  });

  it("a form on a sub-page stores its entry id and records the click under it", async () => {
    const s = setup({
      target: {
        block: SIGNUP,
        handle: "mara",
        customHosts: [],
        subPageId: "e1e1e1e1-0000-4000-8000-000000000001",
      },
    });
    await handleFormPost(post(signupBody), params(), s.deps);
    expect(s.deps.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "e1e1e1e1-0000-4000-8000-000000000001" }),
    );
    await s.flush();
    expect(s.deps.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sub_page_id: "e1e1e1e1-0000-4000-8000-000000000001" }),
    );
  });

  it("the Location never comes from the request: no query, no Host, no X-Forwarded-Host", async () => {
    const s = setup();
    const response = await handleFormPost(
      post(
        signupBody,
        { "x-forwarded-host": "evil.example" },
        `http://mara.localhost:3000/f/${PAGE}/formSign01?next=//evil.example`,
      ),
      { pageId: PAGE.toUpperCase(), blockId: "formSign01" },
      s.deps,
    );
    expect(response.headers.get("location")).toBe(`/f/${PAGE}/formSign01`);
    expect([301, 307, 308]).not.toContain(response.status);
  });
});

describe("M17-06 refusals before any lookup", () => {
  it.each([
    ["a page id that is not a UUID", { pageId: "not-a-uuid", blockId: "formSign01" }],
    ["a block id that is too short", { pageId: PAGE, blockId: "short" }],
    ["a block id with a slash", { pageId: PAGE, blockId: "formSign01/../x" }],
  ])("%s: 404 and no query at all", async (_name, p) => {
    const s = setup();
    const response = await handleFormPost(post(signupBody), p, s.deps);
    expect(response.status).toBe(404);
    expect(s.calls).toEqual([]);
  });

  it.each([
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site (another subdomain)", { "sec-fetch-site": "same-site" }],
    ["an Origin of another host", { origin: "http://evil.example", "sec-fetch-site": null }],
    ["Origin null without same-origin", { origin: "null", "sec-fetch-site": null }],
  ])("a cross-site POST (%s) is 403 before the limiter", async (_name, headers) => {
    const s = setup();
    const response = await handleFormPost(post(signupBody, headers), params(), s.deps);
    expect(response.status).toBe(403);
    expect(s.calls).toEqual([]);
  });

  it("10 POSTs per client in 10 minutes: 429 with Retry-After, nothing looked up", async () => {
    const s = setup({ limits: { "form-post": { allowed: false, retryAfter: 42 } } });
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(s.calls).toEqual(["limit:form-post"]);
    expect(s.deps.rateLimit).toHaveBeenCalledWith(`form-post:${IP}`, 10, 600);
  });

  it("another content type is 415 and a body over 32,768 bytes is 413, before the lookup", async () => {
    const s = setup();
    const json = await handleFormPost(
      post("{}", { "content-type": "application/json" }),
      params(),
      s.deps,
    );
    expect(json.status).toBe(415);
    const big = await handleFormPost(
      post({ ...signupBody, email: "x".repeat(33_000) }),
      params(),
      s.deps,
    );
    expect(big.status).toBe(413);
    const declared = await handleFormPost(
      post(signupBody, { "content-length": "40000" }),
      params(),
      s.deps,
    );
    expect(declared.status).toBe(413);
    expect(s.deps.resolveFormBlock).not.toHaveBeenCalled();
  });
});

describe("M17-06 the block and the host", () => {
  it("an unknown, hidden, draft-only or foreign block answers the 404 notice and stores nothing", async () => {
    const s = setup({ target: null });
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This form isn’t available.");
    expect(s.deps.recordSubmission).not.toHaveBeenCalled();
  });

  it("a database error is the 503 notice, with no personal data in the log", async () => {
    spyConsole();
    const s = setup({ target: new Error("db down for page") });
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(503);
    expect(logged.join("\n")).toContain("[forms] loading the form failed");
  });

  it("only the site's own hosts: another tenant, the root host and a forwarded host are 404", async () => {
    for (const headers of [
      { host: "other.localhost:3000", origin: "http://other.localhost:3000" } as Record<
        string,
        string
      >,
      { host: "localhost:3000", origin: "http://localhost:3000" },
      {
        host: "evil.example",
        origin: "http://evil.example",
        "x-forwarded-host": "mara.localhost:3000",
      },
    ]) {
      const s = setup();
      const response = await handleFormPost(post(signupBody, headers), params(), s.deps);
      expect(response.status, headers.host).toBe(404);
      expect(s.deps.recordSubmission).not.toHaveBeenCalled();
    }
    const custom = setup();
    const ok = await handleFormPost(
      post(signupBody, { host: "links.example.test", origin: "https://links.example.test" }),
      params(),
      custom.deps,
    );
    expect(ok.status).toBe(303);
  });
});

describe("M17-06 dropped like a success, byte for byte", () => {
  it("a bot, a filled honeypot and a blocked link answer exactly as a stored submission and store nothing", async () => {
    const stored = await shape(await handleFormPost(post(signupBody), params(), setup().deps));
    const cases = [
      {
        s: setup(),
        req: post(signupBody, { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
        p: params(),
      },
      { s: setup(), req: post({ ...signupBody, hl_confirm: "filled" }), p: params() },
      { s: setup(), req: post(signupBody, { "user-agent": null }), p: params() },
      {
        s: setup({
          block: CONTACT,
          target: { block: CONTACT, handle: "mara", customHosts: [] },
          blocked: true,
        }),
        req: post(
          { ...contactBody, message: "see https://blocked.example/x" },
          {},
          `http://mara.localhost:3000/f/${PAGE}/formCont01`,
        ),
        p: params("formCont01"),
      },
    ];
    for (const { s, req, p } of cases) {
      const answer = await shape(await handleFormPost(req, p, s.deps));
      expect(answer).toEqual({
        ...stored,
        headers: stored.headers.map(([k, v]) => [
          k,
          k === "location" ? `/f/${PAGE}/${p.blockId}` : v,
        ]),
      });
      expect(s.deps.recordSubmission).not.toHaveBeenCalled();
      await s.flush();
      expect(s.deps.insertEvent).not.toHaveBeenCalled();
    }
  });

  it.each(["duplicate", "over_limit", "over_limit_first", "over_daily_limit"] as const)(
    "%s answers the same 303 as stored, records no click and sends no message email",
    async (status) => {
      const stored = await shape(await handleFormPost(post(signupBody), params(), setup().deps));
      const s = setup({
        block: { ...CONTACT, id: "formSign01" },
        target: { block: { ...CONTACT, id: "formSign01" }, handle: "mara", customHosts: [] },
        status,
      });
      const answer = await shape(await handleFormPost(post(contactBody), params(), s.deps));
      expect(answer).toEqual(stored);
      await s.flush();
      expect(s.deps.insertEvent).not.toHaveBeenCalled();
      expect(s.deps.notifyOwnerOfMessage).not.toHaveBeenCalled();
      expect(s.deps.notifyOwnerOfLimit).toHaveBeenCalledTimes(
        status === "over_limit_first" ? 1 : 0,
      );
    },
  );

  it("the blocklist that cannot answer is the 503 notice and stores nothing", async () => {
    spyConsole();
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
      blocked: new Error("blocklist down"),
    });
    const response = await handleFormPost(post(contactBody), params("formCont01"), s.deps);
    expect(response.status).toBe(503);
    expect(s.deps.recordSubmission).not.toHaveBeenCalled();
  });

  it("a database error while storing is the 503 notice; the log holds the code only", async () => {
    spyConsole();
    const failure = Object.assign(
      new Error("record_form_submission failed: visitor@example.test"),
      {
        code: "57014",
      },
    );
    const s = setup({ status: failure });
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(503);
    expect(logged.join("\n")).toContain("57014");
    expect(logged.join("\n")).not.toContain("visitor@example.test");
  });
});

describe("M17-06 the fields", () => {
  it("a bad field answers 422 with the error view, the values typed and a fresh token, and stores nothing", async () => {
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
    });
    const response = await handleFormPost(
      post({ ...contactBody, email: "" }),
      params("formCont01"),
      s.deps,
    );
    expect(response.status).toBe(422);
    expect(s.rendered[0]).toMatchObject({
      view: "error",
      blockId: "formCont01",
      values: { email: "", name: "Vera Visitor", message: "secret message text" },
      errors: { email: "Enter an email address." },
    });
    expect(s.rendered[0]!.token).toMatch(/^v1\./);
    expect(s.deps.recordSubmission).not.toHaveBeenCalled();
  });

  it("more than 5 links in a message is a field error; a link in a name too", async () => {
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
    });
    const links = Array.from({ length: 6 }, (_, i) => `https://a${i}.example`).join(" ");
    expect(
      (await handleFormPost(post({ ...contactBody, message: links }), params("formCont01"), s.deps))
        .status,
    ).toBe(422);
    expect(
      (
        await handleFormPost(
          post({ ...contactBody, name: "www.spam.example" }),
          params("formCont01"),
          s.deps,
        )
      ).status,
    ).toBe(422);
    expect(s.deps.hasBlockedLink).not.toHaveBeenCalled();
  });

  it("the block, its kind and its settings come from the published document, never the request", async () => {
    const s = setup();
    await handleFormPost(
      post({ ...signupBody, name: "Ignored", message: "ignored", kind: "contact" }),
      params(),
      s.deps,
    );
    expect(s.deps.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "signup", name: "", message: "" }),
    );
  });
});

describe("M17-06 the fill time and the token", () => {
  it(`no open marker: the confirm page with the values and a token; a marker under ${MIN_FILL_SECONDS} s too`, async () => {
    for (const openedAgo of [null, 0, 2]) {
      const s = setup({ openedAgo });
      const response = await handleFormPost(post(signupBody), params(), s.deps);
      expect(response.status).toBe(200);
      expect(s.rendered[0]).toMatchObject({
        view: "confirm",
        values: { email: "visitor@example.test" },
      });
      expect(s.deps.recordSubmission).not.toHaveBeenCalled();
    }
    const ok = setup({ openedAgo: 3 });
    expect((await handleFormPost(post(signupBody), params(), ok.deps)).status).toBe(303);
  });

  const tokenAt = (
    ageMs: number,
    binding: Partial<{ blockId: string; client: string; pageId: string }> = {},
  ) =>
    issueFormToken({
      pageId: PAGE,
      blockId: "formSign01",
      client: IP,
      secret: SECRET,
      ...binding,
      now: new Date(NOW.getTime() - ageMs),
    });

  it("a token between 2 s and 1 h stores without a marker, and works once", async () => {
    const token = tokenAt(5000);
    const s = setup({ openedAgo: null });
    expect((await handleFormPost(post({ ...signupBody, t: token }), params(), s.deps)).status).toBe(
      303,
    );
    expect(s.deps.rateLimit).toHaveBeenCalledWith(`form-token:${token.split(".")[2]}`, 1, 3600);
    expect(s.calls).not.toContain("age:form-open");
    const reused = setup({
      openedAgo: null,
      limits: { "form-token": { allowed: false, retryAfter: 3000 } },
    });
    const again = await handleFormPost(post({ ...signupBody, t: token }), params(), reused.deps);
    expect(again.status).toBe(200);
    expect(reused.rendered[0]!.view).toBe("confirm");
    expect(reused.rendered[0]!.token).not.toBe(token);
    expect(reused.deps.recordSubmission).not.toHaveBeenCalled();
  });

  it.each([
    ["too young", tokenAt(1500)],
    ["expired", tokenAt(3_600_001)],
    ["forged", `v1.${NOW.getTime() - 5000}.${"0".repeat(64)}`],
    ["for another block", tokenAt(5000, { blockId: "formOther1" })],
    ["for another client", tokenAt(5000, { client: "198.51.100.1" })],
    ["for another site", tokenAt(5000, { pageId: "00000000-0000-4000-8000-000000000001" })],
    ["over-long", `${tokenAt(5000)}${"a".repeat(200)}`],
  ])("a token %s shows the confirm page again, even with an old marker", async (_name, token) => {
    const s = setup({ openedAgo: 600 });
    const response = await handleFormPost(post({ ...signupBody, t: token }), params(), s.deps);
    expect(response.status).toBe(200);
    expect(s.rendered[0]!.view).toBe("confirm");
    expect(s.deps.recordSubmission).not.toHaveBeenCalled();
  });
});

describe("M17-06 the per-form and per-site limits", () => {
  it("3 per client and form in 10 minutes, then a quarter of the plan's daily cap per site an hour: 429 with Retry-After, nothing stored", async () => {
    const perForm = setup({ limits: { "form-block": { allowed: false, retryAfter: 100 } } });
    const a = await handleFormPost(post(signupBody), params(), perForm.deps);
    expect(a.status).toBe(429);
    expect(a.headers.get("retry-after")).toBe("100");
    expect(perForm.deps.rateLimit).toHaveBeenCalledWith(
      `form-block:${IP}:${PAGE}:formSign01`,
      3,
      600,
    );
    const perSite = setup({ limits: { "form-site": { allowed: false, retryAfter: 7 } } });
    expect((await handleFormPost(post(signupBody), params(), perSite.deps)).status).toBe(429);
    expect(perSite.deps.rateLimitPeek).toHaveBeenCalledWith(`form-site:${PAGE}`, 5, 3600);
    expect(perSite.deps.rateLimit).not.toHaveBeenCalledWith(`form-site:${PAGE}`, 5, 3600);
    expect(perForm.deps.recordSubmission).not.toHaveBeenCalled();
    expect(perSite.deps.recordSubmission).not.toHaveBeenCalled();
  });
});

describe("forms attack pass finding 1: the site's hour counts stored submissions only", () => {
  /** A form store with real dedupe: a sign-up address once per form; a message is always stored. */
  function storeWithDedupe(s: ReturnType<typeof setup>, existing: string[] = []) {
    const held = new Set(existing);
    s.deps.recordSubmission.mockImplementation(async (row) => {
      if (row!.blockId === "formSign01") {
        const key = row!.email.toLowerCase();
        if (held.has(key)) return { status: "duplicate", ownerId: "owner-0000-0001" };
        held.add(key);
      }
      return { status: "stored", ownerId: "owner-0000-0001" };
    });
  }
  const twoForms = {
    resolveFormBlock: async (_page: string, blockId: string) => ({
      block: blockId === "formCont01" ? CONTACT : SIGNUP,
      handle: "mara",
      customHosts: [],
      plan: "free" as const,
    }),
  };
  const contactPost = (ip: string) =>
    post(contactBody, { "x-forwarded-for": ip }, `http://mara.localhost:3000/f/${PAGE}/formCont01`);

  it("3 repeat sign-ups of one address and 2 messages from one client, then another visitor's first post stores", async () => {
    const s = setup();
    Object.assign(s.deps, twoForms);
    realLimiter(s);
    // The attacker's address is already on the list: every sign-up below is a duplicate.
    storeWithDedupe(s, ["visitor@example.test"]);
    const attacker = "198.51.100.9";
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await handleFormPost(
        post(signupBody, { "x-forwarded-for": attacker }),
        params(),
        s.deps,
      );
      statuses.push(r.status);
    }
    for (let i = 0; i < 2; i++) {
      statuses.push(
        (await handleFormPost(contactPost(attacker), params("formCont01"), s.deps)).status,
      );
    }
    expect(statuses).toEqual([303, 303, 303, 303, 303]);
    // Another visitor, a new address: stored, not 429.
    const visitor = await handleFormPost(
      post({ ...signupBody, email: "real@example.test" }, { "x-forwarded-for": "192.0.2.44" }),
      params(),
      s.deps,
    );
    expect(visitor.status).toBe(303);
    expect(s.deps.recordSubmission).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "real@example.test" }),
    );
  });

  it("the hour still bounds what is stored: after 5 stored on Free the next visitor is 429 and nothing reaches the store", async () => {
    const s = setup();
    realLimiter(s);
    storeWithDedupe(s);
    for (let i = 0; i < 5; i++) {
      const r = await handleFormPost(
        post(
          { ...signupBody, email: `v${i}@example.test` },
          { "x-forwarded-for": `192.0.2.${i + 1}` },
        ),
        params(),
        s.deps,
      );
      expect(r.status).toBe(303);
    }
    const sixth = await handleFormPost(
      post({ ...signupBody, email: "v6@example.test" }, { "x-forwarded-for": "192.0.2.66" }),
      params(),
      s.deps,
    );
    expect(sixth.status).toBe(429);
    expect(s.deps.recordSubmission).toHaveBeenCalledTimes(5);
  });

  it.each(["duplicate", "over_limit", "over_limit_first", "over_daily_limit"] as const)(
    "%s does not count against the site's hour",
    async (status) => {
      const s = setup({ status });
      await handleFormPost(post(signupBody), params(), s.deps);
      expect(s.deps.rateLimitPeek).toHaveBeenCalledWith(`form-site:${PAGE}`, 5, 3600);
      expect(s.calls).not.toContain("limit:form-site");
    },
  );
});

describe("forms attack pass finding 3: a dropped post follows the same visible sequence as a real one", () => {
  const BOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";
  type Variant = {
    name: string;
    body: Record<string, string>;
    headers: Record<string, string | null>;
    blocked: boolean;
  };
  const clean = { ...contactBody, message: "see https://fine.example/x" };
  const variants: Variant[] = [
    { name: "clean", body: clean, headers: {}, blocked: false },
    { name: "bot user agent", body: clean, headers: { "user-agent": BOT }, blocked: false },
    { name: "no user agent", body: clean, headers: { "user-agent": null }, blocked: false },
    { name: "filled honeypot", body: { ...clean, hl_confirm: "x" }, headers: {}, blocked: false },
    { name: "blocked link", body: clean, headers: {}, blocked: true },
  ];
  const contactSetup = (v: Variant, over: Setup = {}) =>
    setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
      blocked: v.blocked,
      ...over,
    });
  const send = (v: Variant, s: ReturnType<typeof setup>, body = v.body) =>
    handleFormPost(
      post(body, v.headers, `http://mara.localhost:3000/f/${PAGE}/formCont01`),
      params("formCont01"),
      s.deps,
    );

  it.each(variants.slice(1))(
    "$name: no open marker is the 200 confirm page, as a clean post",
    async (v) => {
      const s = contactSetup(v, { openedAgo: null });
      const r = await send(v, s);
      expect(r.status).toBe(200);
      expect(s.rendered.map((state) => state.view)).toEqual(["confirm"]);
    },
  );

  it.each(variants.slice(1))(
    "$name: an invalid email is the 422 error page, as a clean post",
    async (v) => {
      const s = contactSetup(v);
      const r = await send(v, s, { ...v.body, email: "not-an-address" });
      expect(r.status).toBe(422);
    },
  );

  it("every variant: 303, 303, 303, then 429 from the per-client limit, the same as a clean post", async () => {
    const sequences: Record<string, number[]> = {};
    for (const v of variants) {
      const s = contactSetup(v);
      realLimiter(s);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await send(v, s)).status);
      sequences[v.name] = statuses;
      expect(s.deps.recordSubmission).toHaveBeenCalledTimes(v.name === "clean" ? 3 : 0);
    }
    for (const v of variants) expect(sequences[v.name], v.name).toEqual([303, 303, 303, 429]);
  });

  it("the site's hour full: 429 for a dropped post as for a clean one", async () => {
    for (const v of variants) {
      const s = contactSetup(v, { limits: { "form-site": { allowed: false, retryAfter: 9 } } });
      expect((await send(v, s)).status, v.name).toBe(429);
    }
  });
});

describe("M17-10 the owner email is handed off after the response", () => {
  it("a stored contact message with notify on: one message email to the owner, with the values", async () => {
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
    });
    await handleFormPost(post(contactBody), params("formCont01"), s.deps);
    expect(s.deps.notifyOwnerOfMessage).not.toHaveBeenCalled();
    await s.flush();
    expect(s.deps.notifyOwnerOfMessage).toHaveBeenCalledWith({
      ownerId: "owner-0000-0001",
      handle: "mara",
      formTitle: "Contact form",
      email: "visitor@example.test",
      name: "Vera Visitor",
      message: "secret message text",
    });
  });

  it("notify off, or a sign-up: no message email", async () => {
    const off = { ...CONTACT, notify: false };
    const s = setup({ block: off, target: { block: off, handle: "mara", customHosts: [] } });
    await handleFormPost(post(contactBody), params("formCont01"), s.deps);
    const signup = setup();
    await handleFormPost(post(signupBody), params(), signup.deps);
    await s.flush();
    await signup.flush();
    expect(s.deps.notifyOwnerOfMessage).not.toHaveBeenCalled();
    expect(signup.deps.notifyOwnerOfMessage).not.toHaveBeenCalled();
  });
});

describe("M17-05 the sent page, the open marker and the other methods", () => {
  const get = (path: string, method = "GET", headers: Record<string, string> = {}) =>
    new Request(`http://mara.localhost:3000${path}`, {
      method,
      headers: { host: "mara.localhost:3000", "user-agent": UA, "x-forwarded-for": IP, ...headers },
    });

  it("GET is the themed sent page: the tenant policy, no-store, noindex, no cookie; HEAD has no body", async () => {
    const s = setup();
    const response = await handleFormSent(get(`/f/${PAGE}/formSign01`), params(), s.deps);
    expect(response.status).toBe(200);
    expect(s.rendered[0]).toEqual({ blockId: "formSign01", view: "sent" });
    expect(response.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
    expect(TENANT_PAGE_CSP).toContain("form-action 'self'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("set-cookie")).toBeNull();
    const head = await handleFormSent(get(`/f/${PAGE}/formSign01`, "HEAD"), params(), s.deps);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("the sent page is limited to 120 GETs a minute per client and checks the host", async () => {
    const limited = setup({ limits: { "form-get": { allowed: false, retryAfter: 9 } } });
    const response = await handleFormSent(get(`/f/${PAGE}/formSign01`), params(), limited.deps);
    expect(response.status).toBe(429);
    expect(limited.deps.rateLimit).toHaveBeenCalledWith(`form-get:${IP}`, 120, 60);
    expect(limited.deps.resolveFormBlock).not.toHaveBeenCalled();
    const foreign = setup();
    expect(
      (
        await handleFormSent(
          get(`/f/${PAGE}/formSign01`, "GET", { host: "localhost:3000" }),
          params(),
          foreign.deps,
        )
      ).status,
    ).toBe(404);
  });

  it("the open marker: a 43-byte GIF, no-store, that marks this client and page; HEAD marks nothing", async () => {
    const s = setup();
    const response = await handleFormOpen(get(`/f/${PAGE}/o`), { pageId: PAGE }, s.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(43);
    expect(s.deps.rateLimit).toHaveBeenCalledWith(`form-open:${IP}:${PAGE}`, 1, 3600);
    const head = setup();
    await handleFormOpen(get(`/f/${PAGE}/o`, "HEAD"), { pageId: PAGE }, head.deps);
    expect(head.calls).not.toContain("limit:form-open");
  });

  it("the open marker on another host or for an unknown page marks nothing", async () => {
    const foreign = setup();
    const a = await handleFormOpen(
      get(`/f/${PAGE}/o`, "GET", { host: "other.localhost:3000" }),
      { pageId: PAGE },
      foreign.deps,
    );
    expect(a.status).toBe(404);
    const unknown = setup({ target: null });
    expect((await handleFormOpen(get(`/f/${PAGE}/o`), { pageId: PAGE }, unknown.deps)).status).toBe(
      404,
    );
    expect((await handleFormOpen(get(`/f/x/o`), { pageId: "x" }, unknown.deps)).status).toBe(404);
    for (const s of [foreign, unknown]) expect(s.calls).not.toContain("limit:form-open");
  });

  it("any other method is 405 with Allow", () => {
    expect(formMethodNotAllowed(false).status).toBe(405);
    expect(formMethodNotAllowed(false).headers.get("allow")).toBe("GET, HEAD, POST");
    expect(formMethodNotAllowed(true).headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("M17-06 nothing personal reaches the console on any branch", () => {
  it("every branch above, once more with every console method watched", async () => {
    spyConsole();
    const runs: [Setup, Record<string, string>][] = [
      [{}, signupBody],
      [{ target: new Error("x") }, signupBody],
      [{ status: new Error("record_form_submission failed (P0001)") }, signupBody],
      [
        {
          block: CONTACT,
          target: { block: CONTACT, handle: "mara", customHosts: [] },
          blocked: new Error("x"),
        },
        contactBody,
      ],
      [{ openedAgo: null }, signupBody],
      [{}, { ...signupBody, email: "bad" }],
    ];
    for (const [over, body] of runs) {
      const s = setup(over);
      const blockId = over.block?.id ?? "formSign01";
      await handleFormPost(post(body), params(blockId), s.deps);
      await s.flush();
    }
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("M17-05 step 3 every /f response carries the tenant policy and noindex (review B5)", () => {
  const get = (path: string, method = "GET", headers: Record<string, string> = {}) =>
    new Request(`http://mara.localhost:3000${path}`, {
      method,
      headers: { host: "mara.localhost:3000", "user-agent": UA, "x-forwarded-for": IP, ...headers },
    });
  const expectFormHeaders = (response: Response, label: string) => {
    expect(response.headers.get("content-security-policy"), label).toBe(TENANT_PAGE_CSP);
    expect(response.headers.get("x-robots-tag"), label).toBe("noindex");
    expect(response.headers.get("cache-control"), label).toBe("no-store");
    expect(response.headers.get("x-frame-options"), label).toBe("DENY");
    expect(response.headers.get("x-content-type-options"), label).toBe("nosniff");
    expect(response.headers.get("set-cookie"), label).toBeNull();
  };

  it("403, 404, 405, 413, 415, 422, 429, 503, 200, 303 and the marker image", async () => {
    const cases: [string, number, () => Promise<Response>][] = [
      [
        "cross-site",
        403,
        async () =>
          handleFormPost(
            post(signupBody, { "sec-fetch-site": "cross-site" }),
            params(),
            setup().deps,
          ),
      ],
      [
        "bad ids",
        404,
        async () => handleFormPost(post(signupBody), { pageId: "x", blockId: "y" }, setup().deps),
      ],
      [
        "unknown block",
        404,
        async () => handleFormPost(post(signupBody), params(), setup({ target: null }).deps),
      ],
      [
        "sent page unknown",
        404,
        async () =>
          handleFormSent(get(`/f/${PAGE}/formSign01`), params(), setup({ target: null }).deps),
      ],
      [
        "marker unknown",
        404,
        async () =>
          handleFormOpen(get(`/f/${PAGE}/o`), { pageId: PAGE }, setup({ target: null }).deps),
      ],
      ["method", 405, async () => formMethodNotAllowed(false)],
      ["marker method", 405, async () => formMethodNotAllowed(true)],
      [
        "too large",
        413,
        async () =>
          handleFormPost(post(signupBody, { "content-length": "40000" }), params(), setup().deps),
      ],
      [
        "wrong type",
        415,
        async () =>
          handleFormPost(
            post("{}", { "content-type": "application/json" }),
            params(),
            setup().deps,
          ),
      ],
      [
        "bad field",
        422,
        async () => handleFormPost(post({ ...signupBody, email: "" }), params(), setup().deps),
      ],
      [
        "post limit",
        429,
        async () =>
          handleFormPost(
            post(signupBody),
            params(),
            setup({ limits: { "form-post": { allowed: false, retryAfter: 5 } } }).deps,
          ),
      ],
      [
        "get limit",
        429,
        async () =>
          handleFormSent(
            get(`/f/${PAGE}/formSign01`),
            params(),
            setup({ limits: { "form-get": { allowed: false, retryAfter: 5 } } }).deps,
          ),
      ],
      [
        "marker limit",
        429,
        async () =>
          handleFormOpen(
            get(`/f/${PAGE}/o`),
            { pageId: PAGE },
            setup({ limits: { "form-get": { allowed: false, retryAfter: 5 } } }).deps,
          ),
      ],
      [
        "db down",
        503,
        async () =>
          handleFormPost(post(signupBody), params(), setup({ target: new Error("x") }).deps),
      ],
      [
        "store down",
        503,
        async () =>
          handleFormPost(post(signupBody), params(), setup({ status: new Error("x") }).deps),
      ],
      [
        "confirm",
        200,
        async () => handleFormPost(post(signupBody), params(), setup({ openedAgo: null }).deps),
      ],
      [
        "sent page",
        200,
        async () => handleFormSent(get(`/f/${PAGE}/formSign01`), params(), setup().deps),
      ],
      [
        "sent page HEAD",
        200,
        async () => handleFormSent(get(`/f/${PAGE}/formSign01`, "HEAD"), params(), setup().deps),
      ],
      ["stored", 303, async () => handleFormPost(post(signupBody), params(), setup().deps)],
      [
        "marker",
        200,
        async () => handleFormOpen(get(`/f/${PAGE}/o`), { pageId: PAGE }, setup().deps),
      ],
    ];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const [label, status, run] of cases) {
      const response = await run();
      expect(response.status, label).toBe(status);
      expectFormHeaders(response, label);
    }
  });

  it("the HYDLNK notice of /r and /c keeps its own stricter policy (only the form routes change it)", () => {
    const shared = notice(404, "x", "http://localhost:3000/", false);
    expect(shared.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    expect(shared.headers.get("x-robots-tag")).toBeNull();
    expect(shared.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("a notice of the form routes keeps its no-referrer; a themed page keeps same-origin", async () => {
    const refused = await handleFormPost(post(signupBody), params(), setup({ target: null }).deps);
    expect(refused.headers.get("referrer-policy")).toBe("no-referrer");
    const confirm = await handleFormPost(
      post(signupBody),
      params(),
      setup({ openedAgo: null }).deps,
    );
    expect(confirm.headers.get("referrer-policy")).toBe("same-origin");
  });
});

describe("M17-06 review fixes: order, unavailable and a check the database refuses", () => {
  it("a cross-site POST to a malformed id is 403, before the ids are looked at (review B9)", async () => {
    const s = setup();
    const response = await handleFormPost(
      post(signupBody, { "sec-fetch-site": "cross-site" }),
      { pageId: "not-a-uuid", blockId: "x" },
      s.deps,
    );
    expect(response.status).toBe(403);
    expect(s.calls).toEqual([]);
  });

  it("'unavailable' from the store (unpublished since the lookup) is the 404 notice, not the sent 303", async () => {
    const s = setup({ status: "unavailable" });
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This form isn’t available.");
    await s.flush();
    expect(s.deps.insertEvent).not.toHaveBeenCalled();
    expect(s.deps.notifyOwnerOfMessage).not.toHaveBeenCalled();
    expect(s.deps.notifyOwnerOfLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_email", "email"],
    ["invalid_name", "name"],
    ["invalid_message", "message"],
  ] as const)(
    "%s (a 23514 the store answered) is the 422 error page on its field with the values typed, never a 503 (review B8)",
    async (status, field) => {
      const s = setup({
        block: CONTACT,
        target: { block: CONTACT, handle: "mara", customHosts: [] },
        status,
      });
      const response = await handleFormPost(post(contactBody), params("formCont01"), s.deps);
      expect(response.status).toBe(422);
      expect(s.rendered.at(-1)).toMatchObject({
        view: "error",
        values: {
          email: "visitor@example.test",
          name: "Vera Visitor",
          message: "secret message text",
        },
        errors: { [field]: "This has characters the form can’t take. Remove them and send again." },
      });
      expect(s.rendered.at(-1)!.token).toMatch(/^v1\./);
      await s.flush();
      expect(s.deps.insertEvent).not.toHaveBeenCalled();
      expect(s.deps.notifyOwnerOfMessage).not.toHaveBeenCalled();
    },
  );

  it("a message holding U+2028 and U+2029 reaches the store unchanged (Postgres stores them: pgTAP 219)", async () => {
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
    });
    const response = await handleFormPost(
      post({ ...contactBody, message: "one two three" }),
      params("formCont01"),
      s.deps,
    );
    expect(response.status).toBe(303);
    expect(s.deps.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ message: "one two three" }),
    );
  });

  it("the per-site hour follows the plan's daily cap: 5 on Free, 125 on Pro, 1,250 on Studio", async () => {
    expect(formSiteHourlyLimit("free")).toBe(5);
    expect(formSiteHourlyLimit("pro")).toBe(125);
    expect(formSiteHourlyLimit("studio")).toBe(1250);
    for (const plan of ["pro", "studio"] as const) {
      const s = setup({ target: { block: SIGNUP, handle: "mara", customHosts: [], plan } });
      await handleFormPost(post(signupBody), params(), s.deps);
      expect(s.deps.rateLimit).toHaveBeenCalledWith(
        `form-site:${PAGE}`,
        formSiteHourlyLimit(plan),
        3600,
      );
    }
  });
});

describe("M17-06 the open marker is set by GET /o only (review B7)", () => {
  it("POST, wait, POST with no token and no marker: both are the confirm page, nothing stored", async () => {
    let now = 5_000_000;
    const s = setup();
    realLimiter(s, () => now, true);
    expect((await handleFormPost(post(signupBody), params(), s.deps)).status).toBe(200);
    now += 10_000;
    expect((await handleFormPost(post(signupBody), params(), s.deps)).status).toBe(200);
    expect(s.rendered.map((state) => state.view)).toEqual(["confirm", "confirm"]);
    expect(s.deps.recordSubmission).not.toHaveBeenCalled();

    // Once the page's image was loaded, the same client is stored after 3 seconds.
    const get = new Request(`http://mara.localhost:3000/f/${PAGE}/o`, {
      headers: { host: "mara.localhost:3000", "user-agent": UA, "x-forwarded-for": IP },
    });
    expect((await handleFormOpen(get, { pageId: PAGE }, s.deps)).status).toBe(200);
    now += 3_000;
    expect((await handleFormPost(post(signupBody), params(), s.deps)).status).toBe(303);
    expect(s.deps.recordSubmission).toHaveBeenCalledTimes(1);
  });
});

describe("M17-06 step 6 a limiter that cannot answer lets the request through", () => {
  it("every forms key (form-post, form-token, form-block, form-site, form-get, the marker) fails open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = {
      hit: async () => Promise.reject(new Error("down")),
      peek: async () => Promise.reject(new Error("down")),
      age: async () => Promise.reject(new Error("down")),
    };
    const s = setup();
    const keys: string[] = [];
    s.deps.rateLimit = vi.fn((key: string, limit: number, window: number) => {
      keys.push(key.split(":")[0]!);
      return rateLimit(key, limit, window, { store: broken, secret: SECRET });
    });
    s.deps.rateLimitPeek = vi.fn((key: string, limit: number, window: number) => {
      keys.push(`peek ${key.split(":")[0]!}`);
      return rateLimitPeek(key, limit, window, { store: broken, secret: SECRET });
    });
    s.deps.rateLimitAge = vi.fn((key: string, window: number) =>
      rateLimitAge(key, window, { store: broken, secret: SECRET }),
    );
    // A valid token: the marker that cannot be read reads as "none", the token carries the post.
    const token = issueFormToken({
      pageId: PAGE,
      blockId: "formSign01",
      client: IP,
      secret: SECRET,
      now: new Date(NOW.getTime() - 5000),
    });
    const stored = await handleFormPost(post({ ...signupBody, t: token }), params(), s.deps);
    expect(stored.status).toBe(303);
    expect(s.deps.recordSubmission).toHaveBeenCalledTimes(1);
    expect(keys).toEqual(["form-post", "form-token", "form-block", "peek form-site", "form-site"]);
    // Without a token, a marker that cannot be read is the confirm page, never a silent drop.
    const confirm = await handleFormPost(post(signupBody), params(), s.deps);
    expect(confirm.status).toBe(200);
    const get = (path: string) =>
      new Request(`http://mara.localhost:3000${path}`, {
        headers: { host: "mara.localhost:3000", "user-agent": UA, "x-forwarded-for": IP },
      });
    expect((await handleFormSent(get(`/f/${PAGE}/formSign01`), params(), s.deps)).status).toBe(200);
    expect((await handleFormOpen(get(`/f/${PAGE}/o`), { pageId: PAGE }, s.deps)).status).toBe(200);
  });
});

describe("M17-06 step 8 nothing personal reaches the console on EVERY branch", () => {
  it("403, 404, 405, 413, 415, 422, 429 (each limit), bot, honeypot, blocked link, token reuse, the store's answers, HEAD and the marker", async () => {
    spyConsole();
    const contactTarget = { block: CONTACT, handle: "mara", customHosts: [] };
    const token = issueFormToken({
      pageId: PAGE,
      blockId: "formSign01",
      client: IP,
      secret: SECRET,
      now: new Date(NOW.getTime() - 5000),
    });
    const denied = { allowed: false, retryAfter: 5 };
    const runs: [Setup, Record<string, string> | string, Record<string, string | null>][] = [
      [{}, signupBody, { "sec-fetch-site": "cross-site" }],
      [{}, "{}", { "content-type": "application/json" }],
      [{}, signupBody, { "content-length": "40000" }],
      [{ limits: { "form-post": denied } }, signupBody, {}],
      [{ limits: { "form-block": denied } }, signupBody, {}],
      [{ limits: { "form-site": denied } }, signupBody, {}],
      [{ limits: { "form-token": denied }, openedAgo: null }, { ...signupBody, t: token }, {}],
      [{}, signupBody, { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
      [{}, { ...signupBody, hl_confirm: "Vera Visitor" }, {}],
      [{ block: CONTACT, target: contactTarget, blocked: true }, contactBody, {}],
      [
        { block: CONTACT, target: contactTarget, blocked: new Error("visitor@example.test") },
        contactBody,
        {},
      ],
      [{ target: null }, signupBody, {}],
      [{ target: new Error("visitor@example.test") }, signupBody, {}],
      [{ openedAgo: null }, signupBody, {}],
      [{}, { ...signupBody, email: "bad" }, {}],
      ...(
        [
          "duplicate",
          "over_limit",
          "over_limit_first",
          "over_daily_limit",
          "unavailable",
          "invalid_email",
          "invalid_name",
          "invalid_message",
        ] as const
      ).map((status): [Setup, Record<string, string>, Record<string, string | null>] => [
        { block: CONTACT, target: contactTarget, status },
        contactBody,
        {},
      ]),
      [
        { status: new Error("record_form_submission failed (visitor@example.test)") },
        signupBody,
        {},
      ],
    ];
    for (const [over, body, headers] of runs) {
      const s = setup(over);
      const blockId = over.block?.id ?? "formSign01";
      await handleFormPost(post(body, headers), params(blockId), s.deps);
      await s.flush();
    }
    const get = (path: string, method = "GET") =>
      new Request(`http://mara.localhost:3000${path}`, {
        method,
        headers: { host: "mara.localhost:3000", "user-agent": UA, "x-forwarded-for": IP },
      });
    await handleFormSent(get(`/f/${PAGE}/formSign01`, "HEAD"), params(), setup().deps);
    await handleFormSent(
      get(`/f/${PAGE}/formSign01`),
      params(),
      setup({ target: new Error("x") }).deps,
    );
    await handleFormOpen(get(`/f/${PAGE}/o`), { pageId: PAGE }, setup().deps);
    await handleFormOpen(get(`/f/${PAGE}/o`, "HEAD"), { pageId: PAGE }, setup().deps);
    formMethodNotAllowed(false);
    // Some branches log (a constant line and a code); none of them logs what was typed.
    expect(logged.length).toBeGreaterThan(0);
  });
});
