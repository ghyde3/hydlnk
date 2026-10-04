import { afterEach, describe, expect, it, vi } from "vitest";
import { CONSENT_PER_USER_PER_HOUR } from "@/lib/oauth/consent";
import { sha256Hex } from "@/lib/oauth/tokens";
import {
  DCR_ID,
  ISSUER,
  OTHER,
  REDIRECT,
  USER,
  allow,
  authorizeQuery,
  harness,
  pkce,
  type Harness,
} from "./helpers/oauth-flow";
import { memoryLimiter } from "./helpers/oauth-fake-store";

/**
 * M10-13 and M10-14: the person's answer, and everything a forged post could try. The decision is a
 * plain form post; the server reads the request from the pending row and trusts none of the form
 * but the id, the form secret, the decision and the scope ticks.
 */

afterEach(() => vi.restoreAllMocks());

async function screen(h: Harness, query = authorizeQuery(), user = USER) {
  const result = await h.authorize(query, { user });
  if (result.kind !== "consent") throw new Error(`expected the consent screen, got ${result.kind}`);
  return result.view;
}

const redirectOf = (result: { kind: string; location?: string }): URL => {
  expect(result.kind).toBe("redirect");
  return new URL(result.location!);
};

describe("M10-13 Allow and Deny", () => {
  it("Allow issues a code and answers with code, state and iss", async () => {
    const h = harness();
    const view = await screen(h);
    const url = redirectOf(
      await h.consent({
        request: view.requestId,
        csrf: view.csrf,
        decision: "allow",
        scope: ["hydlnk.write", "hydlnk.publish"],
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("code")).toMatch(/^hl_ac_[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    const row = h.store.requests.get(view.requestId)!;
    expect(row.status).toBe("issued");
    expect(row.scopes_granted).toEqual(["hydlnk.read", "hydlnk.write", "hydlnk.publish"]);
    expect(Date.parse(row.code_expires_at!) - h.store.clock).toBe(60_000);
  });

  it("Deny answers access_denied with state and iss, and issues nothing", async () => {
    const h = harness();
    const view = await screen(h);
    const url = redirectOf(
      await h.consent({ request: view.requestId, csrf: view.csrf, decision: "deny" }),
    );
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    expect(url.searchParams.has("code")).toBe(false);
    const row = h.store.requests.get(view.requestId)!;
    expect(row.status).toBe("denied");
    expect(row.code_hash).toBeNull();
    expect(h.store.grants).toHaveLength(0);
  });

  it.each([
    [
      "write and publish ticked",
      ["hydlnk.write", "hydlnk.publish"],
      ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
    ],
    ["publish unticked", ["hydlnk.write"], ["hydlnk.read", "hydlnk.write"]],
    ["both unticked", [], ["hydlnk.read"]],
    ["write unticked, publish ticked", ["hydlnk.publish"], ["hydlnk.read", "hydlnk.publish"]],
  ])("scope downgrade: %s", async (_name, ticks, granted) => {
    const h = harness();
    const view = await screen(h);
    await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow", scope: ticks });
    expect(h.store.requests.get(view.requestId)!.scopes_granted).toEqual(granted);
    expect(h.store.grants[0]!.scopes).toEqual(granted);
  });

  it("a read-only request shows only the always-on line and grants read", async () => {
    const h = harness();
    const view = await screen(h, authorizeQuery({ scope: "hydlnk.read" }));
    expect(view.scopes).toEqual(["hydlnk.read"]);
    await h.consent({
      request: view.requestId,
      csrf: view.csrf,
      decision: "allow",
      scope: ["hydlnk.publish"],
    });
    expect(h.store.grants[0]!.scopes).toEqual(["hydlnk.read"]);
  });

  it("the same screen for every plan: nothing about a plan is asked or shown", async () => {
    const h = harness();
    const view = await screen(h);
    expect(Object.keys(view).join(" ")).not.toMatch(/plan/i);
  });
});

describe("M10-14 CSRF", () => {
  async function post(
    h: Harness,
    over: Parameters<Harness["consent"]>[1],
    fields?: Record<string, string | string[] | undefined>,
  ) {
    const view = await screen(h);
    return {
      view,
      result: await h.consent(
        fields ?? {
          request: view.requestId,
          csrf: view.csrf,
          decision: "allow",
          scope: ["hydlnk.write"],
        },
        over,
      ),
    };
  }
  const noCode = (h: Harness) =>
    [...h.store.requests.values()].every((row) => row.code_hash === null);

  it("a post with the right fields from another origin is a 403 and issues no code", async () => {
    const h = harness();
    const { result } = await post(h, { origin: "https://evil.example" });
    expect(result).toEqual({
      kind: "message",
      status: 403,
      message: "forbidden",
      clearResume: false,
    });
    expect(noCode(h)).toBe(true);
  });

  it.each([
    "http://app.localhost:3000.evil.example",
    "http://app.localhost:3001",
    "https://app.localhost:3000",
    "http://APP.localhost:3000",
  ])("an Origin of %j is refused", async (origin) => {
    const h = harness();
    const { result } = await post(h, { origin });
    expect(result).toMatchObject({ kind: "message", status: 403 });
    expect(noCode(h)).toBe(true);
  });

  it("no Origin, or the literal null, and a Sec-Fetch-Site other than same-origin is refused; same-origin is accepted", async () => {
    // A form post under Referrer-Policy: no-referrer carries Origin: null even to its own origin, so
    // null is judged by the fetch metadata, never by the Origin.
    for (const origin of [null, "null"]) {
      for (const site of [null, "cross-site", "same-site", "none"]) {
        const h = harness();
        const { result } = await post(h, { origin, secFetchSite: site });
        expect(result, `${origin} / ${site}`).toMatchObject({ kind: "message", status: 403 });
        expect(noCode(h)).toBe(true);
      }
      const h = harness();
      const { result } = await post(h, { origin, secFetchSite: "same-origin" });
      expect(result.kind, String(origin)).toBe("redirect");
    }
  });

  it("a wrong Origin is refused even when the fetch metadata says same-origin", async () => {
    const h = harness();
    const { result } = await post(h, {
      origin: "https://evil.example",
      secFetchSite: "same-origin",
    });
    expect(result).toMatchObject({ kind: "message", status: 403 });
    expect(noCode(h)).toBe(true);
  });

  it("a missing, wrong or other person's form secret is a 403 'This request expired' and issues no code", async () => {
    const h = harness();
    const view = await screen(h);
    for (const csrf of [undefined, "", "wrong", `${view.csrf}x`, view.csrf.toUpperCase()]) {
      const result = await h.consent({ request: view.requestId, csrf, decision: "allow" });
      expect(result).toMatchObject({ kind: "message", status: 403, message: "forbidden" });
    }
    // The other person's page has a secret of its own, bound to its own request.
    const other = await screen(h, authorizeQuery(), OTHER);
    const crossed = await h.consent({
      request: view.requestId,
      csrf: other.csrf,
      decision: "allow",
    });
    expect(crossed).toMatchObject({ kind: "message", status: 403 });
    expect(noCode(h)).toBe(true);
    // And the right one still works afterwards: the refusals did not use up the request.
    expect(
      (await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" })).kind,
    ).toBe("redirect");
  });

  it("a signed-out post is sent to sign in and changes nothing", async () => {
    const h = harness();
    const view = await screen(h);
    expect(
      await h.consent(
        { request: view.requestId, csrf: view.csrf, decision: "allow" },
        { user: null },
      ),
    ).toEqual({ kind: "login" });
    expect(noCode(h)).toBe(true);
  });

  it("a form secret is accepted once and only from the page that was drawn last", async () => {
    const h = harness();
    const first = await screen(h);
    const query = authorizeQuery();
    void query;
    // Draw the same request again (a reload): bindRequest replaces the stored hash.
    const rebound = await h.store.bindRequest(first.requestId, USER.id, sha256Hex("second-render"));
    expect(rebound).not.toBeNull();
    expect(
      await h.consent({ request: first.requestId, csrf: first.csrf, decision: "allow" }),
    ).toMatchObject({ status: 403 });
    expect(
      (await h.consent({ request: first.requestId, csrf: "second-render", decision: "allow" }))
        .kind,
    ).toBe("redirect");
  });

  it("malformed fields are refused: a repeated secret, a non-id request, an unknown decision", async () => {
    const h = harness();
    const view = await screen(h);
    expect(
      await h.consent({ request: view.requestId, csrf: [view.csrf, view.csrf], decision: "allow" }),
    ).toMatchObject({ status: 403 });
    expect(
      await h.consent({ request: "not-an-id", csrf: view.csrf, decision: "allow" }),
    ).toMatchObject({ status: 403 });
    expect(
      await h.consent({ request: view.requestId, csrf: view.csrf, decision: "maybe" }),
    ).toMatchObject({ status: 403 });
    expect(await h.consent({ csrf: view.csrf, decision: "allow" })).toMatchObject({ status: 403 });
    expect(noCode(h)).toBe(true);
  });
});

describe("M10-14 binding, replay and expiry", () => {
  it("the request belongs to the first signed-in person who renders it", async () => {
    const h = harness();
    const view = await screen(h);
    const stolen = await h.authorize("", { user: OTHER, resumeId: view.requestId });
    expect(stolen).toEqual({ kind: "message", status: 403, message: "someone_else" });
    const forged = await h.consent(
      { request: view.requestId, csrf: view.csrf, decision: "allow" },
      { user: OTHER },
    );
    expect(forged).toMatchObject({ kind: "message", status: 403, message: "someone_else" });
    expect(h.store.requests.get(view.requestId)!.status).toBe("pending");
    expect(h.store.grants).toHaveLength(0);
  });

  it("an answered request cannot be answered again, and no second code is made", async () => {
    const h = harness();
    const view = await screen(h);
    expect(
      (await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" })).kind,
    ).toBe("redirect");
    const again = await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" });
    expect(again).toMatchObject({ kind: "message", status: 400, message: "answered" });
    expect([...h.store.requests.values()].filter((r) => r.code_hash !== null)).toHaveLength(1);
  });

  it("two simultaneous Allow posts issue exactly one code", async () => {
    const h = harness();
    const view = await screen(h);
    const post = () =>
      h.consent({
        request: view.requestId,
        csrf: view.csrf,
        decision: "allow",
        scope: ["hydlnk.write"],
      });
    const results = await Promise.all([post(), post(), post()]);
    expect(results.filter((r) => r.kind === "redirect")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "message")).toHaveLength(2);
    expect(h.store.grants).toHaveLength(1);
    expect([...h.store.requests.values()].filter((r) => r.code_hash !== null)).toHaveLength(1);
  });

  it("a request older than ten minutes shows 'expired' and issues nothing", async () => {
    const h = harness();
    const view = await screen(h);
    h.store.advance(601);
    const result = await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" });
    expect(result).toMatchObject({ kind: "message", status: 400, message: "expired" });
    expect(h.store.requests.get(view.requestId)!.code_hash).toBeNull();
  });

  it("an unknown request id is the same refusal as a wrong secret", async () => {
    const h = harness();
    const view = await screen(h);
    const result = await h.consent({
      request: "00000000-0000-4000-8000-00000000beef",
      csrf: view.csrf,
      decision: "allow",
    });
    expect(result).toMatchObject({ kind: "message", status: 403, message: "forbidden" });
  });
});

describe("M10-14 tampering", () => {
  it("fields a forged form adds are ignored: the server reads the pending row", async () => {
    const h = harness();
    const view = await screen(h);
    const result = await h.consent({
      request: view.requestId,
      csrf: view.csrf,
      decision: "allow",
      scope: ["hydlnk.write"],
      redirect_uri: "https://evil.example/cb",
      client_id: "hlc_" + "9".repeat(32),
      state: "forged",
      code_challenge: pkce().challenge,
      resource: "https://evil.example/mcp",
    });
    const url = redirectOf(result);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("state-1");
    const row = h.store.requests.get(view.requestId)!;
    expect(row.client_id).toBe(DCR_ID);
    expect(row.resource).toBe("http://app.localhost:3000/mcp");
  });

  it("a scope the app never asked for is dropped, read is always included, and an unknown scope is ignored", async () => {
    const h = harness();
    const view = await screen(h, authorizeQuery({ scope: "hydlnk.read" }));
    await h.consent({
      request: view.requestId,
      csrf: view.csrf,
      decision: "allow",
      scope: ["hydlnk.publish", "hydlnk.write", "hydlnk.root", "everything"],
    });
    expect(h.store.requests.get(view.requestId)!.scopes_granted).toEqual(["hydlnk.read"]);
    const h2 = harness();
    const v2 = await screen(h2);
    await h2.consent({
      request: v2.requestId,
      csrf: v2.csrf,
      decision: "allow",
      scope: ["nonsense"],
    });
    expect(h2.store.requests.get(v2.requestId)!.scopes_granted).toEqual(["hydlnk.read"]);
  });

  it("the stored redirect is checked again against the client's current row", async () => {
    const h = harness();
    const view = await screen(h);
    h.store.clients.get(DCR_ID)!.redirect_uris = ["https://changed.example/cb"];
    const result = await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" });
    expect(result).toMatchObject({ kind: "message", status: 403, message: "app_changed" });
    expect(h.store.requests.get(view.requestId)!.code_hash).toBeNull();
    // A client that is gone is the same refusal.
    h.store.clients.delete(DCR_ID);
    expect(
      await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" }),
    ).toMatchObject({ message: "app_changed" });
  });

  it("the code travels only in the Location: a canary code is found there and nowhere else", async () => {
    const h = harness();
    const view = await screen(h);
    const canary = `hl_ac_${"Z".repeat(43)}`;
    h.consentDeps.newCode = () => canary;
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const result = await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" });
    expect(redirectOf(result).searchParams.get("code")).toBe(canary);
    expect(JSON.stringify([...h.store.requests.values()])).not.toContain(canary);
    expect(JSON.stringify(h.store.grants)).not.toContain(canary);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(canary);
    expect(h.store.requests.get(view.requestId)!.code_hash).toBe(sha256Hex(canary));
  });
});

describe("M10-12 / M10-13 suspended accounts, the 20-app limit, the rate limit", () => {
  it("a suspended account sees a screen with Deny only, and a forged Allow is access_denied with no code", async () => {
    const h = harness();
    h.store.suspended.add(USER.id);
    const view = await screen(h);
    expect(view.suspended).toBe(true);
    const url = redirectOf(
      await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" }),
    );
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.has("code")).toBe(false);
    expect([...h.store.requests.values()].every((row) => row.code_hash === null)).toBe(true);
    expect(h.store.grants).toHaveLength(0);
  });

  it("at 20 active grants Allow is refused with the grant-limit page, and the request survives", async () => {
    const h = harness();
    for (let i = 0; i < 20; i += 1) {
      const clientId = `hlc_${String(i).padStart(32, "0")}`;
      h.store.addClient(clientId, [REDIRECT]);
      h.store.grants.push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "1")}`,
        userId: USER.id,
        clientId,
        scopes: ["hydlnk.read"],
        authorizedAt: h.store.clock,
        createdAt: h.store.clock,
        lastUsedAt: null,
        revokedAt: null,
      });
    }
    const view = await screen(h);
    const result = await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" });
    expect(result).toMatchObject({ kind: "message", status: 409, message: "grant_limit" });
    expect(h.store.requests.get(view.requestId)!.status).toBe("pending");
    // Freeing a slot lets the same page answer.
    h.store.grants[0]!.revokedAt = h.store.clock;
    expect(
      (await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" })).kind,
    ).toBe("redirect");
  });

  it("a re-consent for a grant that is still active is allowed at 20, and replaces what it can do", async () => {
    const h = harness();
    await allow(h, { scopes: ["hydlnk.write", "hydlnk.publish"] });
    for (let i = 0; i < 19; i += 1) {
      h.store.grants.push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "2")}`,
        userId: USER.id,
        clientId: `hlc_${String(i + 100).padStart(32, "0")}`,
        scopes: ["hydlnk.read"],
        authorizedAt: h.store.clock,
        createdAt: h.store.clock,
        lastUsedAt: null,
        revokedAt: null,
      });
    }
    const view = await screen(h);
    expect(view.previous).toEqual(["hydlnk.read", "hydlnk.write", "hydlnk.publish"]);
    const result = await h.consent({
      request: view.requestId,
      csrf: view.csrf,
      decision: "allow",
      scope: ["hydlnk.write"],
    });
    expect(result.kind).toBe("redirect");
    expect(h.store.grants.find((g) => g.clientId === DCR_ID)!.scopes).toEqual([
      "hydlnk.read",
      "hydlnk.write",
    ]);
  });

  it("decisions are limited per person: 30 an hour, then 'Too many tries'", async () => {
    const base = harness();
    const h = harness({ limit: memoryLimiter(() => base.store.clock) });
    const view = await screen(h);
    let last;
    for (let i = 0; i < CONSENT_PER_USER_PER_HOUR; i += 1) {
      last = await h.consent({ request: view.requestId, csrf: "wrong", decision: "allow" });
      expect(last).toMatchObject({ status: 403 });
    }
    last = await h.consent({ request: view.requestId, csrf: view.csrf, decision: "allow" });
    expect(last).toEqual({
      kind: "message",
      status: 429,
      message: "rate_limited",
      clearResume: false,
    });
  });

  it("a person who has connected the app before sees what is allowed now, and a new consent ends the earlier tokens that hold more than it allows", async () => {
    const h = harness();
    const first = await allow(h, { scopes: ["hydlnk.write", "hydlnk.publish"] });
    expect(first.view.previous).toBeNull();
    // A token minted for the first consent (a stand-in row).
    const grant = h.store.grants[0]!;
    h.store.tokens.push({
      id: "t1",
      grantId: grant.id,
      familyId: "f1",
      userId: USER.id,
      kind: "access",
      hash: "h".repeat(64),
      scopes: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
      resource: "r",
      expiresAt: h.store.clock + 3600_000,
      createdAt: h.store.clock,
      lastUsedAt: null,
      rotatedAt: null,
      revokedAt: null,
    });
    const view = await screen(h);
    expect(view.previous).toEqual(["hydlnk.read", "hydlnk.write", "hydlnk.publish"]);
    await h.consent({
      request: view.requestId,
      csrf: view.csrf,
      decision: "allow",
      scope: ["hydlnk.write"],
    });
    expect(h.store.tokens[0]!.revokedAt).not.toBeNull();
    expect(h.store.grants).toHaveLength(1);
    expect(h.store.grants[0]!.scopes).toEqual(["hydlnk.read", "hydlnk.write"]);
  });
});
