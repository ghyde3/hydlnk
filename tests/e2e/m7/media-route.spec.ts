import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand, signedInUser } from "../fixtures/data";
import { addDomainRow, hostnameFor, makeSite } from "../m4/domains-core-helpers";
import { SERVER_PORT, rawBuffer, type RawBufferResponse } from "../m2/publish-helpers";
import { BUCKET, removeFolders, sessionCookie, uploadMedia, uploaded } from "../m5/images-helpers";

/**
 * M7-14: GET and HEAD /media/{uid}/{file} on the root host (every other host is a 404), against the local stack: the exact bytes
 * of the Storage object, the cache headers (the cost protection), and the refusals (never an open
 * proxy). Local runs have no CDN, so every request reaches Storage and these specs assert headers,
 * not hits; the proof of the cache is the release-time check in PROGRESS.md. The unit twins with an
 * injected fetch (which count upstream requests) are tests/unit/m7-media-serve.test.ts and
 * m7-media-matcher.test.ts. Raw HTTP, so nothing normalizes a path before the server sees it.
 */

test.describe.configure({ timeout: 120_000 });

const owners: string[] = [];
test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});

const PORT = SERVER_PORT;
const HOSTS = {
  marketing: `localhost:${PORT}`,
  app: `app.localhost:${PORT}`,
  tenant: `mara.localhost:${PORT}`,
};

const CACHE = "public, max-age=31536000, immutable";
const CDN = "public, max-age=604800";
const SHORT = "public, max-age=60";

const sha = (data: Buffer | Uint8Array) => createHash("sha256").update(data).digest("hex");
const storageUrl = (path: string) => `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`;
const get = (host: string, path: string, opts: Parameters<typeof rawBuffer>[2] = {}) =>
  rawBuffer(host, path, opts);

async function png(width = 120, height = 80): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .png()
    .toBuffer();
}

/** Stores an object with the secret key (older uploads were .png and .jpg; the route must serve them). */
async function store(path: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await adminClient().storage.from(BUCKET).upload(path, data, { contentType });
  if (error) throw new Error(`store ${path} failed: ${error.message}`);
}

function expectImage(res: RawBufferResponse, type: string, bytes: Buffer): void {
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toBe(type);
  expect(res.headers["cache-control"]).toBe(CACHE);
  expect(res.headers["vercel-cdn-cache-control"]).toBe(CDN);
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(res.headers["content-length"]).toBe(String(bytes.length));
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(sha(res.body)).toBe(sha(bytes));
}

function expectMiss(res: RawBufferResponse, label: string): void {
  expect(res.status, label).toBe(404);
  expect(res.headers["cache-control"], label).toBe(SHORT);
  expect(res.headers["vercel-cdn-cache-control"], label).toBe(SHORT);
  expect(res.headers["set-cookie"], label).toBeUndefined();
  expect(String(res.headers["content-type"] ?? ""), label).not.toMatch(/^image\//);
}

test.describe("M7-14 the /media route", () => {
  test("M7-14 an uploaded image is served on the root host only, with the exact bytes and the cache headers", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mdr" });
    owners.push(me.userId);
    const cookie = await sessionCookie(context);
    const image = uploaded(
      await uploadMedia(await png(), {
        kind: "content",
        filename: "a.png",
        contentType: "image/png",
        cookie,
      }),
    );
    expect(image.path).toMatch(new RegExp(`^${me.userId}/img-[0-9a-f]{32}\\.webp$`));

    // The reference: what Storage itself serves for the object.
    const direct = await fetch(storageUrl(image.path));
    expect(direct.status).toBe(200);
    const bytes = Buffer.from(await direct.arrayBuffer());
    expect(direct.headers.get("content-type")).toBe("image/webp");

    // A verified custom domain (the M4-09 fixture), its page published.
    const site = await makeSite("mdrc");
    owners.push(site.user.id);
    const customHost = hostnameFor("mdr");
    await addDomainRow({ pageId: site.pageId, hostname: customHost, status: "verified" });

    const path = `/media/${image.path}`;
    const root = HOSTS.marketing;
    expectImage(await get(root, path), "image/webp", bytes);
    // With the owner's auth cookie on the request nothing changes and nothing is set.
    const withCookie = await get(root, path, { cookie });
    expectImage(withCookie, "image/webp", bytes);
    expect(withCookie.headers["cache-control"], "root with a cookie").toBe(CACHE);
    expect(withCookie.headers["access-control-allow-origin"]).toBe("*");
    // One canonical origin: the app host, a handle's host and a custom domain answer the short 404.
    for (const [name, host] of [
      ["app", HOSTS.app],
      ["tenant", HOSTS.tenant],
      ["custom", customHost],
    ] as const) {
      const refused = await get(host, path);
      expectMiss(refused, name);
      expect(refused.headers["vercel-cache-tag"], name).toBeUndefined();
    }
    // The browser's own request shape, on a tenant host.
    const tenant = await get(HOSTS.marketing, path, {
      headers: { accept: "image/avif,image/webp,*/*", "sec-fetch-dest": "image" },
    });
    expectImage(tenant, "image/webp", bytes);
  });

  test("M7-14 an older .png and an older .jpg object keep their own content type", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mdo" });
    owners.push(me.userId);
    const pngBytes = await png(60, 40);
    const jpgBytes = await sharp({
      create: { width: 60, height: 40, channels: 3, background: { r: 10, g: 90, b: 200 } },
    })
      .jpeg()
      .toBuffer();
    const pngPath = `${me.userId}/legacy-${rand(8)}.png`;
    const jpgPath = `${me.userId}/legacy-${rand(8)}.jpg`;
    await store(pngPath, pngBytes, "image/png");
    await store(jpgPath, jpgBytes, "image/jpeg");

    expectImage(await get(HOSTS.marketing, `/media/${pngPath}`), "image/png", pngBytes);
    expectImage(await get(HOSTS.marketing, `/media/${jpgPath}`), "image/jpeg", jpgBytes);
  });

  test("M7-14 HEAD answers the same status and headers with no body; POST, PUT, PATCH and DELETE are 405", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mdh" });
    owners.push(me.userId);
    const image = uploaded(
      await uploadMedia(await png(), {
        kind: "content",
        filename: "a.png",
        contentType: "image/png",
        cookie: await sessionCookie(context),
      }),
    );
    const path = `/media/${image.path}`;
    const got = await get(HOSTS.marketing, path);
    const head = await get(HOSTS.marketing, path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    for (const name of [
      "content-type",
      "content-length",
      "cache-control",
      "vercel-cache-tag",
      "x-content-type-options",
    ]) {
      expect(head.headers[name], name).toBe(got.headers[name]);
    }
    // The one header the CDN reads and never passes on differs: a HEAD answer is not stored by the
    // CDN (Wave I review), so it can never stand in for the GET of the same image.
    expect(got.headers["vercel-cdn-cache-control"]).toBe(CDN);
    expect(head.headers["vercel-cdn-cache-control"]).toBe("no-store");
    // Every image is tagged by account and by file, so a takedown can purge its copies by tag.
    const [uid, file] = image.path.split("/") as [string, string];
    expect(got.headers["vercel-cache-tag"]).toBe(`media-${uid},media-${uid}-${file}`);
    // HEAD of a missing image is the same short 404.
    const missing = await get(HOSTS.marketing, `/media/${me.userId}/img-${"0".repeat(32)}.webp`, {
      method: "HEAD",
    });
    expectMiss(missing, "HEAD of a missing image");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await get(HOSTS.marketing, path, {
        method,
        body: method === "DELETE" ? undefined : "x",
      });
      expect(res.status, method).toBe(405);
      expect(res.headers.allow, method).toBe("GET, HEAD");
      expect(res.headers["set-cookie"], method).toBeUndefined();
    }
    const options = await get(HOSTS.marketing, path, { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.allow).toBe("GET, HEAD");
  });

  test("M7-14 an address nobody owns gets the short 404 and never an image (Wave I review)", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mdg" });
    owners.push(me.userId);
    const image = uploaded(
      await uploadMedia(await png(), {
        kind: "content",
        filename: "a.png",
        contentType: "image/png",
        cookie: await sessionCookie(context),
      }),
    );
    const path = `/media/${image.path}`;
    const bytes = Buffer.from(await (await fetch(storageUrl(image.path))).arrayBuffer());
    // The CDN keeps a copy per host: only the root host serves, so varying the subdomain buys no cache miss.
    const hosts = [
      HOSTS.app,
      HOSTS.tenant,
      `a1.localhost:${PORT}`,
      `a2.localhost:${PORT}`,
      `a.b.localhost:${PORT}`,
      `ab.localhost:${PORT}`,
      `-x1.localhost:${PORT}`,
      `${"a".repeat(31)}.localhost:${PORT}`,
      `mara.localhost:${PORT + 1}`,
      `localhost:${PORT + 1}`,
      "203.0.113.7",
      "intranet",
    ];
    for (const host of hosts) {
      for (const method of ["GET", "HEAD"]) {
        const res = await get(host, path, { method });
        expectMiss(res, `${host} ${method}`);
        expect(res.headers["vercel-cache-tag"], `${host} ${method}`).toBeUndefined();
        if (method === "GET") expect(res.text, host).toBe("Not found");
      }
    }
    // www is redirected to the root by next.config.ts before the route is reached (the route's own
    // refusal of it, in the unit twin, is the second wall): never an image from that address.
    const www = await get(`www.localhost:${PORT}`, path);
    expect(www.status).toBe(308);
    expect(String(www.headers.location)).toBe(`http://localhost:${PORT}${path}`);
    // The root host is untouched.
    expectImage(await get(HOSTS.marketing, path), "image/webp", bytes);
  });

  test("M7-14 a missing or deleted image is a short-cached 404, never a 200 or a 5xx", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mdm" });
    owners.push(me.userId);

    // Well-formed, never stored.
    expectMiss(
      await get(HOSTS.marketing, `/media/${me.userId}/img-${"0".repeat(32)}.webp`),
      "missing",
    );
    // Someone else's folder with a name that does not exist.
    expectMiss(
      await get(
        HOSTS.marketing,
        `/media/00000000-0000-4000-8000-000000000000/img-${"1".repeat(32)}.webp`,
      ),
      "unknown folder",
    );

    // Stored, served, deleted with the secret key, then a 404 (here with no CDN in front: at most
    // MEDIA_CDN_MAX_AGE later on Vercel).
    const path = `${me.userId}/img-${"a".repeat(32)}.png`;
    const bytes = await png();
    await store(path, bytes, "image/png");
    expectImage(await get(HOSTS.marketing, `/media/${path}`), "image/png", bytes);
    const removed = await adminClient().storage.from(BUCKET).remove([path]);
    expect(removed.error).toBeNull();
    expectMiss(await get(HOSTS.marketing, `/media/${path}`), "deleted");
  });

  test("M7-14 never an open proxy: traversal, encodings, other buckets, queries and odd names are all 404 and never an image", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mda" });
    owners.push(me.userId);
    const image = uploaded(
      await uploadMedia(await png(), {
        kind: "content",
        filename: "a.png",
        contentType: "image/png",
        cookie: await sessionCookie(context),
      }),
    );
    const bytes0 = Buffer.from(await (await fetch(storageUrl(image.path))).arrayBuffer());
    const [uid, file] = image.path.split("/") as [string, string];
    const stem = file.replace(/\.webp$/, "");
    const refused: [string, string][] = [
      ["a query string on a real image", `/media/${image.path}?x=1`],
      ["a download query", `/media/${image.path}?download=1`],
      ["dot dot", `/media/${uid}/../${file}`],
      ["encoded dot dot", `/media/%2e%2e/${uid}/${file}`],
      ["encoded dot dot, upper case", `/media/%2E%2E/%2E%2E/etc/passwd`],
      ["an encoded slash", `/media/${uid}%2f${file}`],
      ["an encoded backslash", `/media/${uid}%5c${file}`],
      ["an encoded letter, one image one address", `/media/${uid}/%69mg-${stem.slice(4)}.webp`],
      ["traversal to another bucket", `/media/${uid}/..%2f..%2fother/${file}`],
      ["another bucket as a folder", `/media/page-media/${image.path}`],
      ["three segments", `/media/${image.path}/x`],
      ["one segment", `/media/${uid}`],
      ["an empty segment", `/media/${uid}//${file}`],
      ["an empty folder", `/media//${file}`],
      ["an upper-case folder", `/media/${uid.toUpperCase()}/${file}`],
      ["an upper-case extension", `/media/${uid}/${stem}.WEBP`],
      ["a 37-character folder", `/media/${uid}0/${file}`],
      ["svg", `/media/${uid}/${stem}.svg`],
      ["html", `/media/${uid}/${stem}.html`],
      ["gif", `/media/${uid}/${stem}.gif`],
      ["webp.exe", `/media/${uid}/${stem}.webp.exe`],
      ["a storage path", `/media/storage/v1/object/public/page-media/${image.path}`],
    ];
    for (const [label, path] of refused) {
      let res = await get(HOSTS.marketing, path);
      // Never an image from the odd address. Where the route itself answers (almost always) it is
      // the short public 404; where the framework or the host answers first it is still a 404.
      // Next.js collapses a doubled slash with a 308 to the canonical address first: that address
      // is then an ordinary request (the real image for an empty segment, a 404 otherwise).
      if (res.status === 308) {
        const location = String(res.headers.location);
        expect(location, label).toMatch(/^\/media\/[0-9a-z./-]+$/);
        expect(location, label).not.toMatch(/\/\/|\.\./);
        res = await get(HOSTS.marketing, location);
        if (label === "an empty segment") {
          expect(res.status, label).toBe(200);
          continue;
        }
      }
      expect(res.status, `${label}: ${path}`).toBe(404);
      expect(String(res.headers["content-type"] ?? ""), label).not.toMatch(/^image\//);
      expect(res.headers["set-cookie"], label).toBeUndefined();
    }
    // Next.js's own path normalization answers before the route does for a backslash and for a
    // trailing slash: a 308 to the canonical address, which is then the normal request. Neither
    // serves an image from the odd address, and neither reaches Storage.
    for (const path of [`/media/${uid}\\${file}`, `/media/${image.path}/`]) {
      const res = await get(HOSTS.marketing, path);
      expect(res.status, path).toBe(308);
      expect(res.headers.location, path).toBe(`/media/${image.path}`);
      expect(res.body.toString("utf8"), path).not.toMatch(/^(RIFF|\x89PNG)/);
    }
    // (An upper-case extension is not a static one for the proxy's matcher, so the proxy runs and
    // the host's own plain 404 answers: still a 404, as above.)
    // The ones the route answers itself carry the short cache (a flood of one bad path costs one
    // invocation a minute per address).
    for (const path of [
      `/media/${image.path}?x=1`,
      `/media/${uid}/${stem}.svg`,
      `/media/${uid}%2f${file}`,
      `/media/${uid}/${stem}.gif`,
    ]) {
      expectMiss(await get(HOSTS.marketing, path), path);
    }

    // A bare "?" is no query string at all by the time the framework hands the request over
    // (Next drops it from request.url), so it is the same request as none: at most one extra key
    // per image in the CDN's cache, never an unbounded number. Any `?x=1` is refused above.
    expectImage(await get(HOSTS.marketing, `/media/${image.path}?`), "image/webp", bytes0);

    // Hosts the visitor controls change nothing about where the route fetches from.
    const bytes = bytes0;
    const hostile: Record<string, string>[] = [
      { "x-forwarded-host": "evil.example" },
      { "x-original-host": "evil.example" },
      { referer: "https://evil.example/hotlink" },
      { origin: "https://evil.example" },
    ];
    for (const headers of hostile) {
      expectImage(
        await get(HOSTS.marketing, `/media/${image.path}`, { headers }),
        "image/webp",
        bytes,
      );
    }
    // An unknown host (a custom domain that is not ours) gets the short 404, not even the image.
    expectMiss(await get("evil.example", `/media/${image.path}`), "evil host");
    expectMiss(await get("evil.example", `/media/${uid}/%2e%2e/${file}`), "evil host, traversal");
  });

  test("M7-14 200 requests for missing paths in a row each answer 404, and the route stays healthy", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await signedInUser(context, { label: "mdf" });
    owners.push(me.userId);
    const image = uploaded(
      await uploadMedia(await png(), {
        kind: "content",
        filename: "a.png",
        contentType: "image/png",
        cookie: await sessionCookie(context),
      }),
    );
    const statuses: number[] = [];
    for (let round = 0; round < 20; round += 1) {
      const batch = await Promise.all(
        Array.from({ length: 10 }, (_, i) => {
          const n = round * 10 + i;
          return get(
            HOSTS.marketing,
            `/media/${me.userId}/img-${n.toString(16).padStart(32, "0")}.webp`,
          );
        }),
      );
      for (const res of batch) {
        expectMiss(res, `flood ${round}`);
        statuses.push(res.status);
      }
    }
    expect(statuses).toHaveLength(200);
    expect(new Set(statuses)).toEqual(new Set([404]));
    // Still healthy: the real image comes back, and an unrelated page of the same host renders.
    const bytes = Buffer.from(await (await fetch(storageUrl(image.path))).arrayBuffer());
    expectImage(await get(HOSTS.marketing, `/media/${image.path}`), "image/webp", bytes);
    expect((await get(HOSTS.marketing, "/")).status).toBe(200);
  });
});
