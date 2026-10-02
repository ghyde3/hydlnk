import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import {
  addStubSubscription,
  deliver,
  ensureStripeStub,
  failStub,
  priceIds,
  stubCalls,
  stubRequests,
  stubSubscriptionStatus,
  subscriptionEvent,
} from "../fixtures/stripe-stub";
import { expectNoHorizontalScroll, url } from "../helpers";
import { billingUser, type BillingUser } from "./billing-helpers";

/**
 * M4-34: deleting an account cancels billing first. The Stripe stub records what the deletion
 * sends; the database and the storage bucket show what is left. The Vercel step (custom domains)
 * is covered where the Vercel client is (tests/unit/billing-delete-account.test.ts orders it);
 * these accounts have no custom domain.
 */

test.afterAll(cleanupUsers);
test.beforeAll(ensureStripeStub);

const settings = () => url("app", "/settings");
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete your account?" });
const BUCKET = "page-media";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const CANCEL_MESSAGE = "We couldn’t cancel your subscription. Try again.";

async function seedMedia(user: BillingUser): Promise<string[]> {
  const paths = [`${user.userId}/${rand(8)}.png`, `${user.userId}/${rand(8)}.png`];
  for (const path of paths) {
    const { error } = await adminClient()
      .storage.from(BUCKET)
      .upload(path, PNG, { contentType: "image/png" });
    if (error) throw new Error(`seeding media failed: ${error.message}`);
  }
  return paths;
}

async function mediaOf(userId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(BUCKET).list(userId, { limit: 100 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((entry) => entry.name);
}

async function userExists(id: string): Promise<boolean> {
  return (await adminClient().auth.admin.getUserById(id)).data.user !== null;
}

async function openDialog(page: Page) {
  await page.goto(settings());
  await page.locator("main").getByRole("button", { name: "Delete account" }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmDelete(page: Page, handle: string) {
  const dialog = await openDialog(page);
  await dialog.getByLabel("Type your handle to confirm").fill(handle);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  return dialog;
}

const cancelCalls = (subscription: string) =>
  stubCalls("DELETE", `/v1/subscriptions/${subscription}`);
const listCalls = (customer: string) => stubCalls("GET", "/v1/subscriptions", customer);

test.describe("M4-34 the Delete account modal", () => {
  test("M4-34 a paying account's modal says its subscription will be canceled, above the confirmation field", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "dm-pro", plan: "pro" });
    const dialog = await openDialog(page);
    const line = dialog.getByText("Your Pro subscription will be canceled.");
    await expect(line).toBeVisible();
    const field = dialog.getByLabel("Type your handle to confirm");
    expect((await line.boundingBox())!.y).toBeLessThan((await field.boundingBox())!.y);
    await expectNoHorizontalScroll(page);

    // The extra line did not change what was there before.
    await expect(dialog).toContainText("This can’t be undone.");

    const width = page.viewportSize()!.width;
    const box = (await dialog.boundingBox())!;
    if (width >= 1000) {
      // Desktop: centred, at most 440px wide.
      expect(box.width).toBeLessThanOrEqual(440.5);
      expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
    } else {
      // Phone: the line wraps inside the dialog, the buttons are full width and stacked, 44px tall.
      const lineBox = (await line.boundingBox())!;
      expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(box.x + box.width);
      const buttons = await dialog.getByRole("button").all();
      expect(buttons.length).toBe(2);
      const boxes = [];
      for (const button of buttons) boxes.push((await button.boundingBox())!);
      for (const b of boxes) {
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThan(box.width - 60);
      }
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeGreaterThanOrEqual(44);
    }
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("M4-34 Studio says Studio, and a Free account's modal has no subscription line", async ({
    page,
    context,
  }) => {
    await billingUser(context, { label: "dm-studio", plan: "studio" });
    const studio = await openDialog(page);
    await expect(studio.getByText("Your Studio subscription will be canceled.")).toBeVisible();

    await billingUser(context, { label: "dm-free" });
    const free = await openDialog(page);
    await expect(free.locator("[data-delete-subscription]")).toHaveCount(0);
    await expect(free).not.toContainText("subscription");
  });
});

test.describe("M4-34 deleting a paying account", () => {
  test("M4-34 cancels each subscription once, removes the images, deletes the user, and the account is gone everywhere", async ({
    page,
    context,
  }) => {
    const user = await billingUser(context, { label: "dd-ok", plan: "pro" });
    // A second live subscription and one that already ended: one cancel request per live one.
    const second = `sub_zq${rand(10)}`;
    const ended = `sub_zq${rand(10)}`;
    await addStubSubscription({ id: second, customer: user.customer!, priceId: priceIds().proYearly });
    await addStubSubscription({
      id: ended,
      customer: user.customer!,
      priceId: priceIds().proMonthly,
      status: "canceled",
    });
    const files = await seedMedia(user);
    expect(await mediaOf(user.userId)).toHaveLength(files.length);
    const tenant = url(user.handle);
    expect((await rawRequest(`${user.handle}.localhost:3000`, "/")).status).toBe(200);

    await confirmDelete(page, user.handle);
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);

    // Stripe: exactly one cancel request for each live subscription, none for the one that ended.
    expect(await cancelCalls(user.subscription!)).toHaveLength(1);
    expect(await cancelCalls(second)).toHaveLength(1);
    expect(await cancelCalls(ended)).toHaveLength(0);
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("canceled");
    expect(await stubSubscriptionStatus(second)).toBe("canceled");

    // Everything else is gone.
    expect(await mediaOf(user.userId)).toEqual([]);
    expect(await userExists(user.userId)).toBe(false);
    for (const table of ["accounts", "pages"] as const) {
      const column = table === "accounts" ? "id" : "owner_id";
      const { data } = await adminClient().from(table).select("*").eq(column, user.userId);
      expect(data, table).toEqual([]);
    }
    expect((await rawRequest(`${user.handle}.localhost:3000`, "/")).status).toBe(404);
    expect(tenant).toContain(user.handle);
    // The handle can be claimed again.
    const { data: handle } = await adminClient().from("pages").select("id").eq("handle", user.handle);
    expect(handle).toEqual([]);

    // A webhook for the deleted customer is acknowledged and writes nothing.
    const response = await deliver(
      subscriptionEvent({
        customer: user.customer!,
        subscriptionId: user.subscription!,
        priceId: priceIds().studioMonthly,
        accountId: user.userId,
      }),
    );
    expect(response.status).toBe(200);
    const { data: revived } = await adminClient().from("accounts").select("id").eq("id", user.userId);
    expect(revived).toEqual([]);
  });

  test("M4-34 when Stripe cannot cancel, nothing is deleted and the dialog says so; the retry succeeds", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "dd-fail", plan: "studio" });
    const files = await seedMedia(user);
    await failStub("DELETE", `/v1/subscriptions/${user.subscription}`);

    const dialog = await confirmDelete(page, user.handle);
    await expect(dialog.getByRole("alert")).toHaveText(CANCEL_MESSAGE);
    await expect(page).toHaveURL(settings());

    // Intact: the user, the page, the files, the plan and the subscription itself.
    expect(await userExists(user.userId)).toBe(true);
    expect(
      (await adminClient().from("pages").select("id").eq("id", user.pageId)).data,
    ).toHaveLength(1);
    expect(await mediaOf(user.userId)).toHaveLength(files.length);
    const { data: account } = await adminClient()
      .from("accounts")
      .select("plan")
      .eq("id", user.userId)
      .single();
    expect(account!.plan).toBe("studio");
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("active");
    expect((await rawRequest(`${user.handle}.localhost:3000`, "/")).status).toBe(200);

    // Stripe recovers: the same dialog finishes the job.
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("canceled");
    expect(await userExists(user.userId)).toBe(false);
    expect(await mediaOf(user.userId)).toEqual([]);
  });

  test("M4-34 a failure to list the customer's subscriptions stops the deletion the same way", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "dd-list", plan: "pro" });
    await failStub("GET", `customer=${user.customer}`);
    const dialog = await confirmDelete(page, user.handle);
    await expect(dialog.getByRole("alert")).toHaveText(CANCEL_MESSAGE);
    expect(await userExists(user.userId)).toBe(true);
    expect(await cancelCalls(user.subscription!)).toHaveLength(0);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    expect(await userExists(user.userId)).toBe(false);
  });

  test("M4-34 a Free account with no Stripe customer is deleted without any Stripe call", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "dd-free" });
    const before = (await stubRequests()).length;
    await confirmDelete(page, user.handle);
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);
    expect(await userExists(user.userId)).toBe(false);
    // Another worker's test may be talking to the stub meanwhile: none of it names this account.
    const mine = (await stubRequests())
      .slice(before)
      .filter((request) => JSON.stringify(request).includes(user.userId));
    expect(mine).toEqual([]);
  });
});

test.describe("M4-34 abuse", () => {
  test("M4-34 the action deletes only the session user: another account's ids and customer in the form cancel nothing for them", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const victimContext = await browser.newContext();
    const victim = await billingUser(victimContext, { label: "dx-victim", plan: "pro" });
    await victimContext.close();
    const me = await billingUser(context, { label: "dx-me", plan: "pro" });

    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill(me.handle);
    await page.evaluate(
      ({ id, customer, subscription }) => {
        const form = document.querySelector("dialog form")!;
        const fields: Record<string, string> = {
          id,
          userId: id,
          user_id: id,
          owner_id: id,
          customer,
          stripe_customer_id: customer,
          customerId: customer,
          subscription,
          handle: "x",
        };
        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
      },
      { id: victim.userId, customer: victim.customer!, subscription: victim.subscription! },
    );
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/^http:\/\/app\.localhost:3000\/login/);

    expect(await userExists(me.userId)).toBe(false);
    expect(await cancelCalls(me.subscription!)).toHaveLength(1);
    expect(await userExists(victim.userId)).toBe(true);
    expect(await cancelCalls(victim.subscription!)).toHaveLength(0);
    expect(await listCalls(victim.customer!)).toHaveLength(0);
    expect(await stubSubscriptionStatus(victim.subscription!)).toBe("active");
  });

  test("M4-34 a wrong confirmation is refused on the server before any Stripe call", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "dx-wrong", plan: "pro" });
    const dialog = await openDialog(page);
    await dialog.getByLabel("Type your handle to confirm").fill("not-my-handle");
    const confirm = dialog.getByRole("button", { name: "Delete account" });
    await expect(confirm).toBeDisabled();
    await confirm.evaluate((el) => ((el as HTMLButtonElement).disabled = false));
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText("doesn’t match");
    expect(await userExists(user.userId)).toBe(true);
    expect(await listCalls(user.customer!)).toHaveLength(0);
    expect(await cancelCalls(user.subscription!)).toHaveLength(0);
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("active");
  });

  test("M4-34 a replayed delete request without a session cancels nothing and calls no stub", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "a data flow: one viewport is enough");
    const user = await billingUser(context, { label: "dx-replay", plan: "pro" });
    await page.goto(settings());

    let recorded: { headers: Record<string, string>; body: string } | undefined;
    await page.route("**/settings", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        recorded = { headers: request.headers(), body: request.postData() ?? "" };
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.locator("main").getByRole("button", { name: "Delete account" }).click();
    const dialog = dialogOf(page);
    await dialog.getByLabel("Type your handle to confirm").fill(user.handle);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await expect.poll(() => recorded).toBeTruthy();
    await page.unroute("**/settings");

    const headers: Record<string, string> = {};
    for (const name of ["next-action", "content-type", "accept", "next-router-state-tree"]) {
      if (recorded!.headers[name]) headers[name] = recorded!.headers[name]!;
    }
    const response = await rawRequest("app.localhost:3000", "/settings", {
      method: "POST",
      headers: { ...headers, origin: "http://app.localhost:3000" },
      body: recorded!.body,
    });
    const location = String(response.headers.location ?? "");
    const actionRedirect = String(response.headers["x-action-redirect"] ?? "");
    expect(
      response.status === 401 || location.includes("/login") || actionRedirect.includes("/login"),
      `status ${response.status}, location "${location}", x-action-redirect "${actionRedirect}"`,
    ).toBe(true);
    expect(await userExists(user.userId)).toBe(true);
    expect(await listCalls(user.customer!)).toHaveLength(0);
    expect(await cancelCalls(user.subscription!)).toHaveLength(0);
    expect(await stubSubscriptionStatus(user.subscription!)).toBe("active");
  });
});
