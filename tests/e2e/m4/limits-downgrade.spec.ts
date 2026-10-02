import { expect, test, type BrowserContext } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  pageCountForHandle,
  rand,
  signedInUser,
} from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, restAs } from "../fixtures/http";
import { deliver, priceIds, subscriptionEvent } from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { openEditor, statusChip } from "../m2/editor-helpers";
import { makePng, multipart, padTo, rawBuffer, tenantGet } from "../m2/publish-helpers";

/**
 * M4-33: a Pro account with 3 pages, 4 saved themes and 50 MiB uploaded receives a signed
 * customer.subscription.deleted. Nothing is deleted or unpublished and the pages still answer 200
 * (with the badge back); new writes (a page, an upload, a domain, a saved theme) are refused, by
 * the routes and by the database; deleting is allowed and the meters drop; a later signed
 * customer.subscription.created for Pro restores add rights and no row but the account's changed.
 * Over HTTP and the local database, with the signed webhook of the billing fixtures.
 *
 * Not covered here, because the feature belongs to another job and is not built yet: the custom
 * host still answering 200 (host-based custom-domain routing, M4-13), adding a domain through its
 * server action (M4-11/12; the database refuses it, which is asserted) and analytics gating (the
 * 90-day lock and the 30-day RLS window, Milestone 4 analytics).
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 240_000 });

const MIB = 1024 * 1024;
const BUCKET = "page-media";
const stored: string[] = [];

test.afterAll(async () => {
  if (stored.length > 0) await adminClient().storage.from(BUCKET).remove(stored.splice(0));
});

const admin = () => adminClient();

/** Another published page for `userId`, copied from the seeded demo page (draft and published). */
async function addPublishedPage(userId: string, handle: string): Promise<string> {
  const mara = await admin().from("pages").select("draft, published").eq("handle", "mara").single();
  if (mara.error) throw new Error(mara.error.message);
  const rename = (doc: unknown) => {
    const copy = JSON.parse(JSON.stringify(doc));
    copy.profile.name = handle;
    return copy;
  };
  const inserted = await admin()
    .from("pages")
    .insert({
      owner_id: userId,
      handle,
      draft: rename(mara.data.draft),
      published: rename(mara.data.published),
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data.id as string;
}

async function seedUploads(userId: string, mib: number): Promise<string[]> {
  const paths: string[] = [];
  for (let left = mib, index = 0; left > 0; index++) {
    const size = Math.min(left, 4);
    const path = `${userId}/seed-${rand(6)}-${index}.png`;
    const { error } = await admin()
      .storage.from(BUCKET)
      .upload(path, Buffer.alloc(size * MIB), { contentType: "image/png" });
    if (error) throw new Error(`seed failed: ${error.message}`);
    stored.push(path);
    paths.push(path);
    left -= size;
  }
  return paths;
}

const usedBytes = async (userId: string) => {
  const { data, error } = await admin().rpc("account_upload_bytes", { p_uid: userId });
  if (error) throw new Error(error.message);
  return Number(data);
};

async function snapshot(userId: string) {
  const pages = await admin()
    .from("pages")
    .select("id, handle, draft, published, published_at, updated_at")
    .eq("owner_id", userId)
    .order("handle");
  const themes = await admin()
    .from("themes")
    .select("id, name, tokens, updated_at")
    .eq("owner_id", userId)
    .order("name");
  const pageIds = (pages.data ?? []).map((p) => p.id as string);
  const domains = await admin()
    .from("domains")
    .select("id, page_id, hostname, status, verified_at, updated_at")
    .in("page_id", pageIds)
    .order("hostname");
  for (const r of [pages, themes, domains]) if (r.error) throw new Error(r.error.message);
  return { pages: pages.data, themes: themes.data, domains: domains.data };
}

async function plan(userId: string): Promise<string> {
  const { data, error } = await admin().from("accounts").select("plan").eq("id", userId).single();
  if (error) throw new Error(error.message);
  return data.plan as string;
}

async function waitForPlan(userId: string, want: string) {
  await expect.poll(() => plan(userId), { timeout: 30_000 }).toBe(want);
}

async function api(context: BrowserContext, method: string, path: string, body?: unknown) {
  const res = await appRaw(path, {
    method,
    cookie: cookieHeader(await authCookies(context)),
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json, raw: res };
}

async function uploadImage(context: BrowserContext, size: number) {
  const { body, contentType } = multipart([
    {
      name: "file",
      file: { filename: "p.png", contentType: "image/png", data: padTo(makePng(8, 8), size) },
    },
  ]);
  const res = await rawBuffer("app.localhost:3000", "/api/media", {
    method: "POST",
    cookie: cookieHeader(await authCookies(context)),
    headers: { "content-type": contentType },
    body,
  });
  if (res.status === 200) stored.push((JSON.parse(res.text) as { path: string }).path);
  return { status: res.status, json: JSON.parse(res.text) as Record<string, unknown> };
}

test.describe("M4-33 a downgrade keeps every row and blocks only new writes", () => {
  test("M4-33 Pro with 3 pages, 4 themes and 50 MiB, then customer.subscription.deleted, then customer.subscription.created", async ({
    context,
    page,
  }, info) => {
    // ---- Setup: a Pro account, three published pages, a domain row, four themes, 50 MiB.
    const user = await signedInUser(context, { label: "dg", plan: "pro" });
    const second = `zq-dg2-${rand(5)}`;
    const third = `zq-dg3-${rand(5)}`;
    await addPublishedPage(user.userId, second);
    await addPublishedPage(user.userId, third);
    const handles = [user.handle, second, third];

    const hostname = `${rand(8)}.dg.example.com`;
    const domain = await admin().from("domains").insert({
      page_id: user.pageId,
      hostname,
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    expect(domain.error).toBeNull();
    const themes = await admin()
      .from("themes")
      .insert(
        Array.from({ length: 4 }, (_, i) => ({
          owner_id: user.userId,
          name: `DG theme ${i + 1}`,
          tokens: {},
        })),
      );
    expect(themes.error).toBeNull();
    const objects = await seedUploads(user.userId, 50);
    expect(await usedBytes(user.userId)).toBe(50 * MIB);

    const customer = `cus_zq${rand(10)}`;
    const subscription = `sub_zq${rand(10)}`;
    const linked = await admin()
      .from("accounts")
      .update({ stripe_customer_id: customer, stripe_subscription_id: subscription })
      .eq("id", user.userId);
    expect(linked.error).toBeNull();

    // On Pro: every published page answers 200 and carries no badge.
    for (const handle of handles) {
      const res = await tenantGet(handle);
      expect(res.status, handle).toBe(200);
      expect(res.text, handle).not.toContain("Made with HYDLNK");
    }
    const before = await snapshot(user.userId);
    expect(before.pages).toHaveLength(3);
    expect(before.domains).toHaveLength(1);
    expect(before.themes).toHaveLength(4);

    // ---- The downgrade: a signed customer.subscription.deleted.
    const now = Math.floor(Date.now() / 1000);
    const deleted = await deliver(
      subscriptionEvent({
        type: "customer.subscription.deleted",
        created: now,
        customer,
        subscriptionId: subscription,
        status: "canceled",
        priceId: priceIds().proMonthly,
        accountId: user.userId,
      }),
    );
    expect(deleted.status).toBe(200);
    await waitForPlan(user.userId, "free");

    // Nothing was deleted, unpublished or altered but the account.
    expect(await snapshot(user.userId)).toEqual(before);
    expect(await usedBytes(user.userId)).toBe(50 * MIB);
    const names = (await admin().storage.from(BUCKET).list(user.userId, { limit: 1000 })).data!.map(
      (o) => o.name,
    );
    expect(names.sort()).toEqual(objects.map((p) => p.split("/")[1]).sort());

    // The published pages still answer 200, and the badge is back.
    for (const handle of handles) {
      await expect
        .poll(async () => (await tenantGet(handle)).text.includes("Made with HYDLNK"), {
          message: `badge on ${handle}`,
          timeout: 30_000,
        })
        .toBe(true);
      expect((await tenantGet(handle)).status, handle).toBe(200);
    }

    // They can still be edited and published (past the page limit).
    if (desktopOnly(info)) {
      await openEditor(page);
      const name = `Edited ${rand(4)}`;
      await page.getByLabel("Display name", { exact: true }).fill(name);
      await expect(statusChip(page)).toHaveText("Unpublished changes");
      await page
        .locator("main > header")
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
      const row = await admin().from("pages").select("published").eq("id", user.pageId).single();
      expect((row.data!.published as { profile: { name: string } }).profile.name).toBe(name);
    }

    // ---- New writes are refused: a page, an upload, a domain, a saved theme.
    const newHandle = `zq-dgn-${rand(5)}`;
    const create = await api(context, "POST", "/api/pages", { handle: newHandle });
    expect(create.status).toBe(403);
    expect(create.json).toEqual({
      error: "page_limit",
      message: "Free includes 1 page. Pro includes 3.",
    });
    expect(await pageCountForHandle(newHandle)).toBe(0);

    const upload = await uploadImage(context, 1000);
    expect(upload.status).toBe(413);
    expect(upload.json).toEqual({
      error: "upload_quota",
      message: "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    });
    expect(await usedBytes(user.userId)).toBe(50 * MIB);

    // The database refuses past the Free limit too, even for the secret key.
    const lateDomain = await admin()
      .from("domains")
      .insert({ page_id: user.pageId, hostname: `late.${hostname}` });
    expect(lateDomain.error?.code).toBe("HL003");
    const lateTheme = await admin()
      .from("themes")
      .insert({ owner_id: user.userId, name: "Late theme", tokens: {} });
    expect(lateTheme.error?.code).toBe("HL002");
    const token = await accessTokenFor(user.email);
    const viaJwt = await restAs(token, "/pages", {
      method: "POST",
      body: { owner_id: user.userId, handle: `zq-dgj-${rand(5)}`, draft: { version: 1 } },
    });
    expect([401, 403]).toContain(viaJwt.status);
    const themeViaJwt = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: user.userId, name: "Late jwt theme", tokens: {} },
    });
    expect(themeViaJwt.status).not.toBe(201);

    // ---- The meters show the over-limit state: '3 / 1', a full bar and the helper line.
    await page.goto(url("app", "/settings"));
    const meter = (key: "pages" | "domains" | "uploads" | "themes") =>
      page.locator(`[data-meter="${key}"]`);
    const pagesMeter = meter("pages");
    await expect(pagesMeter).toContainText("3 / 1");
    await expect(pagesMeter).toContainText(
      "Over your plan’s limit. What you have stays; you can’t add more.",
    );
    await expect(meter("domains")).toContainText("1 / 0");
    await expect(meter("uploads")).toContainText("50 / 10 MB");
    await expect(meter("themes")).toContainText("4 / 3");
    expect(
      await pagesMeter
        .locator("[data-meter-fill]")
        .evaluate((el) => (el as HTMLElement).style.width),
    ).toBe("100%");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    // ---- Deleting is allowed and the meters drop accordingly.
    const remove = await api(context, "DELETE", `/api/pages/${await pageIdOf(third)}`, {
      confirm: third,
    });
    expect(remove.status).toBe(200);
    const removedDomain = await admin().from("domains").delete().eq("hostname", hostname);
    expect(removedDomain.error).toBeNull();
    const removedObject = await admin().storage.from(BUCKET).remove(objects.slice(0, 3));
    expect(removedObject.error).toBeNull();
    const removedTheme = await admin()
      .from("themes")
      .delete()
      .eq("owner_id", user.userId)
      .eq("name", "DG theme 4");
    expect(removedTheme.error).toBeNull();
    expect(await usedBytes(user.userId)).toBe(50 * MIB - 12 * MIB);
    await page.goto(url("app", "/settings"));
    await expect(meter("pages")).toContainText("2 / 1");
    await expect(meter("domains")).toContainText("Not included");
    await expect(meter("uploads")).toContainText("38 / 10 MB");
    await expect(meter("themes")).toContainText("3 / 3");
    await expect(meter("themes")).not.toContainText("Over your plan");

    // ---- A later signed customer.subscription.created for Pro restores add rights.
    const afterDelete = await snapshot(user.userId);
    const restored = await deliver(
      subscriptionEvent({
        type: "customer.subscription.created",
        created: now + 60,
        customer,
        subscriptionId: `sub_zq${rand(10)}`,
        status: "active",
        priceId: priceIds().proMonthly,
        accountId: user.userId,
      }),
    );
    expect(restored.status).toBe(200);
    await waitForPlan(user.userId, "pro");

    // No data was lost or altered by the upgrade either.
    expect(await snapshot(user.userId)).toEqual(afterDelete);
    // Add rights are back: an upload (38 MiB used of 100), a saved theme, a page (2 of 3).
    expect((await uploadImage(context, 1000)).status).toBe(200);
    const themeAgain = await admin()
      .from("themes")
      .insert({ owner_id: user.userId, name: "Back again", tokens: {} });
    expect(themeAgain.error).toBeNull();
    const pageAgain = await api(context, "POST", "/api/pages", { handle: newHandle });
    expect(pageAgain.status).toBe(201);
    // The badge goes away again.
    for (const handle of [user.handle, second]) {
      await expect
        .poll(async () => (await tenantGet(handle)).text.includes("Made with HYDLNK"), {
          timeout: 30_000,
        })
        .toBe(false);
    }
    await page.goto(url("app", "/settings"));
    await expect(meter("pages")).toContainText("3 / 3");
    await expect(meter("pages")).not.toContainText("Over your plan");
    await expectNoHorizontalScroll(page);
  });
});

async function pageIdOf(handle: string): Promise<string> {
  const { data, error } = await admin().from("pages").select("id").eq("handle", handle).single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
