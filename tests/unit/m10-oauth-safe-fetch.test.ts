import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CIMD_MAX_BYTES,
  CIMD_TIMEOUT_MS,
  LOGO_MAX_BYTES,
  fetchClientDocument,
  isJsonType,
  type FetchTarget,
  type SafeFetchOptions,
  type Transport,
  type TransportResponse,
} from "@/lib/oauth/safe-fetch";

vi.mock("server-only", () => ({}));

/**
 * M10-07: the fetch of an address a client chose. The DNS answer and the socket are injected, so every
 * row runs with no network: what is refused before and after the lookup, which address the connection
 * goes to, the headers sent, the deadline, and the size cap.
 */

const ROOT = "hydlnk.com";
const DOC = "https://app.example.com/oauth/client.json";
const OPTIONS: SafeFetchOptions = {
  maxBytes: CIMD_MAX_BYTES,
  accept: "application/json",
  acceptsType: isJsonType,
};
const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1::1";

interface Recorder {
  targets: FetchTarget[];
  resolved: string[];
  destroyed: number;
  consumed: number;
}

function chunksOf(text: string, size = 4096): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return (async function* () {
    for (let at = 0; at < bytes.length; at += size) yield bytes.slice(at, at + size);
  })();
}

function transportFor(
  rec: Recorder,
  response: Partial<TransportResponse> & {
    status?: number;
    text?: string;
    headers?: Record<string, string>;
  } = {},
): Transport {
  return async (target) => {
    rec.targets.push(target);
    return {
      status: response.status ?? 200,
      headers: { "content-type": "application/json", ...(response.headers ?? {}) },
      chunks: response.chunks ?? chunksOf(response.text ?? "{}"),
      destroy: () => {
        rec.destroyed += 1;
      },
    };
  };
}

function setup(addresses: string[] | (() => string[]) = [PUBLIC_V4]) {
  const rec: Recorder = { targets: [], resolved: [], destroyed: 0, consumed: 0 };
  const resolve = async (host: string) => {
    rec.resolved.push(host);
    return typeof addresses === "function" ? addresses() : addresses;
  };
  return { rec, resolve };
}

const run = (
  address: string,
  rec: Recorder,
  resolve: (host: string) => Promise<string[]>,
  transport: Transport,
  over: { timeoutMs?: number; allowTestStub?: boolean; options?: SafeFetchOptions } = {},
) =>
  fetchClientDocument(
    address,
    {
      rootDomain: ROOT,
      resolve,
      transport,
      timeoutMs: over.timeoutMs,
      allowTestStub: over.allowTestStub,
    },
    over.options ?? OPTIONS,
  );

describe("M10-07 the constants", () => {
  it("are pinned", () => {
    expect(CIMD_TIMEOUT_MS).toBe(3000);
    expect(CIMD_MAX_BYTES).toBe(5120);
    expect(LOGO_MAX_BYTES).toBe(100 * 1024);
  });
});

describe("M10-07 what is refused before a lookup", () => {
  it.each([
    ["http://app.example.com/x", "bad_scheme"],
    ["https://app.example.com", "bad_scheme"],
    ["https://127.0.0.1/x", "ssrf_blocked"],
    ["https://localhost/x", "ssrf_blocked"],
    ["https://app.hydlnk.com/x", "ssrf_blocked"],
    ["https://user@app.example.com/x", "bad_scheme"],
    ["https://app.example.com:8443/x", "bad_scheme"],
  ])("%s makes no lookup and no connection", async (address, reason) => {
    const { rec, resolve } = setup();
    const result = await run(address, rec, resolve, transportFor(rec));
    expect(result).toMatchObject({ ok: false, reason });
    expect(rec.resolved).toEqual([]);
    expect(rec.targets).toEqual([]);
  });
});

describe("M10-07 resolution", () => {
  it("resolves the name once, connects to the validated address, and keeps the name for the server name and Host", async () => {
    const { rec, resolve } = setup([PUBLIC_V6, PUBLIC_V4]);
    const result = await run(DOC, rec, resolve, transportFor(rec, { text: '{"a":1}' }));
    expect(result).toMatchObject({
      ok: true,
      contentType: "application/json",
      host: "app.example.com",
    });
    expect(rec.resolved).toEqual(["app.example.com"]);
    expect(rec.targets).toHaveLength(1);
    expect(rec.targets[0]).toMatchObject({
      hostname: "app.example.com",
      ip: PUBLIC_V6,
      family: 6,
      port: 443,
      path: "/oauth/client.json",
      secure: true,
    });
  });

  it("is refused when nothing resolves, and when ANY address is not public", async () => {
    for (const answers of [
      [],
      ["127.0.0.1"],
      [PUBLIC_V4, "10.0.0.1"],
      [PUBLIC_V6, "::1"],
      ["169.254.169.254"],
      ["::ffff:127.0.0.1"],
    ]) {
      const { rec, resolve } = setup(answers);
      const result = await run(DOC, rec, resolve, transportFor(rec));
      expect(result, JSON.stringify(answers)).toMatchObject({ ok: false, reason: "ssrf_blocked" });
      expect(rec.targets).toEqual([]);
    }
  });

  it("a resolver that answers a public address first and 127.0.0.1 the second time sees the connection go to the first", async () => {
    let calls = 0;
    const { rec, resolve } = setup(() => (calls++ === 0 ? [PUBLIC_V4] : ["127.0.0.1"]));
    const result = await run(DOC, rec, resolve, transportFor(rec));
    expect(result.ok).toBe(true);
    expect(rec.targets[0]!.ip).toBe(PUBLIC_V4);
    expect(rec.resolved).toHaveLength(1);
  });

  it("the request path keeps the query string", async () => {
    const { rec, resolve } = setup();
    await run("https://app.example.com/oauth/c.json?v=2", rec, resolve, transportFor(rec));
    expect(rec.targets[0]!.path).toBe("/oauth/c.json?v=2");
  });
});

describe("M10-07 the request", () => {
  it("is a GET with Accept, identity encoding and our user agent, and no cookie, Authorization or other header", async () => {
    const { rec, resolve } = setup();
    await run(DOC, rec, resolve, transportFor(rec));
    expect(rec.targets[0]!.headers).toEqual({
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "User-Agent": "HYDLNK-OAuth/1",
    });
  });
});

describe("M10-07 the answer", () => {
  it.each([[301], [302], [303], [307], [308]])(
    "a %s is refused whatever its Location",
    async (status) => {
      const { rec, resolve } = setup();
      const result = await run(
        DOC,
        rec,
        resolve,
        transportFor(rec, { status, headers: { location: "https://app.example.com/other" } }),
      );
      expect(result).toMatchObject({ ok: false, reason: "redirected" });
      expect(rec.targets).toHaveLength(1);
    },
  );

  it.each([[204], [206], [400], [404], [500], [503]])("a %s is refused", async (status) => {
    const { rec, resolve } = setup();
    expect(await run(DOC, rec, resolve, transportFor(rec, { status }))).toMatchObject({
      ok: false,
      reason: "bad_status",
    });
  });

  it.each([
    ["text/html", false],
    ["text/plain", false],
    ["", false],
    ["application/octet-stream", false],
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["Application/JSON", true],
    ["application/ld+json", true],
    ["application/jrd+json; charset=utf-8", true],
  ])("a content type of %j is %s", async (type, accepted) => {
    const { rec, resolve } = setup();
    const result = await run(
      DOC,
      rec,
      resolve,
      transportFor(rec, { headers: { "content-type": type } }),
    );
    expect(result.ok).toBe(accepted);
    if (!accepted) expect(result).toMatchObject({ reason: "bad_type" });
  });

  it("a content encoding other than identity is refused", async () => {
    const { rec, resolve } = setup();
    for (const encoding of ["gzip", "br", "deflate"]) {
      const result = await run(
        DOC,
        rec,
        resolve,
        transportFor(rec, { headers: { "content-encoding": encoding } }),
      );
      expect(result).toMatchObject({ ok: false, reason: "bad_type" });
    }
    expect(
      (
        await run(
          DOC,
          rec,
          resolve,
          transportFor(rec, { headers: { "content-encoding": "identity" } }),
        )
      ).ok,
    ).toBe(true);
  });

  it("a Content-Length over the cap is refused before a byte is read", async () => {
    const { rec, resolve } = setup();
    let read = 0;
    const chunks: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            read += 1;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const result = await run(
      DOC,
      rec,
      resolve,
      transportFor(rec, { chunks, headers: { "content-length": String(CIMD_MAX_BYTES + 1) } }),
    );
    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    expect(read).toBe(0);
  });

  it("a stub streaming 1 MB is closed after 5,121 bytes and never buffered", async () => {
    const { rec, resolve } = setup();
    let produced = 0;
    const chunks: AsyncIterable<Uint8Array> = (async function* () {
      for (let i = 0; i < 1024 * 1024; i += 1) {
        produced += 1;
        yield new Uint8Array([123]);
      }
    })();
    const result = await run(DOC, rec, resolve, transportFor(rec, { chunks }));
    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    expect(produced).toBe(CIMD_MAX_BYTES + 1);
    expect(rec.destroyed).toBeGreaterThanOrEqual(1);
  });

  it("a body of exactly the cap is accepted", async () => {
    const { rec, resolve } = setup();
    const result = await run(
      DOC,
      rec,
      resolve,
      transportFor(rec, { text: "x".repeat(CIMD_MAX_BYTES) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.byteLength).toBe(CIMD_MAX_BYTES);
  });

  it("returns the Cache-Control header of the response, for the cache window", async () => {
    const { rec, resolve } = setup();
    const result = await run(
      DOC,
      rec,
      resolve,
      transportFor(rec, { headers: { "cache-control": "max-age=7200" } }),
    );
    expect(result).toMatchObject({ ok: true, cacheControl: "max-age=7200" });
  });

  it("the socket is closed on every path", async () => {
    const { rec, resolve } = setup();
    await run(DOC, rec, resolve, transportFor(rec));
    await run(DOC, rec, resolve, transportFor(rec, { status: 500 }));
    await run(DOC, rec, resolve, transportFor(rec, { headers: { "content-type": "text/html" } }));
    expect(rec.destroyed).toBe(3);
  });
});

describe("M10-07 one deadline of three seconds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("covers the lookup", async () => {
    const rec: Recorder = { targets: [], resolved: [], destroyed: 0, consumed: 0 };
    const result = run(DOC, rec, () => new Promise(() => undefined), transportFor(rec));
    await vi.advanceTimersByTimeAsync(CIMD_TIMEOUT_MS);
    expect(await result).toMatchObject({ ok: false, reason: "timeout" });
    expect(rec.targets).toEqual([]);
  });

  it("covers the connection", async () => {
    const { rec, resolve } = setup();
    const never: Transport = () => new Promise(() => undefined);
    const result = run(DOC, rec, resolve, never);
    await vi.advanceTimersByTimeAsync(CIMD_TIMEOUT_MS);
    expect(await result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("covers the body: a server that trickles bytes is cut at the deadline and the socket destroyed", async () => {
    const { rec, resolve } = setup();
    const slow: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ done: false, value: new Uint8Array([1]) }), 1000),
            ),
        };
      },
    };
    const result = run(DOC, rec, resolve, transportFor(rec, { chunks: slow }));
    await vi.advanceTimersByTimeAsync(CIMD_TIMEOUT_MS + 10);
    expect(await result).toMatchObject({ ok: false, reason: "timeout" });
    expect(rec.destroyed).toBeGreaterThanOrEqual(1);
  });

  it("a fast answer is not cut", async () => {
    const { rec, resolve } = setup();
    const result = run(DOC, rec, resolve, transportFor(rec));
    await vi.advanceTimersByTimeAsync(10);
    expect((await result).ok).toBe(true);
  });
});

describe("M10-07 a transport that fails", () => {
  it("is a network refusal that names nothing", async () => {
    const { rec, resolve } = setup();
    const result = await run(DOC, rec, resolve, async () => {
      throw new Error("ECONNREFUSED 93.184.216.34:443");
    });
    expect(result).toEqual({ ok: false, reason: "network", host: "app.example.com" });
    expect(JSON.stringify(result)).not.toContain("93.184");
  });
});

describe("M10-07 the test seam", () => {
  it("the stub address is fetched without a lookup, over http on port 12113, only when the hooks allow it", async () => {
    const { rec, resolve } = setup();
    const stub = "http://127.0.0.1:12113/client.json";
    const refused = await run(stub, rec, resolve, transportFor(rec), { allowTestStub: false });
    expect(refused).toMatchObject({ ok: false, reason: "bad_scheme" });
    expect(rec.targets).toEqual([]);
    const allowed = await run(stub, rec, resolve, transportFor(rec), { allowTestStub: true });
    expect(allowed.ok).toBe(true);
    expect(rec.resolved).toEqual([]);
    expect(rec.targets[0]).toMatchObject({
      ip: "127.0.0.1",
      port: 12113,
      secure: false,
      path: "/client.json",
      hostname: "127.0.0.1",
    });
  });
});
