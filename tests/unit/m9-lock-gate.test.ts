import { afterEach, describe, expect, it, vi } from "vitest";
import { handleClick, handleClickPost } from "@/lib/analytics/ingest/click";
import { resolveLink } from "@/lib/analytics/ingest/link-target";
import type { ClickTarget, IngestDeps } from "@/lib/analytics/ingest/types";
import { toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import { hashLockCode, verifyLockCode } from "@/lib/links/lock-hash";
import { IPHONE_UA, PAGE_ID, makeDeps, spyOnConsole } from "./analytics-ingest-helpers";
import { blocks, fullDraft, noirTokens } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));

/**
 * M9-29 the gate of a locked link, through the real handlers with spy dependencies and the real
 * resolver and scrypt: the interstitial, the answer, the limits, the refusals and the secrets.
 */

const DEST = "https://secret.example/vault?id=1";
const AGE_ID = "link-age-0001";
const CODE_ID = "link-code-001";
const PLAIN_ID = "link-plain-001";
const BROKEN_ID = "link-broken-01";
const ORIGIN = "http://mara.localhost:3000";
const CODE = "Spring2026";
const WRONG = "nope-nope";

let salt = "";
let hash = "";
let doc: PublishDoc;

async function setup(): Promise<void> {
  if (doc) return;
  const hashed = await hashLockCode(CODE);
  if (!hashed.ok) throw new Error("hash failed");
  salt = hashed.salt;
  hash = hashed.hash;
  const link = (id: string, extra: Record<string, unknown>) => ({
    ...blocks.link,
    id,
    label: id,
    url: DEST,
    ...extra,
  });
  const draft = {
    ...(fullDraft as object),
    utm: { source: "hydlnk" },
    blocks: [
      link(AGE_ID, { lock: { kind: "age" } }),
      link(CODE_ID, { lock: { kind: "code", salt, hash } }),
      link(PLAIN_ID, {}),
    ],
  } as DraftDoc;
  doc = toPublishForm(draft, noirTokens);
  // A stored lock that bypassed Publish: a code lock whose hash has the wrong shape.
  doc = {
    ...doc,
    blocks: [
      ...doc.blocks,
      { ...doc.blocks[0], id: BROKEN_ID, lock: { kind: "code", salt, hash: "short" } },
    ],
  } as PublishDoc;
}

const tagged = `${DEST}&utm_source=hydlnk`;

function target(pageId: string, id: string): ClickTarget | null {
  if (pageId !== PAGE_ID) return null;
  const link = resolveLink(doc, id);
  return link === null
    ? null
    : {
        url: link.url,
        ...(link.lock ? { lock: link.lock } : {}),
        handle: "mara",
        customHosts: ["links.example.test"],
      };
}

interface Memory {
  /** Every call, in order: the key and the options passed. */
  calls: { key: string; limit: number; window: number; options: unknown }[];
  limiter: IngestDeps["rateLimit"];
}

/** A sliding-window limiter in memory: at most `limit` hits per key. The same contract as `rateLimit`. */
function memoryLimiter(): Memory {
  const hits = new Map<string, number>();
  const calls: Memory["calls"] = [];
  return {
    calls,
    limiter: async (key, limit, window, options) => {
      calls.push({ key, limit, window, options });
      const next = (hits.get(key) ?? 0) + 1;
      hits.set(key, next);
      return next <= limit
        ? { allowed: true, retryAfter: 0 }
        : { allowed: false, retryAfter: window };
    },
  };
}

function build(overrides: Partial<IngestDeps> = {}) {
  const verify = vi.fn(verifyLockCode);
  const spies = makeDeps({
    resolveClickTarget: vi.fn(async (pageId: string, id: string) => target(pageId, id)),
    verifyLock: verify,
    ...overrides,
  });
  return { ...spies, verify };
}

function post(
  id: string,
  body: string | null,
  headers: Record<string, string | null> = {},
  pageId = PAGE_ID,
): Request {
  const merged: Record<string, string> = {
    host: "mara.localhost:3000",
    "user-agent": IPHONE_UA,
    "x-forwarded-for": "203.0.113.7",
    "content-type": "application/x-www-form-urlencoded",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return new Request(`${ORIGIN}/r/${pageId}/${id}`, {
    method: "POST",
    headers: merged,
    ...(body === null ? {} : { body }),
  });
}

function get(
  id: string,
  method = "GET",
  query = "",
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/r/${PAGE_ID}/${id}${query}`, {
    method,
    headers: {
      host: "mara.localhost:3000",
      "user-agent": IPHONE_UA,
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
  });
}

const params = (id: string, pageId = PAGE_ID) => ({ pageId, blockId: id });
const headersText = (response: Response) =>
  [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");

afterEach(() => vi.restoreAllMocks());

describe("M9-29 the interstitial (GET and HEAD)", () => {
  it("an age lock answers 200 with the question, 'Continue' and 'Go back', and no Location", async () => {
    await setup();
    const s = build();
    const response = await handleClick(get(AGE_ID), params(AGE_ID), s.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    const html = await response.text();
    expect(html).toContain("This link may contain sensitive content.");
    expect(html).toContain("Continue?");
    expect(html).toContain(">Continue</button>");
    expect(html).toContain('<a class="back" href="/">Go back</a>');
    expect(html).toContain(`<form method="post" action="/r/${PAGE_ID}/${AGE_ID}">`);
    expect(html).toContain('name="confirm" value="1"');
    expect(html).not.toContain('name="code"');
  });

  it("a code lock answers 200 with the code field: text, autocomplete off, autocapitalize off, no spellcheck", async () => {
    await setup();
    const html = await (await handleClick(get(CODE_ID), params(CODE_ID), build().deps)).text();
    expect(html).toContain("This link is locked.");
    expect(html).toContain("Enter the code to continue.");
    expect(html).toContain('name="code"');
    expect(html).toContain('type="text"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('autocapitalize="off"');
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain("font-size: 16px");
    expect(html).toContain("min-height: 44px");
    expect(html).toContain('<label for="code">Code</label>');
  });

  it("sends the headers of the interstitial exactly", async () => {
    await setup();
    const response = await handleClick(get(CODE_ID), params(CODE_ID), build().deps);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("HEAD answers the same status and headers with no body", async () => {
    await setup();
    const s = build();
    const full = await handleClick(get(CODE_ID), params(CODE_ID), s.deps);
    const head = await handleClick(get(CODE_ID, "HEAD"), params(CODE_ID), s.deps);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const name of [
      "cache-control",
      "x-robots-tag",
      "referrer-policy",
      "x-frame-options",
      "content-security-policy",
      "content-type",
    ]) {
      expect(head.headers.get(name)).toBe(full.headers.get(name));
    }
    expect(head.headers.get("location")).toBeNull();
  });

  it("never carries the destination or its host: not in the page, not in any header", async () => {
    await setup();
    for (const id of [AGE_ID, CODE_ID]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await handleClick(get(id, method), params(id), build().deps);
        expect(headersText(response)).not.toContain("secret.example");
        expect(`${await response.text()}`).not.toContain("secret.example");
      }
    }
  });

  it("never carries the salt or the hash", async () => {
    await setup();
    const response = await handleClick(get(CODE_ID), params(CODE_ID), build().deps);
    const text = `${headersText(response)}\n${await response.text()}`;
    expect(text).not.toContain(salt);
    expect(text).not.toContain(hash);
  });

  it("records no click, for a browser either: the interstitial is not a visit to the link", async () => {
    await setup();
    const s = build();
    await handleClick(get(AGE_ID), params(AGE_ID), s.deps);
    await handleClick(get(CODE_ID, "GET", `?code=${CODE}&confirm=1`), params(CODE_ID), s.deps);
    expect(s.scheduled).toHaveLength(0);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("ignores ?code= and ?confirm=1: the interstitial is shown, never the redirect", async () => {
    await setup();
    for (const [id, query] of [
      [CODE_ID, `?code=${CODE}`],
      [AGE_ID, "?confirm=1"],
      [AGE_ID, "?confirm=1&code=x&to=https://evil.example"],
    ] as const) {
      const response = await handleClick(get(id, "GET", query), params(id), build().deps);
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("a link preview bot sees only the interstitial, never the destination", async () => {
    await setup();
    const response = await handleClick(
      get(CODE_ID, "GET", "", {
        "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      }),
      params(CODE_ID),
      build().deps,
    );
    expect(response.status).toBe(200);
    expect(`${headersText(response)}${await response.text()}`).not.toContain("secret.example");
  });

  it("an unlocked link still redirects (302, tagged), a locked one on another host is the 404 notice", async () => {
    await setup();
    const plain = await handleClick(get(PLAIN_ID), params(PLAIN_ID), build().deps);
    expect(plain.status).toBe(302);
    expect(plain.headers.get("location")).toBe(tagged);
    const wrongHost = await handleClick(
      get(CODE_ID, "GET", "", { host: "other.localhost:3000" }),
      params(CODE_ID),
      build().deps,
    );
    expect(wrongHost.status).toBe(404);
    expect(await wrongHost.text()).not.toContain('name="code"');
  });

  it("a stored lock of the wrong shape is never read as unlocked: 503, not a redirect", async () => {
    await setup();
    const response = await handleClick(get(BROKEN_ID), params(BROKEN_ID), build().deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    const posted = await handleClickPost(
      post(BROKEN_ID, `code=${CODE}`),
      params(BROKEN_ID),
      build().deps,
    );
    expect(posted.status).toBe(503);
    expect(posted.headers.get("location")).toBeNull();
  });
});

describe("M9-29 passing the lock (POST)", () => {
  it("an age lock: confirm=1 answers 303 to exactly the published URL (with its UTM tags), no-store, no cookie", async () => {
    await setup();
    const s = build();
    const response = await handleClickPost(post(AGE_ID, "confirm=1"), params(AGE_ID), s.deps);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(tagged);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("records one click row with the link id, after the response", async () => {
    await setup();
    const s = build();
    await handleClickPost(post(AGE_ID, "confirm=1"), params(AGE_ID), s.deps);
    expect(s.insertEvent).not.toHaveBeenCalled();
    expect(s.scheduled).toHaveLength(1);
    await s.flush();
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({ page_id: PAGE_ID, block_id: AGE_ID, type: "click" });
  });

  it("a code lock: the right code opens it, ignoring case and surrounding space, and counts once", async () => {
    await setup();
    for (const code of [
      CODE,
      CODE.toLowerCase(),
      `  ${CODE.toUpperCase()} `,
      encodeURIComponent(CODE),
    ]) {
      const s = build();
      const response = await handleClickPost(
        post(CODE_ID, `code=${code}`),
        params(CODE_ID),
        s.deps,
      );
      expect(response.status, code).toBe(303);
      expect(response.headers.get("location")).toBe(tagged);
      await s.flush();
      expect(s.inserted).toHaveLength(1);
    }
  });

  it("a wrong code is 403 with the interstitial and the sentence: no Location, no row, no destination", async () => {
    await setup();
    const s = build();
    const response = await handleClickPost(post(CODE_ID, `code=${WRONG}`), params(CODE_ID), s.deps);
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    const html = await response.text();
    expect(html).toContain("That code didn’t match. Try again.");
    expect(html).toContain('name="code"');
    expect(`${headersText(response)}${html}`).not.toContain("secret.example");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("a missing or empty code is 400 'Enter the code.' and nothing is checked", async () => {
    await setup();
    for (const body of ["", "other=1", "code=", "code=%20%20"]) {
      const s = build();
      const response = await handleClickPost(post(CODE_ID, body), params(CODE_ID), s.deps);
      expect(response.status, body).toBe(400);
      expect(await response.text()).toContain("Enter the code.");
      expect(s.verify).not.toHaveBeenCalled();
    }
  });

  it("an age lock needs confirm=1: anything else is 400 with the question again", async () => {
    await setup();
    for (const body of ["", "confirm=0", "confirm=yes", "code=x"]) {
      const response = await handleClickPost(post(AGE_ID, body), params(AGE_ID), build().deps);
      expect(response.status, body).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("no bot and no HEAD-like request leaves a click row", async () => {
    await setup();
    const s = build();
    const response = await handleClickPost(
      post(AGE_ID, "confirm=1", {
        "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
      }),
      params(AGE_ID),
      s.deps,
    );
    expect(response.status).toBe(303);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("a request from a sub-resource (Sec-Fetch-Dest: image) is not counted", async () => {
    await setup();
    const s = build();
    await handleClickPost(
      post(AGE_ID, "confirm=1", { "sec-fetch-dest": "image" }),
      params(AGE_ID),
      s.deps,
    );
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("nothing from the request chooses the destination: a query, a Referer and a body field change nothing", async () => {
    await setup();
    const request = new Request(
      `${ORIGIN}/r/${PAGE_ID}/${AGE_ID}?to=https://evil.example&url=https://evil.example`,
      {
        method: "POST",
        headers: {
          host: "mara.localhost:3000",
          "user-agent": IPHONE_UA,
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          referer: "https://evil.example/",
          "x-forwarded-host": "evil.example",
        },
        body: "confirm=1&to=https://evil.example&location=https://evil.example",
      },
    );
    const response = await handleClickPost(request, params(AGE_ID), build().deps);
    expect(response.headers.get("location")).toBe(tagged);
  });

  it("answers 405 with Allow: GET, HEAD for an unlocked link", async () => {
    await setup();
    const s = build();
    const response = await handleClickPost(post(PLAIN_ID, "confirm=1"), params(PLAIN_ID), s.deps);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("location")).toBeNull();
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("answers 404 for an unknown, draft-only, hidden or foreign id and records nothing", async () => {
    await setup();
    for (const id of ["nope-nope-nope", "bad id", "a/b", "x".repeat(65), "link-draft-only"]) {
      const s = build();
      const response = await handleClickPost(
        post(id.replace(/[/ ]/g, "-"), "confirm=1"),
        params(id.replace(/[/ ]/g, "-")),
        s.deps,
      );
      expect(response.status, id).toBe(404);
      await s.flush();
      expect(s.inserted).toEqual([]);
    }
    const foreign = await handleClickPost(
      post(AGE_ID, "confirm=1", {}, "00000000-0000-4000-8000-0000000000ff"),
      params(AGE_ID, "00000000-0000-4000-8000-0000000000ff"),
      build().deps,
    );
    expect(foreign.status).toBe(404);
    const notUuid = await handleClickPost(
      post(AGE_ID, "confirm=1", {}, "not-a-uuid"),
      params(AGE_ID, "not-a-uuid"),
      build().deps,
    );
    expect(notUuid.status).toBe(404);
  });

  it("a suspended owner's page is the 404 (nothing resolves)", async () => {
    await setup();
    const s = build({ resolveClickTarget: vi.fn(async () => null) });
    expect((await handleClickPost(post(AGE_ID, "confirm=1"), params(AGE_ID), s.deps)).status).toBe(
      404,
    );
  });

  it("is served on the page's own hosts only: another tenant's or a victim's host gets the 404 notice and no check", async () => {
    await setup();
    for (const host of [
      "other.localhost:3000",
      "app.localhost:3000",
      "localhost:3000",
      "links.victim.test",
    ]) {
      const s = build();
      const response = await handleClickPost(
        post(CODE_ID, `code=${CODE}`, { host, origin: `http://${host}` }),
        params(CODE_ID),
        s.deps,
      );
      expect(response.status, host).toBe(404);
      expect(s.verify).not.toHaveBeenCalled();
    }
    const custom = await handleClickPost(
      post(CODE_ID, `code=${CODE}`, {
        host: "links.example.test",
        origin: "https://links.example.test",
      }),
      params(CODE_ID),
      build().deps,
    );
    expect(custom.status).toBe(303);
  });
});

describe("M9-29 cross-site and body rules", () => {
  it("refuses a POST that another origin made, before the limiter, the lookup or any check", async () => {
    await setup();
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "http://mara.localhost:3001" },
      { origin: "http://evil.localhost:3000" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { origin: "null", "sec-fetch-site": null },
      { origin: "not a url", "sec-fetch-site": null },
    ] as Record<string, string | null>[]) {
      const s = build();
      const response = await handleClickPost(
        post(CODE_ID, `code=${CODE}`, headers),
        params(CODE_ID),
        s.deps,
      );
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(s.rateLimit).not.toHaveBeenCalled();
      expect(s.resolveClickTarget).not.toHaveBeenCalled();
      expect(s.verify).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("accepts the interstitial's own form post: same origin, or Origin: null with Sec-Fetch-Site: same-origin (no-referrer)", async () => {
    await setup();
    for (const headers of [
      {},
      { origin: null, "sec-fetch-site": null },
      { origin: "null", "sec-fetch-site": "same-origin" },
      { origin: ORIGIN, "sec-fetch-site": "none" },
    ] as Record<string, string | null>[]) {
      const response = await handleClickPost(
        post(AGE_ID, "confirm=1", headers),
        params(AGE_ID),
        build().deps,
      );
      expect(response.status, JSON.stringify(headers)).toBe(303);
    }
  });

  it("takes only application/x-www-form-urlencoded: 415 for anything else, with no check", async () => {
    await setup();
    for (const type of [
      "application/json",
      "text/plain",
      "multipart/form-data; boundary=x",
      "",
      null,
    ]) {
      const s = build();
      const response = await handleClickPost(
        post(CODE_ID, `code=${CODE}`, { "content-type": type }),
        params(CODE_ID),
        s.deps,
      );
      expect(response.status, String(type)).toBe(415);
      expect(s.verify).not.toHaveBeenCalled();
    }
    const withCharset = await handleClickPost(
      post(AGE_ID, "confirm=1", {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      }),
      params(AGE_ID),
      build().deps,
    );
    expect(withCharset.status).toBe(303);
  });

  it("takes at most 1 KB: 413 above it, by the declared length and by the stream", async () => {
    await setup();
    const big = `code=${"a".repeat(1100)}`;
    const declared = await handleClickPost(post(CODE_ID, big), params(CODE_ID), build().deps);
    expect(declared.status).toBe(413);
    const chunked = new Request(`${ORIGIN}/r/${PAGE_ID}/${CODE_ID}`, {
      method: "POST",
      headers: {
        host: "mara.localhost:3000",
        "user-agent": IPHONE_UA,
        "content-type": "application/x-www-form-urlencoded",
        origin: ORIGIN,
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("code=" + "a".repeat(600)));
          controller.enqueue(new TextEncoder().encode("a".repeat(600)));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    const s = build();
    expect((await handleClickPost(chunked, params(CODE_ID), s.deps)).status).toBe(413);
    expect(s.verify).not.toHaveBeenCalled();
    const exactly = `code=${"a".repeat(1024 - 5)}`;
    expect(exactly.length).toBe(1024);
    expect(
      (await handleClickPost(post(CODE_ID, exactly), params(CODE_ID), build().deps)).status,
    ).toBe(403);
  });
});

describe("M9-29 the limits", () => {
  it("5 tries a minute per client per link: the 6th is 429 with Retry-After, and the right code is refused too", async () => {
    await setup();
    const memory = memoryLimiter();
    const s = build({ rateLimit: memory.limiter });
    for (let i = 0; i < 5; i++) {
      const response = await handleClickPost(
        post(CODE_ID, `code=${WRONG}${i}`),
        params(CODE_ID),
        s.deps,
      );
      expect(response.status).toBe(403);
    }
    const sixth = await handleClickPost(post(CODE_ID, `code=${WRONG}`), params(CODE_ID), s.deps);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toBe("60");
    expect(await sixth.text()).toContain("Too many tries. Wait a minute and try again.");
    const correct = await handleClickPost(post(CODE_ID, `code=${CODE}`), params(CODE_ID), s.deps);
    expect(correct.status).toBe(429);
    expect(correct.headers.get("location")).toBeNull();
    expect(s.verify).toHaveBeenCalledTimes(5);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("20 parallel wrong tries evaluate at most 5", async () => {
    await setup();
    const memory = memoryLimiter();
    const s = build({ rateLimit: memory.limiter });
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        handleClickPost(post(CODE_ID, `code=${WRONG}${i}`), params(CODE_ID), s.deps),
      ),
    );
    expect(responses.filter((r) => r.status === 403)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(15);
    expect(s.verify).toHaveBeenCalledTimes(5);
  });

  it("20 tries in ten minutes per client across links: the 21st is 429 on any link", async () => {
    await setup();
    const memory = memoryLimiter();
    const s = build({ rateLimit: memory.limiter });
    // Four links of five tries each stay under the per-link limit and use up the client's 20.
    const resolve = vi.fn(async (pageId: string, id: string) =>
      target(pageId, id.replace(/-\d$/, "")),
    );
    s.deps.resolveClickTarget = resolve;
    for (let link = 0; link < 4; link++) {
      for (let i = 0; i < 5; i++) {
        const id = `${CODE_ID}-${link}`;
        const response = await handleClickPost(post(id, `code=${WRONG}`), params(id), s.deps);
        expect(response.status).toBe(403);
      }
    }
    const next = await handleClickPost(
      post(`${CODE_ID}-9`, `code=${WRONG}`),
      params(`${CODE_ID}-9`),
      s.deps,
    );
    expect(next.status).toBe(429);
    expect(next.headers.get("retry-after")).toBe("600");
    expect(s.verify).toHaveBeenCalledTimes(20);
  });

  it("another client has its own budget", async () => {
    await setup();
    const memory = memoryLimiter();
    const s = build({ rateLimit: memory.limiter });
    for (let i = 0; i < 6; i++)
      await handleClickPost(post(CODE_ID, `code=${WRONG}`), params(CODE_ID), s.deps);
    const other = await handleClickPost(
      post(CODE_ID, `code=${CODE}`, { "x-forwarded-for": "198.51.100.9" }),
      params(CODE_ID),
      s.deps,
    );
    expect(other.status).toBe(303);
  });

  it("asks the limiter to fail closed for the code check, and for nothing else", async () => {
    await setup();
    const memory = memoryLimiter();
    const s = build({ rateLimit: memory.limiter });
    await handleClickPost(post(CODE_ID, `code=${WRONG}`), params(CODE_ID), s.deps);
    await handleClick(get(PLAIN_ID), params(PLAIN_ID), s.deps);
    const byPrefix = (prefix: string) => memory.calls.filter((call) => call.key.startsWith(prefix));
    expect(byPrefix("click:").map((call) => call.options)).toEqual([undefined, undefined]);
    expect(byPrefix("lock:").map((call) => call.options)).toEqual([{ failClosed: true }]);
    expect(byPrefix("lock-all:").map((call) => call.options)).toEqual([{ failClosed: true }]);
    expect(byPrefix("lock:")[0]).toMatchObject({ limit: 5, window: 60 });
    expect(byPrefix("lock-all:")[0]).toMatchObject({ limit: 20, window: 600 });
  });

  it("a limiter that failed (closed) is a 503 and no check is made: the correct code is not accepted either", async () => {
    await setup();
    const failing: IngestDeps["rateLimit"] = async (key) =>
      key.startsWith("lock")
        ? { allowed: false, retryAfter: 1, failed: true }
        : { allowed: true, retryAfter: 0 };
    const s = build({ rateLimit: failing });
    const response = await handleClickPost(post(CODE_ID, `code=${CODE}`), params(CODE_ID), s.deps);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain(
      "This link can’t be opened right now. Try again in a moment.",
    );
    expect(response.headers.get("location")).toBeNull();
    expect(s.verify).not.toHaveBeenCalled();
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("an age lock takes no code tries from the limiter", async () => {
    await setup();
    const memory = memoryLimiter();
    const s = build({ rateLimit: memory.limiter });
    await handleClickPost(post(AGE_ID, "confirm=1"), params(AGE_ID), s.deps);
    expect(memory.calls.filter((call) => call.key.startsWith("lock"))).toEqual([]);
  });

  it("the general click limiter (60 a minute) still applies to the interstitial and to the POST", async () => {
    await setup();
    const blocked: IngestDeps["rateLimit"] = async (key) =>
      key.startsWith("click:")
        ? { allowed: false, retryAfter: 30 }
        : { allowed: true, retryAfter: 0 };
    const s = build({ rateLimit: blocked });
    expect((await handleClick(get(CODE_ID), params(CODE_ID), s.deps)).status).toBe(429);
    const posted = await handleClickPost(post(CODE_ID, `code=${CODE}`), params(CODE_ID), s.deps);
    expect(posted.status).toBe(429);
    expect(posted.headers.get("retry-after")).toBe("30");
    expect(s.verify).not.toHaveBeenCalled();
  });
});

describe("M9-29 the secrets", () => {
  it("the code is never in a log, an error, a response header or a row, whatever happens", async () => {
    await setup();
    const log = spyOnConsole();
    const secret = "Sup3rS3cretCode!";
    const throwing = build({
      verifyLock: vi.fn(async () => {
        throw new Error("scrypt blew up");
      }),
    });
    const wrong = build();
    const failing = build({
      rateLimit: async (key) =>
        key.startsWith("lock")
          ? { allowed: false, retryAfter: 1, failed: true }
          : { allowed: true, retryAfter: 0 },
    });
    const responses = [
      await handleClickPost(post(CODE_ID, `code=${secret}`), params(CODE_ID), throwing.deps),
      await handleClickPost(post(CODE_ID, `code=${secret}`), params(CODE_ID), wrong.deps),
      await handleClickPost(post(CODE_ID, `code=${secret}`), params(CODE_ID), failing.deps),
    ];
    expect(responses.map((r) => r.status)).toEqual([503, 403, 503]);
    for (const response of responses) {
      expect(headersText(response)).not.toContain(secret);
      expect(await response.text()).not.toContain(secret);
    }
    await throwing.flush();
    await wrong.flush();
    expect(JSON.stringify([wrong.inserted, throwing.inserted])).not.toContain(secret);
    expect(log.text()).not.toContain(secret);
    log.restore();
  });

  it("the salt and the hash appear in no response of the flow", async () => {
    await setup();
    const s = build();
    const responses = [
      await handleClick(get(CODE_ID), params(CODE_ID), s.deps),
      await handleClick(get(CODE_ID, "HEAD"), params(CODE_ID), s.deps),
      await handleClickPost(post(CODE_ID, `code=${WRONG}`), params(CODE_ID), s.deps),
      await handleClickPost(post(CODE_ID, `code=${CODE}`), params(CODE_ID), s.deps),
      await handleClickPost(post(CODE_ID, ""), params(CODE_ID), s.deps),
    ];
    for (const response of responses) {
      const text = `${headersText(response)}\n${await response.text()}`;
      expect(text).not.toContain(salt);
      expect(text).not.toContain(hash);
    }
    await s.flush();
    expect(JSON.stringify(s.inserted)).not.toContain(hash);
  });

  it("no response of the flow sets a cookie", async () => {
    await setup();
    const s = build();
    for (const response of [
      await handleClick(get(CODE_ID), params(CODE_ID), s.deps),
      await handleClickPost(post(CODE_ID, `code=${CODE}`), params(CODE_ID), s.deps),
      await handleClickPost(post(CODE_ID, `code=${WRONG}`), params(CODE_ID), s.deps),
    ]) {
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
