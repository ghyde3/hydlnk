import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  MEDIA_BROWSER_CACHE_CONTROL,
  MEDIA_CDN_CACHE_CONTROL,
  MEDIA_CDN_MAX_AGE,
  MEDIA_MAX_BYTES,
  MEDIA_MISS_CACHE_CONTROL,
  MEDIA_UPSTREAM_TIMEOUT_MS,
  methodNotAllowed,
  serveMedia,
} from "@/lib/media/serve";
import { storageUrl } from "@/lib/media/url";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M7-14: the `/media/{uid}/{file}` route, tested without a server: the request goes in, the
 * response comes out, and the upstream is an injected fetch that records every call. Every refusal
 * must record zero calls (never an open proxy), and the cache headers are the cost protection.
 */

const UID = "0b6f1a5e-7c1d-4a52-9d0e-3a7c5e8f2b14";
const FILE = "img-0123456789abcdef0123456789abcdef.webp";
const PATH = `${UID}/${FILE}`;
const ORIGIN = "http://127.0.0.1:54321";
const BYTES = Uint8Array.from({ length: 2048 }, (_, i) => (i * 7) % 251);

type Spy = ReturnType<typeof makeFetch>;

/** An injected fetch that answers `answer()` and remembers what it was asked. */
function makeFetch(answer: () => Response | Promise<Response> = () => image()) {
  return vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
    answer(),
  );
}

function image(
  over: {
    status?: number;
    type?: string | null;
    length?: number | null;
    body?: BodyInit | null;
    headers?: Record<string, string>;
  } = {},
): Response {
  const headers = new Headers(over.headers);
  if (over.type !== null) headers.set("content-type", over.type ?? "image/webp");
  const length = over.length === undefined ? BYTES.byteLength : over.length;
  if (length !== null) headers.set("content-length", String(length));
  const body = over.body === undefined ? BYTES : over.body;
  return new Response(body, { status: over.status ?? 200, headers });
}

const serve = (spy: Spy, path = `/media/${PATH}`, init?: RequestInit, segments?: string[]) =>
  serveMedia(new Request(`http://localhost:3000${path}`, init), {
    fetch: spy as unknown as typeof fetch,
    segments,
  });

const headerNames = (res: Response) => [...res.headers.keys()].sort();

const MISS = {
  "cache-control": "public, max-age=60",
  "vercel-cdn-cache-control": "public, max-age=60",
};

function expectMiss(res: Response): void {
  expect(res.status).toBe(404);
  expect(res.headers.get("cache-control")).toBe(MISS["cache-control"]);
  expect(res.headers.get("vercel-cdn-cache-control")).toBe(MISS["vercel-cdn-cache-control"]);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("M7-14 the cache headers are the cost protection", () => {
  it("pins both values, and says why", () => {
    // The browser keeps an image for a year: names are content hashes and are never reused
    // (M2-08, M5-11), so the bytes under a name never change.
    expect(MEDIA_BROWSER_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    // Vercel's CDN keeps it seven days from one Storage fetch, not a year: the object never
    // changes, but a deleted image, an account's removed media and a removed photo stop being
    // served within seven days instead of a year. The cost is one more Storage fetch per image,
    // host and region a week. Gary can raise MEDIA_CDN_MAX_AGE to 31536000 for fewer fetches.
    expect(MEDIA_CDN_MAX_AGE).toBe(7 * 24 * 60 * 60);
    expect(MEDIA_CDN_MAX_AGE).toBe(604800);
    expect(MEDIA_CDN_CACHE_CONTROL).toBe("public, max-age=604800");
    // A miss is cached for a minute: a missing image costs one Storage request a minute, not one
    // per view.
    expect(MEDIA_MISS_CACHE_CONTROL).toBe("public, max-age=60");
    expect(MEDIA_UPSTREAM_TIMEOUT_MS).toBe(5000);
    expect(MEDIA_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("M7-14 an image is served with exactly the headers it needs", () => {
  it.each([
    ["a webp", "webp", "image/webp"],
    ["an older png", "png", "image/png"],
    ["an older jpg", "jpg", "image/jpeg"],
  ])("%s", async (_name, ext, type) => {
    const path = `${UID}/img-0123456789abcdef.${ext}`;
    const spy = makeFetch(() => image({ type }));
    const res = await serve(spy, `/media/${path}`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("vercel-cdn-cache-control")).toBe("public, max-age=604800");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBe(String(BYTES.byteLength));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(storageUrl(path));
  });

  it("builds the response from its own list: nothing the upstream sent comes through", async () => {
    const spy = makeFetch(() =>
      image({
        type: "image/webp; charset=binary",
        headers: {
          "set-cookie": "sb=1; Path=/",
          etag: '"abc"',
          "cache-control": "max-age=3600",
          "access-control-allow-origin": "*",
          "x-supabase-trace": "1",
          server: "storage",
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
        },
      }),
    );
    const res = await serve(spy);
    expect(res.status).toBe(200);
    expect(headerNames(res)).toEqual([
      "cache-control",
      "content-length",
      "content-type",
      "vercel-cdn-cache-control",
      "x-content-type-options",
    ]);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe(MEDIA_BROWSER_CACHE_CONTROL);
  });

  it("HEAD asks Storage with HEAD and answers the same status and headers with no body", async () => {
    const getSpy = makeFetch();
    const get = await serve(getSpy);
    const headSpy = makeFetch(() => image({ body: null }));
    const head = await serve(headSpy, `/media/${PATH}`, { method: "HEAD" });
    expect(headSpy.mock.calls[0]![1]!.method).toBe("HEAD");
    expect(getSpy.mock.calls[0]![1]!.method).toBe("GET");
    expect(head.status).toBe(200);
    expect([...head.headers.entries()].sort()).toEqual([...get.headers.entries()].sort());
    expect(await head.text()).toBe("");
    expect(head.body).toBeNull();
  });

  it("HEAD of a missing image is the same short 404 as GET", async () => {
    const spy = makeFetch(() => new Response(null, { status: 404 }));
    const res = await serve(spy, `/media/${PATH}`, { method: "HEAD" });
    expectMiss(res);
  });

  it("answers the same with an auth cookie, an Authorization header and a session on the request", async () => {
    const spy = makeFetch();
    const plain = await serve(spy);
    const spy2 = makeFetch();
    const res = await serve(spy2, `/media/${PATH}`, {
      headers: {
        cookie: "sb-access-token=secret; sb-refresh-token=secret2",
        authorization: "Bearer secret",
        apikey: "secret",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect([...res.headers.entries()].sort()).toEqual([...plain.headers.entries()].sort());
    // Nothing of the caller's reaches Storage: no headers at all in the upstream request.
    const init = spy2.mock.calls[0]![1]!;
    expect(init.headers).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain("secret");
  });
});

describe("M7-14 methods", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s answers 405 with Allow: GET, HEAD",
    async (method) => {
      const spy = makeFetch();
      const res = await serve(spy, `/media/${PATH}`, {
        method,
        body: method === "DELETE" ? null : "x",
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it("methodNotAllowed (what the route file exports for each of them) is the same", () => {
    const res = methodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("M7-14 never an open proxy: every refusal makes no upstream request", () => {
  const A = `${UID}/img-0123456789ab.webp`;
  const refused: [string, string][] = [
    ["no path", "/media"],
    ["an empty path", "/media/"],
    ["one segment", `/media/${UID}`],
    ["one segment and a slash", `/media/${UID}/`],
    ["three segments", `/media/${A}/extra`],
    ["three segments, a folder first", `/media/x/${A}`],
    ["an empty folder", "/media//img-0123456789ab.webp"],
    ["an empty name", `/media/${UID}//img-0123456789ab.webp`],
    ["no name", `/media/${UID}/.webp`],
    ["dot dot", `/media/${UID}/../img-0123456789ab.webp`],
    ["dot dot first", `/media/../${A}`],
    ["encoded dot dot", `/media/%2e%2e/${A}`],
    ["encoded dot dot, upper case", `/media/%2E%2E/${A}`],
    ["encoded dot dot inside a segment", `/media/${UID}%2e%2e/img-0123456789ab.webp`],
    ["an encoded slash", `/media/${UID}%2fimg-0123456789ab.webp`],
    ["an encoded slash, upper case", `/media/${UID}%2Fimg-0123456789ab.webp`],
    ["an encoded backslash", `/media/${UID}%5cimg-0123456789ab.webp`],
    ["an encoded traversal in the name", `/media/${UID}/%2e%2e%2f%2e%2e%2fimg-0123456789ab.webp`],
    ["an encoded letter (one image, one address)", `/media/${UID}/img-%30123456789ab.webp`],
    ["an encoded dash", `/media/${UID}/img%2d0123456789ab.webp`],
    ["a space", `/media/${UID}/img-0123456789ab.webp%20`],
    ["a non-ASCII name", `/media/${UID}/%C3%AFmg-0123456789ab.webp`],
    ["a null byte", `/media/${UID}/img-0123456789ab.webp%00`],
    ["an upper-case folder", `/media/${UID.toUpperCase()}/img-0123456789ab.webp`],
    ["an upper-case name", `/media/${UID}/IMG-0123456789AB.webp`],
    ["an upper-case extension", `/media/${UID}/img-0123456789ab.WEBP`],
    ["a mixed-case extension", `/media/${UID}/img-0123456789ab.Webp`],
    ["a 37-character folder", `/media/${UID}0/img-0123456789ab.webp`],
    ["a 35-character folder", `/media/${UID.slice(0, -1)}/img-0123456789ab.webp`],
    ["a name of 7 characters", `/media/${UID}/abcdefg.webp`],
    ["a name of 65 characters", `/media/${UID}/${"a".repeat(65)}.webp`],
    ["svg", `/media/${UID}/img-0123456789ab.svg`],
    ["html", `/media/${UID}/img-0123456789ab.html`],
    ["gif", `/media/${UID}/img-0123456789ab.gif`],
    ["jpeg (the stored extension is jpg)", `/media/${UID}/img-0123456789ab.jpeg`],
    ["avif", `/media/${UID}/img-0123456789ab.avif`],
    ["webp.exe", `/media/${UID}/img-0123456789ab.webp.exe`],
    ["a double extension", `/media/${UID}/img-0123456789ab.png.webp`],
    ["no extension", `/media/${UID}/img-0123456789ab`],
    ["a trailing slash", `/media/${A}/`],
    ["a query string", `/media/${A}?x=1`],
    ["a query with several keys", `/media/${A}?x=1&y=2`],
    ["a query with no value", `/media/${A}?download`],
    ["an empty query", `/media/${A}?`],
    ["another prefix", `/medias/${A}`],
    ["an upper-case prefix", `/Media/${A}`],
    ["no prefix", `/${A}`],
    ["a storage path", `/storage/v1/object/public/page-media/${A}`],
    ["a path from another bucket", `/media/other/${A}`],
  ];

  it.each(refused)(
    "%s: 404 with the short public cache, and no Storage request",
    async (_name, path) => {
      const spy = makeFetch();
      const res = await serve(spy, path);
      expectMiss(res);
      expect(spy).not.toHaveBeenCalled();
      // The body says nothing about why, and is never an image.
      expect(await res.text()).toBe("Not found");
    },
  );

  it("a backslash: the router read one segment, so the path is refused (the URL parser would fix it)", async () => {
    // `new URL` turns a backslash into a slash, which would make this a valid path. The router's
    // own segments (one: `uid\file`) say it is not.
    const spy = makeFetch();
    const res = await serve(spy, `/media/${UID}\\img-0123456789ab.webp`, undefined, [
      `${UID}\\img-0123456789ab.webp`,
    ]);
    expectMiss(res);
    expect(spy).not.toHaveBeenCalled();
  });

  it("segments the router split differently from the path are refused; the same ones pass", async () => {
    const spy = makeFetch();
    expectMiss(await serve(spy, `/media/${A}`, undefined, [UID, "img-0123456789ab.png"]));
    expect(spy).not.toHaveBeenCalled();
    const ok = await serve(spy, `/media/${A}`, undefined, [UID, "img-0123456789ab.webp"]);
    expect(ok.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("whatever the request says about hosts, the upstream is the Storage origin and nothing else", async () => {
    const spy = makeFetch();
    const res = await serve(spy, `/media/${A}`, {
      headers: {
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-original-host": "evil.example",
        "x-forwarded-proto": "https",
        referer: "https://evil.example/page",
        origin: "https://evil.example",
      },
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const url = new URL(String(spy.mock.calls[0]![0]));
    expect(url.origin).toBe(ORIGIN);
    expect(String(spy.mock.calls[0]![0])).toBe(storageUrl(A));
    expect(spy.mock.calls[0]![1]!.headers).toBeUndefined();
  });
});

describe("M7-14 the upstream fetch is locked down", () => {
  it("is not redirected, not cached by Next, times out, and carries no credentials", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const spy = makeFetch();
    await (await serve(spy)).arrayBuffer();
    expect(spy).toHaveBeenCalledTimes(1);
    const [input, init] = spy.mock.calls[0]!;
    expect(input).toBe(storageUrl(PATH));
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    // No Cookie, Authorization or apikey, because no headers at all.
    expect(Object.keys(init!)).not.toContain("headers");
    expect(Object.keys(init!).sort()).toEqual([
      "cache",
      "credentials",
      "method",
      "redirect",
      "signal",
    ]);
    timeout.mockRestore();
  });

  it("a Storage redirect (fetch rejects with redirect: 'error') answers 502, never followed", async () => {
    const spy = makeFetch(() => {
      throw new TypeError("fetch failed: unexpected redirect");
    });
    const res = await serve(spy);
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a TimeoutError", () => new DOMException("The operation timed out.", "TimeoutError")],
    ["an AbortError", () => new DOMException("The operation was aborted.", "AbortError")],
  ])("%s answers 504, never cached", async (_name, make) => {
    const res = await serve(
      makeFetch(() => {
        throw make();
      }),
    );
    expect(res.status).toBe(504);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull();
  });

  it.each([
    ["a network error", new TypeError("fetch failed")],
    ["any other error", new Error("boom")],
    ["a non-error throw", "boom"],
  ])("%s answers 502, never cached", async (_name, error) => {
    const res = await serve(
      makeFetch(() => {
        throw error;
      }),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("vercel-cdn-cache-control")).toBeNull();
  });

  it.each([400, 401, 403, 404, 410, 429])(
    "a Storage %i is a missing image: 404, cached for a minute",
    async (status) => {
      const res = await serve(makeFetch(() => image({ status, body: '{"error":"not_found"}' })));
      expectMiss(res);
      expect(await res.text()).toBe("Not found"); // Storage's own body is not relayed
    },
  );

  it.each([500, 502, 503, 504, 301, 302, 307, 308])(
    "a Storage %i is a failure: 502, never cached",
    async (status) => {
      const res = await serve(makeFetch(() => image({ status })));
      expect(res.status).toBe(502);
      expect(res.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("a 200 GET with no body is a failure, not an empty image", async () => {
    const res = await serve(
      makeFetch(
        () => new Response(null, { status: 200, headers: { "content-type": "image/webp" } }),
      ),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts only a 200: a 206 or 204 is not an image", async () => {
    expectMiss(await serve(makeFetch(() => image({ status: 206 }))));
    expectMiss(await serve(makeFetch(() => new Response(null, { status: 204 }))));
  });

  it.each([
    ["svg", "image/svg+xml"],
    ["html", "text/html"],
    ["html with a charset", "text/html; charset=utf-8"],
    ["json", "application/json"],
    ["a gif", "image/gif"],
    ["an avif", "image/avif"],
    ["the generic stream type", "application/octet-stream"],
    ["no type", null],
    ["an empty type", ""],
  ])("%s from Storage answers 404 and the body is never relayed", async (_name, type) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<svg onload=alert(1)>"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = await serve(makeFetch(() => image({ type, body, length: 21 })));
    expectMiss(res);
    expect(await res.text()).toBe("Not found");
    expect(cancelled).toBe(true);
  });

  it("an upper-case or parameterised image type is read and sent back clean", async () => {
    const res = await serve(makeFetch(() => image({ type: "IMAGE/PNG ; q=1" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("an upstream Content-Length over 5 MiB answers 404; exactly 5 MiB is served", async () => {
    const big = await serve(makeFetch(() => image({ length: MEDIA_MAX_BYTES + 1 })));
    expectMiss(big);
    const edge = await serve(makeFetch(() => image({ length: MEDIA_MAX_BYTES })));
    expect(edge.status).toBe(200);
    expect(edge.headers.get("content-length")).toBe(String(MEDIA_MAX_BYTES));
    // A length that is not a number is not a length.
    const odd = await serve(
      makeFetch(() => image({ headers: { "content-length": "abc" }, length: null })),
    );
    expect(odd.status).toBe(200);
    expect(odd.headers.get("content-length")).toBeNull();
  });

  it("does not trust a Content-Length that an encoded body no longer has", async () => {
    const res = await serve(makeFetch(() => image({ headers: { "content-encoding": "gzip" } })));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBeNull();
  });
});

describe("M7-14 the body is streamed through, not read into memory first", () => {
  function counted(chunks: number, size: number) {
    const state = { pulls: 0 };
    const chunk = new Uint8Array(size).fill(7);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulls += 1;
        if (state.pulls > chunks) controller.close();
        else controller.enqueue(chunk);
      },
    });
    return { state, stream };
  }

  it("answers before the body has been read, then relays every byte", async () => {
    const { state, stream } = counted(100, 1024);
    const res = await serve(makeFetch(() => image({ body: stream, length: 100 * 1024 })));
    expect(res.status).toBe(200);
    expect(state.pulls).toBeLessThan(5); // not 100: nothing buffered the body
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(100 * 1024);
    expect(state.pulls).toBeGreaterThanOrEqual(100);
  });

  it("with no upstream length the body is counted as it goes, and cut at the limit", async () => {
    const small = counted(2, 1024 * 1024);
    const ok = await serve(makeFetch(() => image({ body: small.stream, length: null })));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-length")).toBeNull();
    expect((await ok.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);

    const huge = counted(6, 1024 * 1024);
    const bad = await serve(makeFetch(() => image({ body: huge.stream, length: null })));
    expect(bad.status).toBe(200); // the headers had already gone when the size showed
    await expect(bad.arrayBuffer()).rejects.toThrow();
  });
});

describe("M7-14 abuse and load", () => {
  it("200 well-formed but missing paths each answer 404, and the route stays healthy", async () => {
    const spy = makeFetch(() => new Response('{"error":"not_found"}', { status: 404 }));
    for (let i = 0; i < 200; i += 1) {
      const name = `img-${i.toString(16).padStart(12, "0")}.webp`;
      expectMiss(await serve(spy, `/media/${UID}/${name}`));
    }
    expect(spy).toHaveBeenCalledTimes(200);
    // And an image still comes through afterwards.
    const ok = await serve(makeFetch(), `/media/${PATH}`);
    expect(ok.status).toBe(200);
  });

  it("200 malformed paths cost no Storage request at all", async () => {
    const spy = makeFetch();
    for (let i = 0; i < 200; i += 1) {
      expectMiss(await serve(spy, `/media/${UID}/img-${i}.svg`));
      expectMiss(await serve(spy, `/media/${UID}/img-0123456789ab.webp?v=${i}`));
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("M7-14 the route's own code", () => {
  const route = readFileSync("src/app/media/[...path]/route.ts", "utf8");
  const serveSource = readFileSync("src/lib/media/serve.ts", "utf8");
  const code = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/.*$/gm, "");

  it("imports no secret-key client, no server-only module and no cookie or header reader", () => {
    for (const [name, text] of [
      ["route.ts", code(route)],
      ["serve.ts", code(serveSource)],
    ] as const) {
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
      for (const path of imports) {
        expect(path, `${name} imports ${path}`).toMatch(
          /^(@\/lib\/media\/(serve|url)|@\/lib\/document\/schema|\.\/url)$/,
        );
      }
      expect(text, name).not.toMatch(
        /server-only|SECRET|createAdminSupabase|next\/headers|cookies\(|headers\(\)/,
      );
      expect(text, name).not.toMatch(/console\./); // no logging of request headers or cookies
    }
  });

  it("storageUrl is the only place the Storage address is built for it", () => {
    const text = code(serveSource);
    expect(text).toContain("storageUrl(path)");
    expect(text).not.toMatch(
      /storage\/v1|NEXT_PUBLIC_SUPABASE_URL|clientEnv|supabase\.co|127\.0\.0\.1/,
    );
    // And the route file does not fetch at all: it only hands the request to serveMedia.
    expect(code(route)).not.toMatch(/\bfetch\(/);
  });

  it("the route file answers every method (GET and HEAD serve, the rest are 405) and is dynamic", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(route).toMatch(new RegExp(`export (async function|const) ${method}\\b`));
    }
    expect(route).toContain('export const dynamic = "force-dynamic"');
  });
});
