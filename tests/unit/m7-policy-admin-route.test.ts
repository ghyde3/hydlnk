import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/admin/principal";
import type { AdminAction } from "@/lib/admin/types";

/**
 * M7-12: `adminRoute` is the one Route Handler factory behind every admin mutation. This drives it
 * the way the new block and remove routes use it: nobody gets past it unless they are an admin on the
 * app origin with a JSON object, and what the action receives is the body with the path segments on
 * top, so the domain of a removal can only come from the path.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

let principal: Principal = { kind: "anonymous" };
const getPrincipal = vi.fn(async () => principal);
vi.mock("@/lib/admin/auth", () => ({ getPrincipal: () => getPrincipal() }));

const createAdminDeps = vi.fn(() => ({ db: {} }) as never);
vi.mock("@/lib/admin/deps", () => ({ createAdminDeps: () => createAdminDeps() }));

const { adminRoute } = await import("@/lib/admin/route");

const ADMIN: Principal = { kind: "user", id: "a1", email: "a@x.test", admin: true };
const NON_ADMIN: Principal = { kind: "user", id: "b1", email: "b@x.test", admin: false };
const APP = "http://app.localhost:3000";

const received: unknown[] = [];
const action: AdminAction = {
  name: "fake",
  async run(_context, rawInput) {
    received.push(rawInput);
    return { ok: true, status: 200, data: { changed: true } };
  },
};
const POST = adminRoute(action);

function call(
  init: { origin?: string | null; contentType?: string | null; body?: string } = {},
  params: Record<string, string> = {},
) {
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers.origin = init.origin ?? APP;
  if (init.contentType !== null) headers["content-type"] = init.contentType ?? "application/json";
  const request = new NextRequest(`${APP}/api/admin/blocked-links`, {
    method: "POST",
    headers,
    body: init.body ?? "{}",
  });
  return POST(request, { params: Promise.resolve(params) });
}

beforeEach(() => {
  principal = ADMIN;
  received.length = 0;
  getPrincipal.mockClear();
  createAdminDeps.mockClear();
});

describe("M7-12 adminRoute refuses before it reads or builds anything", () => {
  it("a cross-origin Origin is 403 forbidden_origin, before the session is even read", async () => {
    for (const origin of [
      "http://evil.example",
      "http://localhost:3000",
      "http://mara.localhost:3000",
      "null",
    ]) {
      const response = await call({ origin });
      expect(response.status, origin).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden_origin" });
    }
    expect(getPrincipal).not.toHaveBeenCalled();
    expect(createAdminDeps).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it("nobody signed in is 401 and a signed-in non-admin 403, with no database client built", async () => {
    principal = { kind: "anonymous" };
    const anonymous = await call({ body: '{"domain":"example.test","reason":"x"}' });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error).toBe("unauthenticated");

    principal = NON_ADMIN;
    const forbidden = await call({ body: '{"domain":"example.test","reason":"x"}' });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toBe("forbidden");

    // Whatever the body is: the answer does not depend on it, so a refused caller learns nothing.
    for (const body of ["not json", "[]", "null"]) {
      expect((await call({ body })).status, body).toBe(403);
    }
    expect(createAdminDeps).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it("an admin's body that is not JSON is 415, and one that is not an object is 400", async () => {
    for (const contentType of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "application/jsonp",
      null,
    ]) {
      const response = await call({ contentType, body: '{"domain":"example.test"}' });
      expect(response.status, String(contentType)).toBe(415);
      expect(await response.json()).toEqual({ error: "expected_json" });
    }
    for (const body of ["not json", "[]", "null", '"text"', "5", "true", "{"]) {
      const response = await call({ body });
      expect(response.status, body).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
    expect(createAdminDeps).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it("accepts application/json with a charset, and answers no-store", async () => {
    const response = await call({ contentType: "Application/JSON; charset=utf-8" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, changed: true });
  });
});

describe("M7-12 what the action receives", () => {
  it("is the parsed body (block_domain reads {domain, reason} from it)", async () => {
    await call({ body: '{"domain":"example.test","reason":"spam"}' });
    expect(received).toEqual([{ domain: "example.test", reason: "spam" }]);
  });

  it("puts the path segments on top: a body field cannot override the id or the domain in the path", async () => {
    await call(
      { body: '{"domain":"evil.test","id":"00000000-0000-4000-8000-000000000000","x":1}' },
      { domain: "shop.example.test" },
    );
    expect(received).toEqual([
      { domain: "shop.example.test", id: "00000000-0000-4000-8000-000000000000", x: 1 },
    ]);
    received.length = 0;
    await call({ body: '{"id":"from-body"}' }, { id: "from-path" });
    expect(received).toEqual([{ id: "from-path" }]);
  });

  it("a __proto__ key in the body is just a key, never the prototype", async () => {
    await call({ body: '{"__proto__":{"admin":true},"domain":"example.test"}' });
    const input = received[0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});
