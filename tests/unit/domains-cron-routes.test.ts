import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCron } from "@/lib/domains/cron-auth";
import { IDS, domainRow, harness } from "./domains-fakes";

vi.mock("server-only", () => ({}));

const SECRET = "cron-secret-value-for-unit-tests";
vi.mock("@/lib/env/server", () => ({ serverEnv: { CRON_SECRET: "cron-secret-value-for-unit-tests" } }));

let current = harness();
vi.mock("@/lib/domains/deps-server", () => ({ createDomainDeps: () => current.deps }));

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>();
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUser() }));

const { POST, ...sweepRoute } = await import("@/app/(editor)/app/api/cron/verify-domains/route");
const pollRoute = await import("@/app/(editor)/app/api/domains/[id]/route");

const post = (headers: Record<string, string> = {}, url = "http://app.localhost:3000/api/cron/verify-domains") =>
  POST(new NextRequest(url, { method: "POST", headers }));

beforeEach(() => {
  current = harness();
  sessionUser.mockReset();
});

describe("M4-15 the secret check", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer ", SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer", SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron(undefined, SECRET)).toBe(false);
  });

  it("an unset secret never authorises anyone", () => {
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer anything", "")).toBe(false);
  });
});

describe("M4-15 POST /api/cron/verify-domains", () => {
  const OLD = "00000000-0000-4000-8000-0000000000a9";

  it("a missing or wrong secret is a 401 and changes nothing", async () => {
    current = harness({ domains: [domainRow({ id: OLD, hostname: "x.example.test", page_id: IDS.proPage })] });
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: SECRET },
      { authorization: "Basic abc" },
    ];
    for (const headers of attempts) {
      const res = await post(headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(current.vercel.calls).toEqual([]);
    expect(current.admin.state.rpcLog).toEqual([]);
  });

  it("a secret in the query string is ignored: 401", async () => {
    const res = await post({}, `http://app.localhost:3000/api/cron/verify-domains?secret=${SECRET}&authorization=${SECRET}`);
    expect(res.status).toBe(401);
    expect(current.vercel.calls).toEqual([]);
  });

  it("the right secret runs the sweep and answers {checked, verified}", async () => {
    current = harness({ domains: [domainRow({ id: OLD, hostname: "x.example.test", page_id: IDS.proPage })] });
    current.vercel.state("x.example.test").verified = true;
    current.vercel.state("x.example.test").misconfigured = false;
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 1, verified: 1 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("only POST is exported (GET and the rest are 405 by Next), and the secret is never in a body or a log", async () => {
    expect(Object.keys(sweepRoute).filter((k) => /^(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual([]);

    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(JSON.stringify(args)));
    current.admin.client.from = () => {
      throw new Error(`database exploded with ${SECRET}`);
    };
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRET);
    expect(logged.join("\n")).not.toContain(SECRET);
    vi.restoreAllMocks();
  });
});

describe("M4-15 GET /api/domains/[id]", () => {
  const ID = "00000000-0000-4000-8000-0000000000a1";
  const get = (id: string) =>
    pollRoute.GET(new NextRequest(`http://app.localhost:3000/api/domains/${id}`), { params: Promise.resolve({ id }) });

  it("401 when nobody is signed in, and nothing is read", async () => {
    sessionUser.mockResolvedValue(null);
    current = harness({ domains: [domainRow({ id: ID, hostname: "links.example.test", page_id: IDS.proPage })] });
    const res = await get(ID);
    expect(res.status).toBe(401);
    expect(current.vercel.calls).toEqual([]);
  });

  it("404 for another account's domain, with no Vercel call", async () => {
    sessionUser.mockResolvedValue({ id: IDS.other, email: "o@example.test" });
    current = harness({ domains: [domainRow({ id: ID, hostname: "links.example.test", page_id: IDS.proPage })] });
    const res = await get(ID);
    expect(res.status).toBe(404);
    expect(current.vercel.calls).toEqual([]);
    expect((await get("garbage")).status).toBe(404);
  });

  it("200 with the DomainView for the owner (never cached), and a poll is what notices a domain going live", async () => {
    sessionUser.mockResolvedValue({ id: IDS.pro, email: "p@example.test" });
    current = harness({ domains: [domainRow({ id: ID, hostname: "links.example.test", page_id: IDS.proPage })] });
    let res = await get(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ id: ID, hostname: "links.example.test", status: "pending", records: [{ type: "CNAME" }] });

    current.vercel.state("links.example.test").verified = true;
    current.vercel.state("links.example.test").misconfigured = false;
    current.admin.advance(10_000);
    res = await get(ID);
    expect(await res.json()).toMatchObject({ status: "verified" });
    expect(current.emails).toHaveLength(1);
  });
});
