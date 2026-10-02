import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, signedInUser } from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import { openEditor, pageRow, seededUser, statusChip } from "../m2/editor-helpers";
import {
  SERVER_PORT,
  makeJpegHeader,
  multipart,
  padTo,
  rawBuffer,
  tenantGet,
  type Part,
} from "../m2/publish-helpers";
import { setOverrides } from "./design-helpers";

/**
 * M3-15 (security): the background image can only ever be one of the owner's own uploads, and an
 * object that a published page uses can be neither swapped nor removed by any client.
 *
 *   - POST /api/media with kind=background: the folder is the session user's, every upload gets a
 *     new name, no form field can name an owner or a path, no session stores nothing;
 *   - the Storage API with the publishable key and a user's token (the way curl would): upload to
 *     another user's folder or your own, upsert onto an existing object, update, move, copy and
 *     delete are all refused, and the object's bytes are untouched;
 *   - the publish gate: a draft whose bgImage is another user's upload (or, written straight to the
 *     database, a third-party address) is refused or repaired, never published.
 * The Design screen's own flow (upload, replace, remove, messages) is in sections-design.spec.ts.
 */

const BUCKET = "page-media";
const APP_HOST = `app.localhost:${SERVER_PORT}`;
const MIB = 1024 * 1024;

const stored: string[] = [];

test.afterAll(async () => {
  const paths = stored.splice(0);
  if (paths.length > 0) await adminClient().storage.from(BUCKET).remove(paths);
  await cleanupUsers();
});

const publicUrl = (path: string) => `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`;

const jpegPart = (seed = 0, name = "bg.jpg"): Part => ({
  name: "file",
  file: {
    filename: name,
    contentType: "image/jpeg",
    // Different bytes every call, so two uploads are never the same file.
    data: padTo(makeJpegHeader(1600 + seed, 900), 4096 + seed),
  },
});

async function upload(cookie: string | undefined, parts: Part[]) {
  const { body, contentType } = multipart(parts);
  return rawBuffer(APP_HOST, "/api/media", {
    method: "POST",
    cookie,
    headers: { "content-type": contentType },
    body,
  });
}

async function signedIn(context: Parameters<typeof signedInUser>[0], label: string) {
  const user = await signedInUser(context, { label });
  return { ...user, cookie: cookieHeader(await authCookies(context)) };
}

const objectNames = async (userId: string): Promise<string[]> =>
  ((await adminClient().storage.from(BUCKET).list(userId, { limit: 1000 })).data ?? []).map(
    (item) => item.name,
  );

async function digestOf(path: string): Promise<{ status: number; sha: string }> {
  const res = await fetch(publicUrl(path));
  return {
    status: res.status,
    sha: createHash("sha256")
      .update(Buffer.from(await res.arrayBuffer()))
      .digest("hex"),
  };
}

test.describe("M3-15 the background upload route", () => {
  test("M3-15 kind=background stores under the caller's uid with a new name each time; a missing session stores nothing", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const user = await signedIn(context, "bm");
    const before = await objectNames(user.userId);

    const other = "00000000-0000-4000-8000-0000000000a1";
    const first = await upload(user.cookie, [
      jpegPart(1),
      { name: "kind", value: "background" },
      // An owner, folder or path in the form is ignored: the folder is always the session user.
      { name: "owner_id", value: other },
      { name: "path", value: `${other}/stolen.jpg` },
    ]);
    const second = await upload(user.cookie, [jpegPart(2), { name: "kind", value: "background" }]);
    expect(first.status, first.text).toBe(200);
    expect(second.status, second.text).toBe(200);
    const one = JSON.parse(first.text) as { path: string; url: string };
    const two = JSON.parse(second.text) as { path: string; url: string };
    stored.push(one.path, two.path);

    for (const body of [one, two]) {
      expect(body.path).toMatch(new RegExp(`^${user.userId}/[0-9a-f-]{36}\\.jpg$`));
      expect(body.url).toBe(publicUrl(body.path));
      expect((await fetch(body.url)).status).toBe(200);
    }
    expect(one.path).not.toBe(two.path);
    expect(await objectNames(user.userId)).toHaveLength(before.length + 2);
    expect(await objectNames(other)).not.toContain("stolen.jpg");

    // No session: refused, nothing stored.
    const anonymous = await upload(undefined, [jpegPart(3), { name: "kind", value: "background" }]);
    expect(anonymous.status).toBe(401);
    expect(await objectNames(user.userId)).toHaveLength(before.length + 2);
    await context.close();
  });
});

test.describe("M3-15 a published background cannot be swapped or removed through the Storage API", () => {
  test("M3-15 upload, upsert, update, move, copy and delete are refused for the owner, another user and anonymous", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const a = await signedIn(contextA, "sa");
    const b = await signedIn(contextB, "sb");
    const tokenA = await accessTokenFor(a.email);
    const tokenB = await accessTokenFor(b.email);

    // B's background, as the route stores it.
    const res = await upload(b.cookie, [jpegPart(5), { name: "kind", value: "background" }]);
    expect(res.status, res.text).toBe(200);
    const bPath = (JSON.parse(res.text) as { path: string }).path;
    stored.push(bPath);
    const original = await digestOf(bPath);
    expect(original.status).toBe(200);

    const storage = (path: string, token: string | null, init: RequestInit = {}) =>
      fetch(`${supabaseUrl()}/storage/v1${path}`, {
        ...init,
        headers: {
          apikey: publishableKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    const jpeg = new Uint8Array(padTo(makeJpegHeader(10, 10), 2048));
    const put = (extra: Record<string, string> = {}, method = "POST"): RequestInit => ({
      method,
      headers: { "content-type": "image/jpeg", ...extra },
      body: jpeg,
    });
    const json = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const attempts: Array<[string, Promise<Response>]> = [];
    for (const [who, token] of [
      ["A", tokenA],
      ["B (owner)", tokenB],
      ["anonymous", null],
    ] as const) {
      attempts.push(
        [
          `${who}: upsert onto B's object`,
          storage(`/object/${BUCKET}/${bPath}`, token, put({ "x-upsert": "true" })),
        ],
        [
          `${who}: update B's object (PUT)`,
          storage(`/object/${BUCKET}/${bPath}`, token, put({}, "PUT")),
        ],
        [
          `${who}: delete B's object`,
          storage(`/object/${BUCKET}/${bPath}`, token, { method: "DELETE" }),
        ],
        [
          `${who}: delete many`,
          storage(`/object/${BUCKET}`, token, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prefixes: [bPath] }),
          }),
        ],
        [
          `${who}: move B's object`,
          storage(
            "/object/move",
            token,
            json({ bucketId: BUCKET, sourceKey: bPath, destinationKey: `${a.userId}/moved.jpg` }),
          ),
        ],
        [
          `${who}: copy B's object`,
          storage(
            "/object/copy",
            token,
            json({ bucketId: BUCKET, sourceKey: bPath, destinationKey: `${a.userId}/copied.jpg` }),
          ),
        ],
        [
          `${who}: upload into B's folder`,
          storage(`/object/${BUCKET}/${b.userId}/x.jpg`, token, put()),
        ],
        [
          `${who}: upload into A's folder`,
          storage(`/object/${BUCKET}/${a.userId}/x.jpg`, token, put()),
        ],
      );
    }
    for (const [label, pending] of attempts) {
      const attempt = await pending;
      if (label.endsWith("delete many") && attempt.ok) {
        // The bulk delete answers 200 with the list of objects it removed: none (RLS hides them).
        expect(await attempt.json(), label).toEqual([]);
      } else {
        expect(attempt.status, label).toBeGreaterThanOrEqual(400);
      }
    }

    // Nothing moved, copied or appeared; B's object is byte for byte what was published.
    expect(await digestOf(bPath)).toEqual(original);
    expect(await objectNames(a.userId)).toEqual([]);
    expect(await objectNames(b.userId)).toEqual([bPath.split("/")[1]]);
    await contextA.close();
    await contextB.close();
  });
});

// ------------------------------------------------------------------------------------------------

const publish = async (page: Page) => {
  await openEditor(page);
  await page.locator("main > header").getByRole("button", { name: "Publish", exact: true }).click();
};

test.describe("M3-15 the publish gate on the background image", () => {
  test("M3-15 another user's upload as bgImage is refused at Publish and the live page is unchanged", async ({
    page,
    context,
    browser,
  }) => {
    const user = await seededUser(context, "gb");
    const other = await signedIn(await browser.newContext(), "go");
    const foreign = await upload(other.cookie, [
      jpegPart(7),
      { name: "kind", value: "background" },
    ]);
    expect(foreign.status, foreign.text).toBe(200);
    const foreignPath = (JSON.parse(foreign.text) as { path: string }).path;
    stored.push(foreignPath);

    const publishedBefore = (await pageRow(user.pageId)).published;
    await setOverrides(user.pageId, { bgType: "image", bgImage: publicUrl(foreignPath) });
    await publish(page);

    // Refused with a message naming the problem; the editor does not say Published.
    await expect(
      page.getByRole("alert").filter({ hasText: /uploaded images|Publish stopped/ }),
    ).toBeVisible();
    await expect(statusChip(page)).not.toHaveText("Published");
    expect((await pageRow(user.pageId)).published).toEqual(publishedBefore);

    const live = await tenantGet(user.handle);
    expect(live.status).toBe(200);
    expect(live.text).not.toContain(foreignPath);
    expect(live.text).not.toContain('data-bg-layer="image"');
  });

  test("M3-15 a third-party address written straight into the draft is never published or requested", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "gt");
    const hostile = "https://images.example.com/bg.jpg";
    await setOverrides(user.pageId, { bgType: "image", bgImage: hostile, blur: 6 });
    await publish(page);

    // Either the gate refuses it or the editor repaired the unreadable value away; in no case does
    // the published document hold the address, and the live page never asks that host for anything.
    await expect
      .poll(
        async () => {
          const row = await pageRow(user.pageId);
          return JSON.stringify(row.published).includes("images.example.com");
        },
        { timeout: 15_000 },
      )
      .toBe(false);
    const requested: string[] = [];
    const live = await context.newPage();
    live.on("request", (request) => requested.push(new URL(request.url()).host));
    await live.goto(`http://${user.handle}.localhost:${SERVER_PORT}/`);
    await expect(live.locator("[data-page-root]")).toBeVisible();
    expect(requested.filter((host) => host.includes("example.com"))).toEqual([]);
    expect((await tenantGet(user.handle)).text).not.toContain("images.example.com");
  });
});

test("M3-15 the object size cap holds for a background: a 5 MB JPEG is refused by the route", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const user = await signedIn(context, "bs");
  const before = await objectNames(user.userId);
  const big = await upload(user.cookie, [
    {
      name: "file",
      file: {
        filename: "big.jpg",
        contentType: "image/jpeg",
        data: padTo(makeJpegHeader(1600, 900), 5 * MIB),
      },
    },
    { name: "kind", value: "background" },
  ]);
  expect([413, 0]).toContain(big.status);
  expect(await objectNames(user.userId)).toEqual(before);
  await context.close();
});
