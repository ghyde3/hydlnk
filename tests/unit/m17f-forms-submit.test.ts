import { afterEach, describe, expect, it, vi } from "vitest";
import { blockDefaults, type FormBlock } from "@/lib/document";
import type { FormTarget } from "@/lib/analytics/ingest/types";
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

const { handleFormOpen, handleFormPost, handleFormSent, formMethodNotAllowed, MIN_FILL_SECONDS } =
  await import("@/lib/forms/submit");
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

interface Setup {
  block?: FormBlock;
  target?: FormTarget | null | Error;
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
  const target: FormTarget | null | Error =
    over.target === undefined
      ? { block, handle: "mara", customHosts: ["links.example.test"] }
      : over.target;
  const scheduled: (() => Promise<void>)[] = [];
  const rendered: FormRenderState[] = [];
  const deps = {
    rateLimit: vi.fn(async (key: string): Promise<RateLimitResult> => {
      const prefix = key.split(":")[0]!;
      calls.push(`limit:${prefix}`);
      if (prefix === "form-open") {
        const ago = over.openedAgo === undefined ? 10 : over.openedAgo;
        return ago === null
          ? { allowed: true, retryAfter: 0 }
          : { allowed: false, retryAfter: 3600 - ago };
      }
      return over.limits?.[prefix] ?? { allowed: true, retryAfter: 0 };
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
    recordSubmission: vi.fn(async () => {
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
      visitorHash: "a".repeat(64),
    });
    expect(s.deps.insertEvent).not.toHaveBeenCalled();
    await s.flush();
    expect(s.deps.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ page_id: PAGE, block_id: "formSign01", type: "click" }),
    );
  });

  it("the order: ids, limiter, body, block, then checks, then the per-form and per-site limits, then the store", async () => {
    const s = setup({
      block: CONTACT,
      target: { block: CONTACT, handle: "mara", customHosts: [] },
    });
    await handleFormPost(post(contactBody), params("formCont01"), s.deps);
    expect(s.calls).toEqual([
      "limit:form-post",
      "resolve",
      "limit:form-open",
      "blocklist",
      "limit:form-block",
      "limit:form-site",
      "record",
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
      { host: "other.localhost:3000", origin: "http://other.localhost:3000" } as Record<string, string>,
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

  it.each(["duplicate", "over_limit", "over_limit_first", "unavailable"] as const)(
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
    const s = setup({ status: new Error("record_form_submission failed (23514)") });
    const response = await handleFormPost(post(signupBody), params(), s.deps);
    expect(response.status).toBe(503);
    expect(logged.join("\n")).toContain("23514");
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
    expect(s.calls).not.toContain("limit:form-open");
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
  it("3 per client and form in 10 minutes, then 600 per site an hour: 429 with Retry-After, nothing stored", async () => {
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
    expect(perSite.deps.rateLimit).toHaveBeenCalledWith(`form-site:${PAGE}`, 600, 3600);
    expect(perForm.deps.recordSubmission).not.toHaveBeenCalled();
    expect(perSite.deps.recordSubmission).not.toHaveBeenCalled();
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
