import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  rand,
  setPlan,
  signedInUser,
} from "../fixtures/data";
import { authCookies, cookieHeader } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { openEditor } from "../m2/editor-helpers";
import { openDesign } from "../m3/design-helpers";
import {
  SERVER_PORT,
  makePng,
  multipart,
  padTo,
  rawBuffer,
  type RawBufferResponse,
} from "../m2/publish-helpers";

/**
 * M4-31: the per-account upload cap, enforced on write by POST /api/media (Free 10 MiB, Pro
 * 100 MiB, Studio 1 GiB). The route is exercised the way curl would (the session cookie, multipart
 * bodies), with objects seeded straight into the bucket with the secret key. The plan/size table
 * with real Storage and the concurrency re-read are tests/unit/limits-upload-*.test.ts; the editor
 * and Design screens show the route's message through the shared image upload control.
 */

const MIB = 1024 * 1024;
const BUCKET = "page-media";
const APP_HOST = `app.localhost:${SERVER_PORT}`;
const FREE_MESSAGE = "Uploads are limited to 10 MB on Free. Delete an image or upgrade.";

test.describe.configure({ timeout: 150_000 });

const stored: string[] = [];

test.afterAll(async () => {
  if (stored.length > 0) await adminClient().storage.from(BUCKET).remove(stored.splice(0));
  await cleanupUsers();
});

/** Stores `bytes` bytes under the user's folder (objects of at most 4 MiB, the bucket's cap). */
async function seed(userId: string, bytes: number): Promise<string[]> {
  const paths: string[] = [];
  for (let left = bytes, index = 0; left > 0; index++) {
    const size = Math.min(left, 4 * MIB);
    const path = `${userId}/seed-${rand(6)}-${index}.png`;
    const { error } = await adminClient()
      .storage.from(BUCKET)
      .upload(path, Buffer.alloc(size), { contentType: "image/png" });
    if (error) throw new Error(`seed failed: ${error.message}`);
    stored.push(path);
    paths.push(path);
    left -= size;
  }
  return paths;
}

async function usedBytes(userId: string): Promise<number> {
  const { data, error } = await adminClient().rpc("account_upload_bytes", { p_uid: userId });
  if (error) throw new Error(error.message);
  return Number(data);
}

async function objectNames(userId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(BUCKET).list(userId, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((item) => item.name);
}

type Parts = { kind?: string; extra?: Record<string, string> };

function post(
  cookie: string | undefined,
  size: number,
  opts: Parts & { origin?: string } = {},
): Promise<RawBufferResponse> {
  const { body, contentType } = multipart([
    {
      name: "file",
      file: { filename: "p.png", contentType: "image/png", data: padTo(makePng(8, 8), size) },
    },
    ...(opts.kind ? [{ name: "kind", value: opts.kind }] : []),
    ...Object.entries(opts.extra ?? {}).map(([name, value]) => ({ name, value })),
  ]);
  return rawBuffer(APP_HOST, "/api/media", {
    method: "POST",
    cookie,
    headers: { "content-type": contentType, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
  });
}

const accepted = (res: RawBufferResponse): string => {
  expect(res.status, res.text).toBe(200);
  const path = (JSON.parse(res.text) as { path: string }).path;
  stored.push(path);
  return path;
};

const quotaRefusal = (res: RawBufferResponse, message = FREE_MESSAGE) => {
  expect(res.status, res.text).toBe(413);
  expect(JSON.parse(res.text)).toEqual({ error: "upload_quota", message });
};

test.describe("M4-31 the upload route enforces the plan's total", () => {
  test("M4-31 Free with 9 MiB used: 2 MiB gets 413 upload_quota and stores nothing, exactly 1 MiB fits, the next bytes do not, freed bytes lower the total", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const user = await signedInUser(context, { label: "uq" });
    const cookie = cookieHeader(await authCookies(context));
    const seeded = await seed(user.userId, 9 * MIB);
    const namesBefore = await objectNames(user.userId);

    // Over the cap: refused with the plan's sentence, nothing stored, whatever kind of image it is.
    quotaRefusal(await post(cookie, 2 * MIB));
    quotaRefusal(await post(cookie, 2 * MIB, { kind: "background" }));
    quotaRefusal(await post(cookie, 2 * MIB, { kind: "avatar" }));
    expect(await objectNames(user.userId)).toEqual(namesBefore);
    expect(await usedBytes(user.userId)).toBe(9 * MIB);

    // The plan is read from accounts.plan: a form field cannot raise it.
    quotaRefusal(
      await post(cookie, 2 * MIB, { extra: { plan: "studio", cap: "999999999", owner: "x" } }),
    );
    expect(await usedBytes(user.userId)).toBe(9 * MIB);

    // Exactly at the cap is allowed; one more byte is not.
    const exact = accepted(await post(cookie, 1 * MIB));
    expect(exact).toMatch(new RegExp(`^${user.userId}/`));
    expect(await usedBytes(user.userId)).toBe(10 * MIB);
    quotaRefusal(await post(cookie, 200));
    expect(await usedBytes(user.userId)).toBe(10 * MIB);

    // Accounting follows the bucket: deleting an object frees its bytes at once.
    const { error } = await adminClient().storage.from(BUCKET).remove(seeded);
    expect(error).toBeNull();
    expect(await usedBytes(user.userId)).toBe(1 * MIB);
    accepted(await post(cookie, 2 * MIB));

    // And the plan is read server-side: the same account on Pro has a 100 MiB cap.
    await seed(user.userId, 6 * MIB);
    quotaRefusal(await post(cookie, 3 * MIB));
    await setPlan(user.userId, "pro");
    accepted(await post(cookie, 3 * MIB));
  });

  test("M4-31 a missing session is 401, a cross-origin request is 403, a suspended account is 403: nothing is stored", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const user = await signedInUser(context, { label: "us" });
    const cookie = cookieHeader(await authCookies(context));

    const anonymous = await post(undefined, 1000);
    expect(anonymous.status).toBe(401);
    const crossOrigin = await post(cookie, 1000, { origin: "http://evil.example" });
    expect(crossOrigin.status).toBe(403);
    expect(await objectNames(user.userId)).toEqual([]);

    const { error } = await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", user.userId);
    expect(error).toBeNull();
    const suspended = await post(cookie, 1000);
    expect(suspended.status).toBe(403);
    expect(JSON.parse(suspended.text)).toMatchObject({ error: "forbidden" });
    expect(await objectNames(user.userId)).toEqual([]);
  });

  test("M4-31 two simultaneous uploads that together exceed the cap: at most one is accepted", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const user = await signedInUser(context, { label: "uc" });
    const cookie = cookieHeader(await authCookies(context));
    await seed(user.userId, 9 * MIB);

    // 9 MiB + 0.6 MiB + 0.6 MiB is over 10 MiB; either alone fits.
    const size = Math.floor(0.6 * MIB);
    const results = await Promise.all([post(cookie, size), post(cookie, size)]);
    const ok = results.filter((r) => r.status === 200);
    const refused = results.filter((r) => r.status === 413);
    for (const r of ok) accepted(r);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    quotaRefusal(refused[0]!);
    expect(await usedBytes(user.userId)).toBeLessThanOrEqual(10 * MIB);
  });

  test("M4-31 a direct Storage upload with the user's JWT and the publishable key is rejected, in their own folder and in another user's", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "not viewport dependent");
    const a = await signedInUser(context, { label: "sa" });
    const otherContext = await context.browser()!.newContext();
    const b = await signedInUser(otherContext, { label: "sb" });
    const token = await accessTokenFor(a.email);

    const png = makePng(8, 8);
    const direct = (path: string, bearer: string | null, upsert = false) =>
      fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: {
          apikey: publishableKey(),
          "content-type": "image/png",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          ...(upsert ? { "x-upsert": "true" } : {}),
        },
        body: new Uint8Array(png),
      });

    for (const [label, path, bearer] of [
      ["own folder", `${a.userId}/big.webp`, token],
      ["another user's folder", `${b.userId}/big.webp`, token],
      ["no user token", `${a.userId}/anon.webp`, null],
    ] as const) {
      const res = await direct(path, bearer);
      expect(res.status, label).toBeGreaterThanOrEqual(400);
    }
    expect((await direct(`${a.userId}/big.webp`, token, true)).status).toBeGreaterThanOrEqual(400);

    expect(await objectNames(a.userId)).toEqual([]);
    expect(await objectNames(b.userId)).toEqual([]);
    await otherContext.close();
  });
});

test.describe("M4-31 the editor shows the refusal inline", () => {
  test("M4-31 uploading past the cap in the editor shows an inline alert and leaves the photo as it was", async ({
    context,
    page,
  }) => {
    const user = await signedInUser(context, { label: "ue" });
    await seed(user.userId, 9 * MIB + 512 * 1024);
    await openEditor(page);

    const before = (
      await adminClient().from("pages").select("draft").eq("id", user.pageId).single()
    ).data!.draft as { profile: { photo: unknown } };
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({
      name: "big.png",
      mimeType: "image/png",
      buffer: padTo(makePng(8, 8), 2 * MIB),
    });

    const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    // Under the Profile photo buttons, with the screen still fitting the viewport.
    const upload = page.getByRole("button", { name: /^(Upload|Replace) photo/ }).first();
    const uploadBox = (await upload.boundingBox())!;
    expect((await alert.boundingBox())!.y).toBeGreaterThan(uploadBox.y);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");

    // Nothing was stored and the draft's photo is unchanged.
    expect(await usedBytes(user.userId)).toBe(9 * MIB + 512 * 1024);
    const after = (await adminClient().from("pages").select("draft").eq("id", user.pageId).single())
      .data!.draft as { profile: { photo: unknown } };
    expect(after.profile.photo).toEqual(before.profile.photo);
  });

  // The shared control (src/components/editor/image-upload-control.tsx) shows the route's own
  // `message` for `upload_quota` and offers a "Try again" button that sends the same file again.
  test("M4-31 the inline message is the plan's sentence and a retry control at least 44px tall is offered", async ({
    context,
    page,
  }) => {
    const user = await signedInUser(context, { label: "um" });
    const seeded = await seed(user.userId, 9 * MIB + 512 * 1024);
    await openEditor(page);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "big.png",
        mimeType: "image/png",
        buffer: padTo(makePng(8, 8), 2 * MIB),
      });
    const alert = page.getByRole("alert").filter({ hasText: FREE_MESSAGE });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    const retry = page.getByRole("button", { name: /try again|retry/i });
    await expect(retry).toBeVisible();
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Making room (the stored images go) and pressing it sends the same file again: it fits now.
    await adminClient().storage.from(BUCKET).remove(seeded);
    await retry.click();
    await expect(page.getByRole("button", { name: /^Replace photo/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(alert).toBeHidden();
    expect(await usedBytes(user.userId)).toBeGreaterThan(0);
  });

  test("M4-31 the Design background upload shows the plan's sentence too and stores nothing", async ({
    context,
    page,
  }) => {
    const user = await signedInUser(context, { label: "ud" });
    await seed(user.userId, 9 * MIB + 512 * 1024);
    await openDesign(page);

    await page.getByTestId("background-file").setInputFiles({
      name: "bg.png",
      mimeType: "image/png",
      buffer: padTo(makePng(8, 8), 2 * MIB),
    });
    // The route's own message, not the "over 4 MB" sentence of the size check.
    const alert = page.getByRole("alert").filter({ hasText: FREE_MESSAGE });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    expect(await usedBytes(user.userId)).toBe(9 * MIB + 512 * 1024);
    const draft = (await adminClient().from("pages").select("draft").eq("id", user.pageId).single())
      .data!.draft as { theme: { overrides: Record<string, unknown> } };
    expect(draft.theme.overrides.bgImage).toBeUndefined();
    expect(draft.theme.overrides.bgType).not.toBe("image");
  });
});
