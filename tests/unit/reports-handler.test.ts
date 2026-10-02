import { describe, expect, it, vi } from "vitest";
import { handleReportRequest } from "@/lib/reports/handler";
import type { ReportDeps } from "@/lib/reports";

/** M5-05: the HTTP edge of POST /report/submit with a plain Request. */
const PAGE = "00000000-0000-4000-8000-0000000000b1";

function makeDeps(overrides: Partial<ReportDeps> = {}): ReportDeps {
  return {
    secret: "secret",
    rootDomain: "localhost:3000",
    now: () => new Date("2026-10-03T12:00:00Z"),
    findPageById: vi.fn(async () => ({ id: PAGE, handle: "mara" })),
    findPageByAddress: vi.fn(async () => ({ id: PAGE, handle: "mara" })),
    limiter: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    store: vi.fn(async () => "created" as const),
    ...overrides,
  };
}

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/report/submit", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body,
  });
const json = (value: unknown, headers: Record<string, string> = {}) =>
  post(JSON.stringify(value), headers);
const valid = { page: PAGE, reason: "phishing" };

describe("M5-05 POST /report/submit", () => {
  it("files a JSON report and answers JSON that is never cached", async () => {
    const deps = makeDeps();
    const response = await handleReportRequest(json(valid), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true, message: "Report sent. We’ll review it." });
    expect(deps.store).toHaveBeenCalledTimes(1);
  });

  it("accepts a classic form post too", async () => {
    const deps = makeDeps();
    const body = new URLSearchParams({
      page: PAGE,
      reason: "spam",
      details: "",
      email: "",
    }).toString();
    const response = await handleReportRequest(
      post(body, { "content-type": "application/x-www-form-urlencoded" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.store).toHaveBeenCalledTimes(1);
  });

  it("reads the IP from the platform header, never from the body", async () => {
    const deps = makeDeps();
    await handleReportRequest(
      json(
        { ...valid, ip: "9.9.9.9", "x-forwarded-for": "9.9.9.9" },
        { "x-forwarded-for": "203.0.113.7" },
      ),
      deps,
    );
    const [hashes] = vi.mocked(deps.limiter).mock.calls[0]!;
    const { reporterHashes } = await import("@/lib/reports");
    expect(hashes).toEqual(
      reporterHashes("203.0.113.7", "secret", new Date("2026-10-03T12:00:00Z")),
    );
  });

  it("a request with no client-ip header is counted in the shared unknown bucket, not skipped", async () => {
    const deps = makeDeps();
    await handleReportRequest(json(valid), deps);
    expect(deps.limiter).toHaveBeenCalledTimes(2); // the reporter, then the whole form
    const { reporterHashes, UNKNOWN_IP } = await import("@/lib/reports");
    expect(vi.mocked(deps.limiter).mock.calls[0]![0]).toEqual(
      reporterHashes(UNKNOWN_IP, "secret", new Date("2026-10-03T12:00:00Z")),
    );
  });

  it("5000 characters of details, an unknown reason and an invalid email are 400 and file nothing", async () => {
    for (const body of [
      { ...valid, details: "x".repeat(5000) },
      { ...valid, reason: "weird" },
      { ...valid, email: "not-an-email" },
    ]) {
      const deps = makeDeps();
      const response = await handleReportRequest(json(body), deps);
      expect(response.status).toBe(400);
      expect((await response.json()).errors).toBeDefined();
      expect(deps.store).not.toHaveBeenCalled();
    }
  });

  it("an oversized body is 413 (declared or streamed) and is never parsed or stored", async () => {
    const big = JSON.stringify({ ...valid, details: "x".repeat(40_000) });
    const declared = makeDeps();
    const a = await handleReportRequest(
      post(big, { "content-length": String(big.length) }),
      declared,
    );
    expect(a.status).toBe(413);
    const streamed = makeDeps();
    const b = await handleReportRequest(post(big), streamed);
    expect(b.status).toBe(413);
    expect(declared.store).not.toHaveBeenCalled();
    expect(streamed.store).not.toHaveBeenCalled();
    expect(streamed.limiter).not.toHaveBeenCalled();
  });

  it("malformed JSON, a JSON array and an unsupported content type are 400", async () => {
    const deps = makeDeps();
    expect((await handleReportRequest(post("{nope"), deps)).status).toBe(400);
    expect((await handleReportRequest(post("[1,2]"), deps)).status).toBe(400);
    expect(
      (await handleReportRequest(post("page=1", { "content-type": "text/plain" }), deps)).status,
    ).toBe(400);
    expect((await handleReportRequest(post(""), deps)).status).toBe(400);
    expect(deps.store).not.toHaveBeenCalled();
    expect(deps.limiter).not.toHaveBeenCalled();
  });

  it("a browser form on another site is 403; the same host and a request with no Origin pass", async () => {
    const other = makeDeps();
    expect(
      (await handleReportRequest(json(valid, { origin: "https://evil.example" }), other)).status,
    ).toBe(403);
    expect((await handleReportRequest(json(valid, { origin: "null" }), other)).status).toBe(403);
    expect(other.limiter).not.toHaveBeenCalled();
    const same = makeDeps();
    expect(
      (await handleReportRequest(json(valid, { origin: "http://localhost:3000" }), same)).status,
    ).toBe(200);
    expect((await handleReportRequest(json(valid), same)).status).toBe(200);
  });

  it("a refused report is 429 with Retry-After", async () => {
    const deps = makeDeps({ limiter: vi.fn(async () => ({ allowed: false, retryAfter: 90 })) });
    const response = await handleReportRequest(json(valid), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect((await response.json()).message).toBe("Too many reports. Try again later.");
    expect(deps.store).not.toHaveBeenCalled();
  });

  it("a failing dependency is a 500 that leaks nothing and is never a success", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deps = makeDeps({
      store: vi.fn(async () => {
        throw new Error("secret internal detail");
      }),
    });
    const response = await handleReportRequest(json(valid), deps);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("secret internal detail");
    expect(JSON.parse(text).ok).toBe(false);
    spy.mockRestore();
  });

  it("the honeypot answers 200 and files nothing", async () => {
    const deps = makeDeps();
    const response = await handleReportRequest(
      json({ ...valid, company_url: "https://spam.example" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.store).not.toHaveBeenCalled();
    expect(deps.limiter).not.toHaveBeenCalled();
  });
});
