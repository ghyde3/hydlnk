import { expect, test } from "@playwright/test";
import { imageRefSchema } from "@/lib/document";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, signedInUser } from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import {
  GIF,
  HTML_AS_PNG,
  SERVER_PORT,
  SVG_AS_PNG,
  makeJpegHeader,
  makePng,
  makePngHeader,
  makeWebpHeader,
  multipart,
  padTo,
  rawBuffer,
  type Part,
} from "./publish-helpers";

/**
 * M2-08: the page-media bucket and the one server-only upload route, POST /api/media on the app
 * host. API-level checks only: raw requests with the session cookie, then the Storage API with a
 * user's token the way curl would.
 */

const MIB = 1024 * 1024;
const BUCKET = "page-media";
const APP_HOST = `app.localhost:${SERVER_PORT}`;

const createdPaths: string[] = [];

test.afterAll(async () => {
  if (createdPaths.length > 0) {
    await adminClient().storage.from(BUCKET).remove(createdPaths.splice(0));
  }
  await cleanupUsers();
});

async function objectNames(userId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(BUCKET).list(userId, { limit: 1000 });
  if (error) throw new Error(`list failed: ${error.message}`);
  return (data ?? []).map((item) => item.name);
}

type Signed = Awaited<ReturnType<typeof signedInUser>>;

async function upload(cookie: string | undefined, parts: Part[], opts: { origin?: string } = {}) {
  const { body, contentType } = multipart(parts);
  return rawBuffer(APP_HOST, "/api/media", {
    method: "POST",
    cookie,
    headers: {
      "content-type": contentType,
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
    body,
  });
}

const filePart = (data: Buffer, filename = "photo.png", contentType = "image/png"): Part => ({
  name: "file",
  file: { filename, contentType, data },
});

async function signedIn(context: Parameters<typeof signedInUser>[0], label: string) {
  const user = await signedInUser(context, { label });
  const cookie = cookieHeader(await authCookies(context));
  return { ...user, cookie };
}

test.describe("M2-08 page-media bucket and upload route", () => {
  test("M2-08 the bucket is public, capped at 4 MiB and limited to JPEG, PNG and WebP", async () => {
    const { data, error } = await adminClient().storage.getBucket(BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(true);
    expect(data?.file_size_limit).toBe(4 * MIB);
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  test("M2-08 an 800x600 PNG is stored under the caller's uid and served from its public URL", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "up");
    const before = await objectNames(user.userId);

    const res = await upload(user.cookie, [
      filePart(makePng(800, 600), "../../../evil name.svg", "image/svg+xml"),
      // Owner and folder fields in the form are ignored: the folder is always the session user.
      { name: "owner_id", value: "00000000-0000-4000-8000-0000000000a1" },
      { name: "path", value: "00000000-0000-4000-8000-0000000000a1/stolen.png" },
      { name: "folder", value: "00000000-0000-4000-8000-0000000000a1" },
    ]);
    expect(res.status, res.text).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(res.text) as {
      path: string;
      width: number;
      height: number;
      url: string;
    };
    createdPaths.push(body.path);

    expect(body.width).toBe(800);
    expect(body.height).toBe(600);
    expect(body.path).toMatch(new RegExp(`^${user.userId}/[0-9a-f-]{36}\\.png$`));
    expect(
      imageRefSchema.safeParse({ path: body.path, width: body.width, height: body.height }).success,
    ).toBe(true);
    expect(body.url).toBe(`${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${body.path}`);

    // The public URL returns the file with its real content type and a one-year cache-control.
    const file = await fetch(body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    const cache = file.headers.get("cache-control") ?? "";
    expect(cache).toMatch(/max-age=31536000/);
    expect(Buffer.from(await file.arrayBuffer()).length).toBeGreaterThan(100);

    expect(await objectNames(user.userId)).toHaveLength(before.length + 1);
    await context.close();
  });

  test("M2-08 JPEG and WebP are stored as jpg and webp with their header size, and kind is validated", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "jw");

    const jpeg = await upload(user.cookie, [
      filePart(makeJpegHeader(640, 480), "x.png", "image/png"), // declared type and name are ignored
      { name: "kind", value: "avatar" },
    ]);
    expect(jpeg.status, jpeg.text).toBe(200);
    const jpegBody = JSON.parse(jpeg.text) as { path: string; width: number; height: number };
    createdPaths.push(jpegBody.path);
    expect(jpegBody.path).toMatch(/\.jpg$/);
    expect([jpegBody.width, jpegBody.height]).toEqual([640, 480]);
    const jpegFile = await fetch(
      `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${jpegBody.path}`,
    );
    expect(jpegFile.headers.get("content-type")).toBe("image/jpeg");

    const webp = await upload(user.cookie, [
      filePart(makeWebpHeader(1024, 768), "x.jpg", "image/jpeg"),
      { name: "kind", value: "background" },
    ]);
    expect(webp.status, webp.text).toBe(200);
    const webpBody = JSON.parse(webp.text) as { path: string; width: number; height: number };
    createdPaths.push(webpBody.path);
    expect(webpBody.path).toMatch(/\.webp$/);
    expect([webpBody.width, webpBody.height]).toEqual([1024, 768]);

    const content = await upload(user.cookie, [
      filePart(makePng(8, 8)),
      { name: "kind", value: "content" },
    ]);
    expect(content.status, content.text).toBe(200);
    createdPaths.push((JSON.parse(content.text) as { path: string }).path);

    const before = await objectNames(user.userId);
    for (const kind of ["banner", "AVATAR", "", "avatar,content"]) {
      const bad = await upload(user.cookie, [
        filePart(makePng(8, 8)),
        { name: "kind", value: kind },
      ]);
      expect(bad.status, `kind=${JSON.stringify(kind)}`).toBe(400);
    }
    expect(await objectNames(user.userId)).toEqual(before);
    await context.close();
  });

  test("M2-08 rejects with a clear error and creates no object", async ({ browser }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "rj");
    const before = await objectNames(user.userId);

    // No session.
    const anon = await upload(undefined, [filePart(makePng(8, 8))]);
    expect(anon.status).toBe(401);
    // A garbage cookie is no session either.
    const forged = await upload("sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0", [
      filePart(makePng(8, 8)),
    ]);
    expect(forged.status).toBe(401);

    // A foreign Origin is refused even with a valid session.
    const foreign = await upload(user.cookie, [filePart(makePng(8, 8))], {
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);

    // The declared type does not matter: SVG and HTML named .png and declared image/png are 415.
    for (const [label, data] of [
      ["svg", SVG_AS_PNG],
      ["html", HTML_AS_PNG],
      ["gif", GIF],
    ] as const) {
      const res = await upload(user.cookie, [filePart(data, "photo.png", "image/png")]);
      expect(res.status, label).toBe(415);
      expect(JSON.parse(res.text).message, label).toMatch(/JPEG, PNG or WebP/);
    }

    // Empty file: 422.
    const empty = await upload(user.cookie, [filePart(Buffer.alloc(0))]);
    expect(empty.status).toBe(422);

    // No file field, and a file field that is plain text: 400.
    expect((await upload(user.cookie, [{ name: "other", value: "x" }])).status).toBe(400);
    expect((await upload(user.cookie, [{ name: "file", value: "not a file" }])).status).toBe(400);

    // 4 MiB + 1 byte: 413 (a PNG signature up front, so only the size can be the reason).
    const tooBig = await upload(user.cookie, [filePart(padTo(makePngHeader(8, 8), 4 * MIB + 1))]);
    expect(tooBig.status).toBe(413);

    // Wider or taller than 8000 px: 422.
    for (const [w, h] of [
      [8001, 100],
      [100, 8001],
    ]) {
      const res = await upload(user.cookie, [filePart(makePngHeader(w!, h!))]);
      expect(res.status, `${w}x${h}`).toBe(422);
    }
    // A header that names no size is unreadable: 422.
    const truncated = await upload(user.cookie, [filePart(makePngHeader(8, 8).subarray(0, 16))]);
    expect(truncated.status).toBe(422);

    expect(await objectNames(user.userId)).toEqual(before);
    await context.close();
  });

  test("M2-08 a body over the cap is refused before it is read, a file of exactly 4 MiB is stored", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "sz");

    // A 12 MB body: 413 from the Content-Length alone (the server may also reset the socket
    // once it has answered; it must never store it).
    const { body: hugeBody, contentType } = multipart([
      filePart(padTo(makePngHeader(8, 8), 12 * MIB)),
    ]);
    const before = await objectNames(user.userId);
    const huge = await rawBuffer(APP_HOST, "/api/media", {
      method: "POST",
      cookie: user.cookie,
      headers: { "content-type": contentType },
      body: hugeBody,
    }).catch((error: Error) => ({ status: 0, text: error.message }));
    expect([413, 0]).toContain(huge.status);
    expect(await objectNames(user.userId)).toEqual(before);

    // Exactly 4 MiB is allowed (the multipart envelope is not counted against the file).
    const exact = await upload(user.cookie, [filePart(padTo(makePngHeader(8, 8), 4 * MIB))]);
    expect(exact.status, exact.text).toBe(200);
    createdPaths.push((JSON.parse(exact.text) as { path: string }).path);
    await context.close();
  });

  test("M2-08 the route accepts POST only", async ({ browser }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "mt");
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await rawBuffer(APP_HOST, "/api/media", { method, cookie: user.cookie });
      expect(res.status, method).toBe(405);
    }
    await context.close();
  });

  test("M2-08 direct Storage API abuse with a user's token and the publishable key is refused", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a: Signed & { cookie: string } = await signedIn(contextA, "da");
    const b: Signed & { cookie: string } = await signedIn(contextB, "db");
    const tokenA = await accessTokenFor(a.email);
    const tokenB = await accessTokenFor(b.email);

    // B has an object (through the real route) that A tries to touch.
    const stored = await upload(b.cookie, [filePart(makePng(8, 8))]);
    expect(stored.status).toBe(200);
    const bPath = (JSON.parse(stored.text) as { path: string }).path;
    createdPaths.push(bPath);

    const storage = (path: string, token: string | null, init: RequestInit = {}) =>
      fetch(`${supabaseUrl()}/storage/v1${path}`, {
        ...init,
        headers: {
          apikey: publishableKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    const png = makePng(8, 8);
    const pngInit = (extra: Record<string, string> = {}): RequestInit => ({
      method: "POST",
      headers: { "content-type": "image/png", ...extra },
      body: new Uint8Array(png),
    });

    // Upload into your own folder: no client insert policy.
    const own = await storage(`/object/${BUCKET}/${a.userId}/x.png`, tokenA, pngInit());
    expect(own.status).toBeGreaterThanOrEqual(400);
    // Upload into someone else's folder.
    const foreign = await storage(`/object/${BUCKET}/${b.userId}/x.png`, tokenA, pngInit());
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    // Overwrite an existing object with upsert.
    const overwrite = await storage(
      `/object/${BUCKET}/${bPath}`,
      tokenA,
      pngInit({ "x-upsert": "true" }),
    );
    expect(overwrite.status).toBeGreaterThanOrEqual(400);
    // ...and as its owner: the upload route is the only writer.
    const ownerOverwrite = await storage(
      `/object/${BUCKET}/${bPath}`,
      tokenB,
      pngInit({ "x-upsert": "true" }),
    );
    expect(ownerOverwrite.status).toBeGreaterThanOrEqual(400);
    // Delete another user's object, and your own.
    const del = await storage(`/object/${BUCKET}/${bPath}`, tokenA, { method: "DELETE" });
    expect(del.status).toBeGreaterThanOrEqual(400);
    const ownerDel = await storage(`/object/${BUCKET}/${bPath}`, tokenB, { method: "DELETE" });
    expect(ownerDel.status).toBeGreaterThanOrEqual(400);

    // Listing the bucket returns nothing, anonymous or signed in.
    const listBody = JSON.stringify({ prefix: "", limit: 100, offset: 0 });
    for (const token of [null, tokenA, tokenB]) {
      const res = await storage(`/object/list/${BUCKET}`, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: listBody,
      });
      const list = res.ok ? ((await res.json()) as unknown[]) : [];
      expect(list, `list as ${token ? "authenticated" : "anon"}`).toEqual([]);
    }
    const listOwn = await storage(`/object/list/${BUCKET}`, tokenB, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix: b.userId, limit: 100, offset: 0 }),
    });
    expect(listOwn.ok ? await listOwn.json() : []).toEqual([]);

    // A 5 MB direct upload is refused by the bucket limit, even with the secret key.
    const big = await adminClient()
      .storage.from(BUCKET)
      .upload(
        `${a.userId}/${crypto.randomUUID()}.png`,
        new Uint8Array(padTo(makePngHeader(8, 8), 5 * MIB)),
        {
          contentType: "image/png",
        },
      );
    expect(big.error).not.toBeNull();

    // The object is untouched and still readable by its public URL.
    expect(await objectNames(b.userId)).toContain(bPath.split("/")[1]);
    const still = await fetch(`${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${bPath}`);
    expect(still.status).toBe(200);
    expect(await objectNames(a.userId)).toEqual([]);

    await contextA.close();
    await contextB.close();
  });

  test("M2-08 replacing an image only changes the draft: the old object stays readable", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "rp");
    const first = await upload(user.cookie, [filePart(makePng(8, 8, [10, 20, 30]))]);
    const second = await upload(user.cookie, [filePart(makePng(8, 8, [30, 20, 10]))]);
    const paths = [first, second].map((res) => (JSON.parse(res.text) as { path: string }).path);
    createdPaths.push(...paths);
    expect(paths[0]).not.toBe(paths[1]);
    // A second upload never replaces or removes the first: object names are never reused.
    for (const path of paths) {
      const res = await fetch(`${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`);
      expect(res.status).toBe(200);
    }
    await context.close();
  });
});
