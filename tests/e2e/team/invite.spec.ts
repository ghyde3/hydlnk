import { expect, test } from "@playwright/test";
import { cleanupUsers, makeUser, signIn } from "../fixtures/data";
import { messagesTo, getMessage } from "../fixtures/mailpit";
import { expectNoHorizontalScroll, url } from "../helpers";
import { openApp, studioOwner } from "./team-helpers";

/**
 * M19-08 at 390 and 1440: the owner invites an address with a role; the link is shown once and
 * emailed (Mailpit); opened signed out it leads through sign-in and back with no return-URL
 * parameter; repeated GETs consume nothing; accepting is a POST and needs the invited address; a
 * used link gives one message; pending invites are listed and revocable.
 */
test.afterAll(cleanupUsers);

test("M19-08 invite, sign in from the link, accept once; another account and a used link are refused", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(120_000);
  await studioOwner(context, "m19inv");
  const invited = await makeUser("m19invited");
  const stranger = await makeUser("m19stranger");

  await openApp(page, "/members");
  await page.getByLabel("Email").fill(invited.email);
  await page.getByLabel("Role").selectOption("publisher");
  await page.getByRole("button", { name: "Send invite" }).click();
  const linkBox = page.getByLabel("Invite link");
  await expect(linkBox).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
  const link = await linkBox.inputValue();
  // Note 4a: the link's real response sends no Referer (the proxy's app headers used to replace the
  // route's no-referrer). A fresh context, so the owner's session gets no invite cookie.
  const probe = await browser.newContext();
  const raw = await probe.request.get(link, { maxRedirects: 0 });
  expect(raw.status()).toBe(303);
  expect(raw.headers()["referrer-policy"]).toBe("no-referrer");
  await probe.close();
  await expect(page.getByTestId("invites-list")).toContainText(invited.email.toLowerCase());
  await expect(page.getByTestId("invites-list")).toContainText("Publisher · Expires");
  await expectNoHorizontalScroll(page);

  // The email (local Mailpit): the same link, no site name.
  await expect.poll(async () => (await messagesTo(invited.email.toLowerCase())).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const [message] = await messagesTo(invited.email.toLowerCase());
  const full = (await getMessage(message!.ID)) as unknown as { Subject: string; Text: string; HTML: string };
  expect(full.Subject).toBe("You’re invited to work on a HYDLNK site");
  expect(full.Text).toContain(link);

  // Another account cannot use it.
  const other = await browser.newContext();
  await signIn(other, stranger.email);
  const otherPage = await other.newPage();
  await otherPage.goto(link);
  await expect(otherPage).toHaveURL(url("app", "/invite"));
  await otherPage.getByRole("button", { name: "Accept invite" }).click();
  await expect(otherPage.locator("p[role=alert]")).toHaveText(/This invite is for another email address/);
  await other.close();

  // Signed out: the link goes to /login with no query, the GETs consume nothing.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto(link);
  await expect(freshPage).toHaveURL(url("app", "/login"));
  await freshPage.goto(link);
  await expect(freshPage).toHaveURL(url("app", "/login"));
  await signIn(fresh, invited.email);
  await freshPage.goto(url("app", "/"));
  await expect(freshPage).toHaveURL(url("app", "/invite"));
  await expect(freshPage.getByRole("heading", { name: "Join a site" })).toBeVisible();
  await expectNoHorizontalScroll(freshPage);
  await freshPage.getByRole("button", { name: "Accept invite" }).click();
  await expect(freshPage).toHaveURL(url("app", "/editor"));
  await expect(freshPage.getByTestId("shared-site-banner")).toContainText("You’re a publisher.");

  // The link is used now.
  await freshPage.goto(link);
  await freshPage.getByRole("button", { name: "Accept invite" }).click();
  // One message (the dropped cookie re-renders the page as the link that doesn't work).
  await expect(freshPage.getByText(/expired, was revoked or was already used/)).toBeVisible();
  await fresh.close();

  // The owner sees the member, and no pending invite.
  await page.reload();
  await expect(page.getByTestId("members-list")).toContainText(invited.email.toLowerCase());
  await expect(page.getByTestId("invites-list")).toHaveCount(0);
});

test("M19-08 a pending invite is revoked from the members screen", async ({ context, page }) => {
  await studioOwner(context, "m19rev");
  await openApp(page, "/members");
  await page.getByLabel("Email").fill(`zq-revoke-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByTestId("invites-list")).toBeVisible();
  await page.getByTestId("invites-list").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByTestId("invites-list")).toHaveCount(0);
  await expect(page.getByTestId("members-meter")).toHaveText("0 of 10 members and invites");
});
