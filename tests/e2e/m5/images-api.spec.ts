import { expect, test, type BrowserContext } from "@playwright/test";
import sharp from "sharp";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, rand, signedInUser } from "../fixtures/data";
import { makePng } from "../m2/publish-helpers";
import {
  BUCKET,
  MIB,
  downloadObject,
  errorOf,
  makeAlphaPng,
  makeJpeg,
  makePngImage,
  objectNames,
  removeFolders,
  sessionCookie,
  uploadMedia,
  uploaded,
  usedBytes,
  MOV_BYTES,
  MP4_BYTES,
  WEBM_BYTES,
  type Uploaded,
} from "./images-helpers";

/**
 * M5-11, M5-12, M5-13: the upload route's image pipeline, abuse limits and crafted parameters,
 * called the way curl would (the session cookie and multipart bodies) against the dev server, with
 * real images made by sharp. The editor and Design screens that show the route's messages are in
 * images-wiring.spec.ts. Unit twins: tests/unit/media-pipeline.test.ts, media-upload.test.ts.
 */

test.describe.configure({ timeout: 150_000 });

const owners: string[] = [];

test.afterAll(async () => {
  await removeFolders(owners.splice(0));
  await cleanupUsers();
});

async function user(context: BrowserContext, label: string, plan?: "free" | "pro" | "studio") {
  const made = await signedInUser(context, { label, plan });
  owners.push(made.userId);
  return { ...made, cookie: await sessionCookie(context) };
}

const publicHead = (url: string) => fetch(url, { method: "HEAD" });

test.describe("M5-11 avatar pipeline", () => {
  test("M5-11 a 3000x2000 JPEG with GPS EXIF becomes one 400x400 WebP under 100 KB with no metadata; no JPEG is stored anywhere", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "av");
    const jpeg = await makeJpeg({ width: 3000, height: 2000, noise: true, gps: true });
    expect((await sharp(jpeg).metadata()).exif).toBeDefined(); // the fixture does carry GPS

    const res = await uploadMedia(jpeg, {
      kind: "avatar",
      filename: "IMG_4021.JPG",
      cookie: me.cookie,
    });
    const image = uploaded(res);
    expect(image.path).toMatch(new RegExp(`^${me.userId}/avatar-[0-9a-f]{32}\\.webp$`));
    expect([image.width, image.height]).toEqual([400, 400]);
    expect(image.url).toBe(`${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${image.path}`);

    const bytes = await downloadObject(image.path);
    expect(bytes.length).toBeLessThan(100 * 1024);
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([400, 400]);
    expect(meta.exif).toBeUndefined();
    expect(bytes.includes(Buffer.from("GPS"))).toBe(false);

    // The original is never stored: this user's folder holds exactly the WebP, and no bucket has a
    // folder with a JPEG for this user.
    expect(await objectNames(me.userId)).toEqual([image.path.split("/")[1]]);
    const { data: buckets } = await adminClient().storage.listBuckets();
    for (const bucket of buckets ?? []) {
      const { data } = await adminClient().storage.from(bucket.id).list(me.userId, { limit: 100 });
      for (const item of data ?? []) expect(item.name).not.toMatch(/\.(jpe?g|png)$/i);
    }

    // curl -I on the public URL.
    const head = await publicHead(image.url);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/webp");
    expect(head.headers.get("cache-control")).toBe("max-age=31536000");
    await context.close();
  });

  test("M5-11 a name carries the content hash: identical bytes give the same URL and are not counted twice, different bytes never overwrite", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "ah");
    const photo = await makeJpeg({ width: 1200, height: 1200, noise: true, quality: 80 });

    const first = uploaded(await uploadMedia(photo, { kind: "avatar", cookie: me.cookie }));
    const afterFirst = await usedBytes(me.userId);
    expect(afterFirst).toBeGreaterThan(1000);
    const again = uploaded(
      await uploadMedia(photo, {
        kind: "avatar",
        filename: "same-photo-other-name.jpg",
        cookie: me.cookie,
      }),
    );
    expect(again.path).toBe(first.path);
    expect(again.url).toBe(first.url);
    expect(await usedBytes(me.userId)).toBe(afterFirst); // not double counted
    expect(await objectNames(me.userId)).toHaveLength(1);

    const stored = await downloadObject(first.path);
    const different = uploaded(
      await uploadMedia(await makeJpeg({ width: 1200, height: 1200, noise: true, quality: 60 }), {
        kind: "avatar",
        cookie: me.cookie,
      }),
    );
    expect(different.path).not.toBe(first.path);
    expect((await downloadObject(first.path)).equals(stored)).toBe(true); // the old object is untouched
    expect(await objectNames(me.userId)).toHaveLength(2);
    await context.close();
  });

  test("M5-11 a request body over 4 MB sent directly still gets 413 file_too_large and stores nothing", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "a4");
    const huge = Buffer.concat([makePng(8, 8), Buffer.alloc(4 * MIB + 1024)]);
    const res = await uploadMedia(huge, { kind: "avatar", cookie: me.cookie });
    expect(res.status).toBe(413);
    expect(errorOf(res)).toEqual({
      error: "file_too_large",
      message: "That file is too big. Use an image under 4 MB.",
    });
    // A 9 MB phone JPEG sent straight (what the browser's downsizing prevents) is refused the same way.
    const phone = Buffer.concat([
      await makeJpeg({ width: 400, height: 300 }),
      Buffer.alloc(9 * MIB),
    ]);
    expect((await uploadMedia(phone, { cookie: me.cookie })).status).toBe(413);
    expect(await objectNames(me.userId)).toEqual([]);
    await context.close();
  });

  test("M5-11 direct-API abuse: no session is 401; a form field naming another owner or folder is ignored and the object lands under the session uid", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "ab");
    const victimContext = await browser.newContext();
    const victim = await user(victimContext, "av2");
    const photo = await makeJpeg({ width: 600, height: 600 });

    const anonymous = await uploadMedia(photo, { kind: "avatar" });
    expect(anonymous.status).toBe(401);
    expect(await objectNames(me.userId)).toEqual([]);

    const res = await uploadMedia(photo, {
      kind: "avatar",
      cookie: me.cookie,
      filename: `../../${victim.userId}/avatar-0123456789abcdef.webp`,
      extra: {
        owner_id: victim.userId,
        owner: victim.userId,
        uid: victim.userId,
        folder: victim.userId,
        path: `${victim.userId}/avatar-0123456789abcdef.webp`,
        bucket: "other",
      },
    });
    const image = uploaded(res);
    expect(image.path.startsWith(`${me.userId}/`)).toBe(true);
    expect(await objectNames(victim.userId)).toEqual([]);
    expect(await objectNames(me.userId)).toHaveLength(1);

    // A cross-origin request is refused too.
    expect(
      (await uploadMedia(photo, { cookie: me.cookie, origin: "http://evil.example" })).status,
    ).toBe(403);
    await context.close();
    await victimContext.close();
  });

  test("M5-11 with the publishable key a direct Storage upload is rejected, in your own folder and in another user's", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "sk");
    const otherContext = await browser.newContext();
    const other = await user(otherContext, "sk2");
    const token = await accessTokenFor(me.email);
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#456" },
    })
      .webp()
      .toBuffer();

    for (const folder of [me.userId, other.userId]) {
      const res = await fetch(
        `${supabaseUrl()}/storage/v1/object/${BUCKET}/${folder}/avatar-0123456789abcdef.webp`,
        {
          method: "POST",
          headers: {
            apikey: publishableKey(),
            Authorization: `Bearer ${token}`,
            "content-type": "image/webp",
          },
          body: new Uint8Array(bytes),
        },
      );
      expect([400, 401, 403]).toContain(res.status);
    }
    expect(await objectNames(me.userId)).toEqual([]);
    expect(await objectNames(other.userId)).toEqual([]);
    await context.close();
    await otherContext.close();
  });
});

test.describe("M5-12 background and content pipeline", () => {
  test("M5-12 sizes: 4000x3000 PNG -> 1600x1200, 2000x4000 -> 800x1600, 800x600 stays; WebP only, longest edge <= 1600, never upscaled, metadata stripped", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "bg");

    const cases: { kind: string; prefix: string; input: Buffer; size: [number, number] }[] = [
      {
        kind: "background",
        prefix: "bg",
        input: await makePngImage({ width: 4000, height: 3000 }),
        size: [1600, 1200],
      },
      {
        kind: "content",
        prefix: "img",
        input: await makePngImage({ width: 4000, height: 3000 }),
        size: [1600, 1200],
      },
      {
        kind: "background",
        prefix: "bg",
        input: await makeJpeg({ width: 2000, height: 4000, gps: true }),
        size: [800, 1600],
      },
      {
        kind: "content",
        prefix: "img",
        input: await makePngImage({ width: 800, height: 600 }),
        size: [800, 600],
      },
    ];
    for (const c of cases) {
      const image = uploaded(
        await uploadMedia(c.input, {
          kind: c.kind,
          cookie: me.cookie,
          filename: "huge.png",
          contentType: "image/png",
        }),
      );
      expect(image.path).toMatch(new RegExp(`^${me.userId}/${c.prefix}-[0-9a-f]{32}\\.webp$`));
      expect([image.width, image.height]).toEqual(c.size);
      const bytes = await downloadObject(image.path);
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual(c.size);
      expect(meta.exif).toBeUndefined();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1600);
      const head = await publicHead(image.url);
      expect(head.headers.get("content-type")).toBe("image/webp");
      expect(head.headers.get("cache-control")).toBe("max-age=31536000");
    }
    // A transparent PNG keeps its transparency.
    const alpha = uploaded(
      await uploadMedia(await makeAlphaPng(120, 80), {
        kind: "content",
        cookie: me.cookie,
        contentType: "image/png",
      }),
    );
    expect((await sharp(await downloadObject(alpha.path)).metadata()).hasAlpha).toBe(true);
    await context.close();
  });

  test("M5-12 a photographic 4000x3000 input produces a file of at most 600 KB; replace gives a new URL, identical bytes the same one", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "ph");
    // Noise at 4000x3000 is a ~10 MB file: shrink the JPEG until it is under the 4 MiB body cap, the
    // way the browser's downsizing would, but keep it photographic.
    const photo = await makeJpeg({ width: 3000, height: 2250, noise: true, quality: 22 });
    expect(photo.length).toBeLessThan(4 * MIB);
    const first = uploaded(await uploadMedia(photo, { kind: "background", cookie: me.cookie }));
    const bytes = await downloadObject(first.path);
    expect(bytes.length).toBeLessThanOrEqual(600 * 1024);
    expect(Math.max(first.width, first.height)).toBeLessThanOrEqual(1600);
    const same = uploaded(await uploadMedia(photo, { kind: "background", cookie: me.cookie }));
    expect(same.path).toBe(first.path);
    const replaced = uploaded(
      await uploadMedia(await makeJpeg({ width: 3000, height: 2250, noise: true, quality: 21 }), {
        kind: "background",
        cookie: me.cookie,
      }),
    );
    expect(replaced.path).not.toBe(first.path);
    await context.close();
  });

  test("M5-12 direct-API abuse: a form field naming another owner's folder is ignored and a missing session is 401", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "bx");
    const otherContext = await browser.newContext();
    const other = await user(otherContext, "bx2");
    const img = await makePngImage({ width: 2000, height: 1000 });
    const ok = uploaded(
      await uploadMedia(img, {
        kind: "background",
        cookie: me.cookie,
        extra: {
          folder: other.userId,
          owner_id: other.userId,
          path: `${other.userId}/bg-aaaaaaaaaaaaaaaa.webp`,
        },
      }),
    );
    expect(ok.path.startsWith(`${me.userId}/`)).toBe(true);
    expect(await objectNames(other.userId)).toEqual([]);
    expect((await uploadMedia(img, { kind: "background" })).status).toBe(401);
    expect((await uploadMedia(img, { kind: "content" })).status).toBe(401);
    await context.close();
    await otherContext.close();
  });
});

test.describe("M5-13 abuse limits", () => {
  test("M5-13 a 7000x7000 PNG (49 MP, small on disk) is 422 image_too_large within 5 seconds; a corrupt image is 422 unreadable_image; nothing is stored", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "bm");
    const bomb = await sharp({
      create: { width: 7000, height: 7000, channels: 3, background: { r: 120, g: 120, b: 120 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(4 * MIB);

    for (const kind of ["avatar", "background", "content"]) {
      const started = Date.now();
      const res = await uploadMedia(bomb, { kind, cookie: me.cookie, contentType: "image/png" });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(res.status).toBe(422);
      expect(errorOf(res)).toEqual({
        error: "image_too_large",
        message: "That image is too large. Use one under 40 megapixels.",
      });
    }

    // Corrupt: a real PNG's first bytes followed by garbage, and a truncated JPEG.
    const png = await makePngImage({ width: 64, height: 64 });
    const corrupt = Buffer.concat([png.subarray(0, 50), Buffer.alloc(300, 9)]);
    const jpeg = await makeJpeg({ width: 800, height: 600, noise: true });
    for (const body of [corrupt, jpeg.subarray(0, Math.floor(jpeg.length / 2))]) {
      const res = await uploadMedia(body, { cookie: me.cookie });
      expect(res.status).toBe(422);
      expect(errorOf(res)).toEqual({
        error: "unreadable_image",
        message: "We couldn’t read that image. Try a different file.",
      });
    }
    expect(await objectNames(me.userId)).toEqual([]);
    expect(await usedBytes(me.userId)).toBe(0);
    await context.close();
  });

  test("M5-13 MP4, WebM and MOV bytes are 415 unsupported_type even when sent as image/jpeg; SVG, HTML and GIF too", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "vd");
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    for (const [name, bytes] of [
      ["clip.jpg", MP4_BYTES],
      ["clip.jpg", MOV_BYTES],
      ["clip.jpg", WEBM_BYTES],
      ["logo.png", svg],
      ["page.png", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ] as const) {
      const res = await uploadMedia(bytes, {
        cookie: me.cookie,
        filename: name,
        contentType: "image/jpeg",
      });
      expect(res.status, name).toBe(415);
      expect(errorOf(res)).toEqual({
        error: "unsupported_type",
        message: "That file type isn’t supported. Use JPEG, PNG or WebP.",
      });
    }
    expect(await objectNames(me.userId)).toEqual([]);
    await context.close();
  });

  test("M5-13 the 21st upload within an hour by one user is 429 with Retry-After; a different user is unaffected", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const otherContext = await browser.newContext();
    const me = await user(context, "rl");
    const other = await user(otherContext, "rl2");
    // Colours far apart, so every upload is a new object (identical bytes share one name).
    const tiny = (n: number) => makePng(8, 8, [(n * 47) % 256, (n * 91) % 256, (n * 23) % 256]);

    for (let i = 1; i <= 20; i++) {
      const res = await uploadMedia(tiny(i), { cookie: me.cookie, contentType: "image/png" });
      expect(res.status, `upload ${i}: ${res.text}`).toBe(200);
    }
    const storedBefore = await objectNames(me.userId);
    const blocked = await uploadMedia(tiny(99), { cookie: me.cookie, contentType: "image/png" });
    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).error).toBe("rate_limited");
    const retry = Number(blocked.headers["retry-after"]);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(3600);
    expect(await objectNames(me.userId)).toEqual(storedBefore); // the 21st stored nothing

    // Refused requests of every kind count while the window is full: still 429, nothing parsed.
    const garbage = await uploadMedia(Buffer.from("not an image"), { cookie: me.cookie });
    expect(garbage.status).toBe(429);

    const fine = await uploadMedia(tiny(5), { cookie: other.cookie, contentType: "image/png" });
    expect(fine.status, fine.text).toBe(200);
    await context.close();
    await otherContext.close();
  });

  test("M5-13 crafted parameters: kind=../../other or kind=document is 400, the file name is never used, every stored path matches the pattern", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const context = await browser.newContext();
    const me = await user(context, "cp");
    const img = makePng(40, 40);
    for (const kind of [
      "../../other",
      "document",
      "AVATAR",
      "avatar/../bg",
      "",
      "avatar,bg",
      "%2e%2e/x",
    ]) {
      const res = await uploadMedia(img, { kind, cookie: me.cookie, contentType: "image/png" });
      expect(res.status, `kind=${JSON.stringify(kind)}`).toBe(400);
      expect(errorOf(res).error).toBe("invalid_kind");
    }
    expect(await objectNames(me.userId)).toEqual([]);

    // The multipart file name (with traversal, an extension and a dot-dot) never reaches Storage;
    // the content type is not trusted either.
    const stored: Uploaded[] = [];
    for (const [filename, contentType, kind] of [
      ["../../etc/passwd", "image/png", "avatar"],
      ["x.php", "text/html", "background"],
      ["a b.JPG", "application/octet-stream", "content"],
      ["..%2f..%2fother.png", "image/svg+xml", undefined],
    ] as const) {
      const unique = makePng(40, 40, [Math.floor(Math.random() * 255), 10, 20]);
      stored.push(
        uploaded(await uploadMedia(unique, { cookie: me.cookie, filename, contentType, kind })),
      );
    }
    const pattern = /^[0-9a-f-]{36}\/(avatar|bg|img)-[0-9a-f]{12,}[.]webp$/;
    for (const image of stored) {
      expect(image.path).toMatch(pattern);
      expect(image.path.startsWith(`${me.userId}/`)).toBe(true);
    }
    const names = await objectNames(me.userId);
    expect(names).toHaveLength(4);
    for (const name of names) expect(`${me.userId}/${name}`).toMatch(pattern);
    await context.close();
  });
});

test.describe("M4-31 + M5-11 the quota counts what is stored after conversion", () => {
  /** Stores `bytes` bytes under a user's folder as filler (objects of at most 4 MiB). */
  async function fill(userId: string, bytes: number): Promise<void> {
    for (let left = bytes, i = 0; left > 0; i++) {
      const size = Math.min(left, 4 * MIB);
      const { error } = await adminClient()
        .storage.from(BUCKET)
        .upload(`${userId}/seed-${rand(6)}-${i}.png`, Buffer.alloc(size), {
          contentType: "image/png",
        });
      if (error) throw new Error(`seed failed: ${error.message}`);
      left -= size;
    }
  }

  /** The stored size of `image` as content, learned on a throwaway account. */
  async function learn(context: BrowserContext, image: Buffer, label: string): Promise<number> {
    const probe = await user(context, label);
    uploaded(
      await uploadMedia(image, {
        kind: "content",
        cookie: probe.cookie,
        contentType: "image/jpeg",
      }),
    );
    return usedBytes(probe.userId);
  }

  test("M4-31 Free: an upload that converts to exactly the room left is accepted, one stored byte more is 413 upload_quota (counted after conversion, not by the 3 MB original)", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const probeContext = await browser.newContext();
    // About 3 MB on the wire, a few hundred KB once stored.
    const photo = await makePngImage({ width: 1200, height: 800, noise: true });
    expect(photo.length).toBeGreaterThan(2 * MIB);
    expect(photo.length).toBeLessThan(4 * MIB);
    const stored = await learn(probeContext, photo, "qp");
    expect(stored).toBeLessThan(photo.length);
    expect(stored).toBeGreaterThan(50 * 1024);
    const cap = 10 * MIB;

    const fitContext = await browser.newContext();
    const fit = await user(fitContext, "qf");
    await fill(fit.userId, cap - stored);
    expect(await usedBytes(fit.userId)).toBe(cap - stored);
    const ok = await uploadMedia(photo, {
      kind: "content",
      cookie: fit.cookie,
      contentType: "image/jpeg",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(await usedBytes(fit.userId)).toBe(cap); // exactly at the limit is allowed

    const overContext = await browser.newContext();
    const over = await user(overContext, "qo");
    await fill(over.userId, cap - stored + 1);
    const refused = await uploadMedia(photo, {
      kind: "content",
      cookie: over.cookie,
      contentType: "image/jpeg",
    });
    expect(refused.status).toBe(413);
    expect(errorOf(refused)).toEqual({
      error: "upload_quota",
      message: "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    });
    expect(await usedBytes(over.userId)).toBe(cap - stored + 1); // stored nothing
    await probeContext.close();
    await fitContext.close();
    await overContext.close();
  });

  test("M4-31 two simultaneous uploads that together exceed the cap: at most one is accepted", async ({
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const probeContext = await browser.newContext();
    const a = await makeJpeg({ width: 2000, height: 1500, noise: true, quality: 30 });
    const b = await makeJpeg({ width: 2000, height: 1500, noise: true, quality: 31 });
    const sizeA = await learn(probeContext, a, "cpa");
    const sizeB = await learn(probeContext, b, "cpb");
    expect(sizeA + sizeB).toBeGreaterThan(Math.max(sizeA, sizeB) + 1);
    const room = Math.max(sizeA, sizeB); // either alone fits, both together do not

    const context = await browser.newContext();
    const me = await user(context, "cc");
    await fill(me.userId, 10 * MIB - room);
    const results = await Promise.all([
      uploadMedia(a, { kind: "content", cookie: me.cookie, contentType: "image/jpeg" }),
      uploadMedia(b, { kind: "content", cookie: me.cookie, contentType: "image/jpeg" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 413]);
    expect(await usedBytes(me.userId)).toBeLessThanOrEqual(10 * MIB);
    await probeContext.close();
    await context.close();
  });
});
