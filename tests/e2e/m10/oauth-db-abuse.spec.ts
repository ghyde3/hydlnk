import { expect, test } from "@playwright/test";
import { cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import { postgrest, restAs, sessionOf } from "../fixtures/http";
import { publishableKey, supabaseUrl } from "../fixtures/auth";
import { mintGrant, registerClient, removeClients, rows } from "../fixtures/oauth";

/**
 * M10-05: the OAuth tables have no client access at all. With the publishable key, with and without a
 * person's JWT, every verb on every table fails with "permission denied" or reads nothing, so a client
 * cannot read a hash, plant a token row with a hash it chose, widen the scopes of its own grant, extend
 * an expiry or read an activity row. After the attempts the rows are exactly as they were.
 */

const made: string[] = [];
test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

const TABLES = [
  "oauth_clients",
  "oauth_authorization_codes",
  "oauth_grants",
  "oauth_tokens",
  "mcp_activity",
];

/** A request is "closed" when it failed, or when it succeeded and returned nothing. */
function closed(status: number, body: unknown): boolean {
  if (status >= 400) return true;
  return Array.isArray(body) ? body.length === 0 : body === null || body === "";
}

test("M10-05 GET, POST, PATCH and DELETE on every OAuth table, as anon and as the owner, read and change nothing", async ({
  context,
}, info) => {
  test.skip(!desktopOnly(info), "raw HTTP, no UI");
  const me = await signedInUser(context, { label: "dba" });
  const client = await registerClient();
  made.push(client.client_id);
  await mintGrant(context, client.client_id);
  const jwt = (await sessionOf(context)).access_token;

  const before = {
    grants: await rows<{ id: string; scopes: string[] }>("oauth_grants", { user_id: me.userId }),
    tokens: await rows<{
      id: string;
      token_hash: string;
      expires_at: string;
      revoked_at: string | null;
    }>("oauth_tokens", { user_id: me.userId }),
  };
  expect(before.tokens.length).toBe(2);

  for (const table of TABLES) {
    // The table may not exist yet while the MCP side of the wave is unbuilt; PostgREST says 404 then.
    for (const token of [undefined, jwt]) {
      const label = `${table} as ${token ? "owner" : "anon"}`;
      const read = await postgrest(`${table}?select=*`, token);
      expect(closed(read.status, await read.json().catch(() => null)), `GET ${label}`).toBe(true);

      for (const [method, body] of [
        [
          "POST",
          {
            client_id: "hlc_" + "9".repeat(32),
            kind: "dcr",
            client_name: "x",
            redirect_uris: ["https://x.example/cb"],
          },
        ],
        [
          "PATCH",
          {
            scopes: ["hydlnk.read", "hydlnk.write", "hydlnk.publish"],
            expires_at: "2099-01-01T00:00:00Z",
            client_name: "hijacked",
          },
        ],
        ["DELETE", undefined],
      ] as const) {
        const res = await fetch(
          `${supabaseUrl()}/rest/v1/${table}${method === "POST" ? "" : "?id=not.is.null"}`,
          {
            method,
            headers: {
              apikey: publishableKey(),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              "content-type": "application/json",
              Prefer: "return=representation",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        expect(
          closed(res.status, parsed),
          `${method} ${label}: ${res.status} ${text.slice(0, 120)}`,
        ).toBe(true);
      }
    }
  }

  // Nothing moved: the same grant, the same scopes, the same hashes and expiries, and no row planted.
  const after = {
    grants: await rows<{ id: string; scopes: string[] }>("oauth_grants", { user_id: me.userId }),
    tokens: await rows<{
      id: string;
      token_hash: string;
      expires_at: string;
      revoked_at: string | null;
    }>("oauth_tokens", { user_id: me.userId }),
  };
  expect(after.grants).toEqual(before.grants);
  expect(after.tokens).toEqual(before.tokens);
  expect(await rows("oauth_clients", { client_id: "hlc_" + "9".repeat(32) })).toHaveLength(0);

  // A GET with a filter on a hash column reads nothing either.
  const probe = await restAs(
    jwt,
    `/oauth_tokens?token_hash=eq.${before.tokens[0]!.token_hash}&select=id`,
  );
  expect(closed(probe.status, probe.body)).toBe(true);
});
