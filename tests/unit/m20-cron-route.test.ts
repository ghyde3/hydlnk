import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spyOnConsole } from "./analytics-ingest-helpers";

/**
 * M20-08, M20-12: POST /api/cron/run-schedules answers 401 without `Authorization: Bearer
 * <CRON_SECRET>` (header only: not the query string, not the body), exports only POST, never echoes or
 * logs the secret, and answers 500 when a cache expiry failed or the run failed.
 */

vi.mock("server-only", () => ({}));
const SECRET = "cron-secret-value-for-m20-tests";
vi.mock("@/lib/env/server", () => ({ serverEnv: { CRON_SECRET: "cron-secret-value-for-m20-tests" } }));

const run = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/schedule/run", () => ({ runSchedules: () => run.fn() }));

const route = await import("@/app/(editor)/app/api/cron/run-schedules/route");
const URL_ = "http://app.localhost:3000/api/cron/run-schedules";
const post = (headers: Record<string, string> = {}, url = URL_, body?: string) =>
  route.POST(new NextRequest(url, { method: "POST", headers, ...(body ? { body } : {}) }));

const OK = { sites: 1, sitesFailed: 0, published: 2, unpublished: 1, failed: 0, retried: 0, expiryFailed: 0 };

beforeEach(() => {
  run.fn.mockReset();
  run.fn.mockResolvedValue(OK);
});

describe("M20-08 POST /api/cron/run-schedules", () => {
  it("M20-08 exports only POST, dynamic, with a 60 second budget", () => {
    const { POST, dynamic, maxDuration, ...rest } = route;
    expect(typeof POST).toBe("function");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
    expect(Object.keys(rest)).toEqual([]);
  });

  it("M20-08 a missing, wrong or malformed secret is a 401 and runs nothing", async () => {
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: SECRET },
      { authorization: `bearer ${SECRET}` },
    ];
    for (const headers of attempts) {
      const res = await post(headers);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(run.fn).not.toHaveBeenCalled();
  });

  it("M20-12 the secret in the query string or the body is ignored: 401", async () => {
    expect((await post({}, `${URL_}?secret=${SECRET}&authorization=Bearer%20${SECRET}`)).status).toBe(401);
    expect((await post({ "content-type": "application/json" }, URL_, JSON.stringify({ authorization: `Bearer ${SECRET}` }))).status).toBe(401);
    expect(run.fn).not.toHaveBeenCalled();
  });

  it("M20-08 with the secret it runs once and answers the counts", async () => {
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ sites: 1, published: 2, unpublished: 1, failed: 0, retried: 0 });
    expect(run.fn).toHaveBeenCalledTimes(1);
  });

  it("M20-04 a failed expiry (a site or an entry) answers 500", async () => {
    const quiet = spyOnConsole();
    run.fn.mockResolvedValueOnce({ ...OK, sitesFailed: 1 });
    expect((await post({ authorization: `Bearer ${SECRET}` })).status).toBe(500);
    run.fn.mockResolvedValueOnce({ ...OK, expiryFailed: 1 });
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "invalidate_failed" });
    quiet.restore();
  });

  it("M20-12 a failed run answers 500 and neither the answer nor any log line holds the secret", async () => {
    const logs = spyOnConsole();
    run.fn.mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("boom");
    await post({ authorization: "Bearer wrong" });
    expect(logs.text()).not.toContain(SECRET);
    logs.restore();
  });
});
