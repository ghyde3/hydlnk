import { expect, test } from "@playwright/test";
import { url } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, insertPage, makeUser, rand } from "../fixtures/data";
import { postgrest, rawRequest } from "../fixtures/http";

/**
 * M1-02: GET /api/handles/check on the app host. API-level, so only the desktop project runs it
 * (the phone project would repeat the same requests).
 */
test.describe("M1-02 handle availability endpoint", () => {
  test.skip(({ isMobile }) => isMobile, "API-level checks run once, in the desktop project");
  test.afterAll(cleanupUsers);

  const check = async (query: string) => {
    const res = await rawRequest("app.localhost:3000", `/api/handles/check${query}`);
    return { ...res, json: JSON.parse(res.body) as { handle: string; status: string } };
  };

  test("M1-02 the seeded tenant mara is taken", async () => {
    const res = await check("?handle=mara");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ handle: "mara", status: "taken" });
  });

  test("M1-02 reserved handles come back reserved, normalized first, from the table", async () => {
    for (const [query, handle] of [
      ["www", "www"],
      ["app", "app"],
      ["api", "api"],
      ["ADMIN", "admin"],
    ] as const) {
      const res = await check(`?handle=${query}`);
      expect(res.json, query).toEqual({ handle, status: "reserved" });
    }

    // From the table, not a hard-coded list: every valid-length row of reserved_handles (a
    // service_role can read it, nothing can write it) comes back reserved.
    const { data, error } = await adminClient().from("reserved_handles").select("handle");
    expect(error).toBeNull();
    const rows = (data ?? [])
      .map((row) => row.handle as string)
      .filter((h) => /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(h));
    expect(rows.length).toBeGreaterThan(50);
    for (const handle of rows.slice(0, 40)) {
      expect((await check(`?handle=${handle}`)).json, handle).toEqual({
        handle,
        status: "reserved",
      });
    }
  });

  test("M1-02 short, too long, invalid and available, in that precedence", async () => {
    expect((await check("?handle=ab")).json.status).toBe("short");
    expect((await check("?handle=")).json).toEqual({ handle: "", status: "short" });
    expect((await check("")).json).toEqual({ handle: "", status: "short" });
    expect((await check(`?handle=${"a".repeat(31)}`)).json.status).toBe("too_long");
    expect((await check("?handle=-mara")).json.status).toBe("invalid");
    expect((await check("?handle=xn--pple-43d")).json.status).toBe("invalid");
    expect((await check("?handle=zq-avail-1")).json).toEqual({
      handle: "zq-avail-1",
      status: "available",
    });
    // Precedence: "ab" is short even though... it is also a prefix of nothing reserved; "a-" is
    // short before invalid; a 31 char dash-led value is too_long before invalid.
    expect((await check("?handle=a-")).json.status).toBe("short");
    expect((await check(`?handle=-${"a".repeat(30)}`)).json.status).toBe("too_long");
    // reserved beats taken is not observable (reserved handles can never be pages), but a handle
    // that fails the rules never reaches the database lookups.
    expect((await check("?handle=Mara_Studio!")).json.handle).toBe("marastudio");
  });

  test("M1-02 live data: inserting a page makes the handle taken, deleting frees it", async () => {
    const handle = `zq-avail-${rand()}`;
    const owner = await makeUser("avail");
    expect((await check(`?handle=${handle}`)).json.status).toBe("available");
    await insertPage(owner.id, handle);
    expect((await check(`?handle=${handle}`)).json.status).toBe("taken");
    expect((await adminClient().from("pages").delete().eq("handle", handle)).error).toBeNull();
    expect((await check(`?handle=${handle}`)).json.status).toBe("available");
  });

  test("M1-02 response shape: only handle and status, no-store, POST is 405", async () => {
    const res = await check("?handle=mara");
    expect(Object.keys(res.json).sort()).toEqual(["handle", "status"]);
    expect(res.headers["cache-control"]).toMatch(/no-store/);

    for (const method of ["POST", "PUT", "DELETE"]) {
      const bad = await rawRequest("app.localhost:3000", "/api/handles/check?handle=zz", {
        method,
      });
      expect(bad.status, method).toBe(405);
    }
  });

  test("M1-02 abuse: PostgREST with the publishable key leaks neither reserved handles nor pages", async () => {
    // reserved_handles: no JWT, then a signed-in user. 401/403 or an empty array, never data.
    const noJwt = await postgrest("reserved_handles?select=*");
    if (noJwt.ok) expect(await noJwt.json()).toEqual([]);
    else expect([401, 403]).toContain(noJwt.status);

    const user = await makeUser("abuse");
    const token = await accessTokenFor(user.email);
    const asUser = await postgrest("reserved_handles?select=*", token);
    if (asUser.ok) expect(await asUser.json()).toEqual([]);
    else expect([401, 403]).toContain(asUser.status);

    // pages: nothing without a JWT, nothing for a user without a page (mara's row is not exposed).
    const anonPages = await postgrest("pages?select=handle");
    if (anonPages.ok) expect(await anonPages.json()).toEqual([]);
    else expect([401, 403]).toContain(anonPages.status);

    const userPages = await postgrest("pages?select=handle", token);
    expect(userPages.ok).toBe(true);
    expect(await userPages.json()).toEqual([]);
  });

  test("M1-02 host scoping: tenant and root hosts do not serve the endpoint", async () => {
    for (const host of ["mara.localhost:3000", "localhost:3000"]) {
      const res = await rawRequest(host, "/api/handles/check?handle=zz");
      expect(res.status, host).toBe(404);
    }
  });

  test("M1-02 the endpoint answers in the browser too (same origin as the signup form)", async ({
    page,
  }) => {
    const response = await page.goto(url("app", "/api/handles/check?handle=zq-browser-1"));
    expect(response?.status()).toBe(200);
    expect(await response?.json()).toEqual({ handle: "zq-browser-1", status: "available" });
  });
});
