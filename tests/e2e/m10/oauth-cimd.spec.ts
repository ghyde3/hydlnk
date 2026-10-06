import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand, signedInUser } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import {
  authorizeUrl,
  authorizeRaw,
  dcrHeading,
  ownAddress,
  pkcePair,
  removeClients,
  rows,
} from "../fixtures/oauth";

/**
 * M10-07 and M10-08 end to end: one Client ID Metadata Document pass against the stand-in website
 * (tests/e2e/fixtures/cimd-stub-server.ts). The server may fetch the stub's address, `http` on
 * loopback, only while the test hooks are on (`testHooksEnabled()`: the CI production build and a
 * preview deployment). The shared local dev server runs with them off, so these specs probe the hook
 * and SKIP there; they run in CI. The fetch rules themselves (addresses, resolution, redirects, size,
 * deadline) are proved with no network in tests/unit/m10-oauth-safe-fetch*.test.ts.
 */

const STUB = "http://127.0.0.1:12113";
const made: string[] = [];

test.afterAll(async () => {
  await removeClients(made);
  await cleanupUsers();
});

async function hooksOn(): Promise<boolean> {
  try {
    return (await rawRequest("mara.localhost:3000", "/hl-query-count")).status === 200;
  } catch {
    return false;
  }
}

async function stubUp(): Promise<boolean> {
  try {
    return (await fetch(`${STUB}/__stub/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function setStub(entry: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${STUB}/__stub/set`, { method: "POST", body: JSON.stringify(entry) });
  if (!res.ok) throw new Error(`stub set failed: ${res.status}`);
}

interface Hit {
  method: string;
  accept: string | null;
  acceptEncoding: string | null;
  userAgent: string | null;
  hasCookie: boolean;
  hasAuthorization: boolean;
}

async function hits(path: string): Promise<Hit[]> {
  return (await (
    await fetch(`${STUB}/__stub/hits?path=${encodeURIComponent(path)}`)
  ).json()) as Hit[];
}

function document(path: string, over: Record<string, unknown> = {}) {
  const clientId = `${STUB}${path}`;
  made.push(clientId);
  return {
    clientId,
    json: {
      client_id: clientId,
      client_name: "Zq Stub App",
      redirect_uris: ["https://a.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...over,
    },
  };
}

test.beforeEach(async ({ context }, info) => {
  // Its own address: the authorize and metadata-fetch limits count per address, and a busy run (or a
  // repeat within a minute) would otherwise see the "Too many requests" page that the limit is meant to show.
  await ownAddress(context);
  test.skip(!desktopOnly(info), "one viewport is enough for the fetch path");
  test.skip(
    !(await hooksOn()),
    "the test hooks are off on this server (HYDLNK_QUERY_COUNTER is not 1): CI runs this",
  );
  test.skip(!(await stubUp()), "the client-metadata stub is not running");
});

test("M10-08 a valid document is fetched once with the headers of the policy, shown, cached, and not fetched again inside its lifetime", async ({
  page,
  context,
}) => {
  await signedInUser(context, { label: "cm1" });
  const path = `/cimd/${rand(8)}.json`;
  const { clientId, json } = document(path);
  await setStub({ path, json, headers: { "cache-control": "max-age=600" } });

  await page.goto(authorizeUrl(clientId, pkcePair().challenge));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(dcrHeading("Zq Stub App"));
  await expect(page.locator("ul.facts li").first()).toHaveText("Address: 127.0.0.1:12113");

  const first = await hits(path);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({
    method: "GET",
    accept: "application/json",
    acceptEncoding: "identity",
    userAgent: "HYDLNK-OAuth/1",
    hasCookie: false,
    hasAuthorization: false,
  });

  const row = (
    await rows<{ kind: string; fetched_at: string; expires_at: string }>("oauth_clients", {
      client_id: clientId,
    })
  )[0]!;
  expect(row.kind).toBe("cimd");
  expect(Date.parse(row.expires_at) - Date.parse(row.fetched_at)).toBe(600_000);

  await page.goto(authorizeUrl(clientId, pkcePair().challenge));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zq Stub App");
  expect(await hits(path)).toHaveLength(1);
});

test("M10-09 a metadata client's logo is fetched by the server, re-encoded to a 96x96 PNG and embedded as a data URI, and the browser fetches nothing for it", async ({
  page,
  context,
}) => {
  await signedInUser(context, { label: "cm-logo" });
  const id = rand(8);
  const path = `/cimd/${id}.json`;
  const logoPath = `/cimd/${id}-logo.png`;
  const source = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  const { clientId, json } = document(path, { logo_uri: `${STUB}${logoPath}` });
  await setStub({ path, json });
  await setStub({
    path: logoPath,
    base64: source.toString("base64"),
    headers: { "content-type": "image/png" },
  });

  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto(authorizeUrl(clientId, pkcePair().challenge));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zq Stub App");
  await expect(page.locator(".avatar img")).toHaveAttribute("src", /^data:image\/png;base64,/);

  // The server asked for the logo, once, with the policy's headers; the browser never did.
  const logoHits = await hits(logoPath);
  expect(logoHits).toHaveLength(1);
  expect(logoHits[0]).toMatchObject({
    method: "GET",
    acceptEncoding: "identity",
    userAgent: "HYDLNK-OAuth/1",
    hasCookie: false,
    hasAuthorization: false,
  });
  expect(requested.filter((address) => address.startsWith(STUB))).toEqual([]);

  // What is stored is not the source: a 96x96 PNG of at most 20,480 bytes.
  const row = (await rows<{ logo_png: string }>("oauth_clients", { client_id: clientId }))[0]!;
  const stored = Buffer.from(row.logo_png.replace(/^\\x/, ""), "hex");
  const meta = await sharp(stored).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["png", 96, 96]);
  expect(stored.length).toBeLessThanOrEqual(20_480);
  expect(stored.equals(source)).toBe(false);
});

test("M10-08 an invalid document is never stored or reused: the page says it could not verify the app, and the next request fetches again", async ({
  page,
  context,
}) => {
  await signedInUser(context, { label: "cm2" });
  const path = `/cimd/${rand(8)}.json`;
  const { clientId, json } = document(path);
  await setStub({ path, json: { ...json, client_id: `${clientId}-other` } });
  const url = authorizeUrl(clientId, pkcePair().challenge);

  await page.goto(url);
  await expect(page.locator("body")).toContainText("We couldn’t verify this app.");
  expect(await rows("oauth_clients", { client_id: clientId })).toHaveLength(0);
  expect(await hits(path)).toHaveLength(1);

  await setStub({ path, json });
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zq Stub App");
  expect(await hits(path)).toHaveLength(2);
});

test("M10-07 a redirect, a wrong content type, an oversized body and a name posing as HYDLNK are each refused", async ({
  page,
  context,
}) => {
  await signedInUser(context, { label: "cm3" });
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "a redirect",
      { status: 302, headers: { location: "http://127.0.0.1:1/elsewhere" }, text: "" },
    ],
    ["html", { headers: { "content-type": "text/html" }, text: "<html></html>" }],
    ["a body over 5 KB", { json: { pad: "x".repeat(6000) } }],
  ];
  for (const [name, entry] of cases) {
    const path = `/cimd/${rand(8)}.json`;
    const { clientId } = document(path);
    await setStub({ path, ...entry });
    await page.goto(authorizeUrl(clientId, pkcePair().challenge));
    await expect(page.locator("body"), name).toContainText("We couldn’t verify this app.");
    expect(await rows("oauth_clients", { client_id: clientId }), name).toHaveLength(0);
  }
  const path = `/cimd/${rand(8)}.json`;
  const { clientId, json } = document(path, { client_name: "HYDLNK Support" });
  await setStub({ path, json });
  await page.goto(authorizeUrl(clientId, pkcePair().challenge));
  await expect(page.locator("body")).toContainText("We couldn’t verify this app.");
});

test("M10-08 a document that drops a redirect address stops accepting it once its cache expires", async ({
  page,
  context,
}) => {
  await signedInUser(context, { label: "cm4" });
  const path = `/cimd/${rand(8)}.json`;
  const { clientId, json } = document(path, {
    redirect_uris: ["https://a.example/cb", "https://b.example/cb"],
  });
  await setStub({ path, json });
  const pair = pkcePair();
  const toB = authorizeUrl(clientId, pair.challenge, { redirectUri: "https://b.example/cb" });
  await page.goto(toB);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zq Stub App");

  await setStub({
    path,
    json: { ...json, redirect_uris: ["https://a.example/cb"], client_name: "Zq Renamed" },
  });
  // Inside the lifetime the stored row still holds both; after it, the next request refetches.
  await adminClient()
    .from("oauth_clients")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("client_id", clientId);
  const refused = await authorizeRaw(clientId, pair.challenge, {
    redirectUri: "https://b.example/cb",
  });
  expect(refused.status).toBe(400);
  expect(refused.body).toContain("This app’s return address isn’t allowed.");
  await page.goto(authorizeUrl(clientId, pkcePair().challenge));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(dcrHeading("Zq Renamed"));
});
