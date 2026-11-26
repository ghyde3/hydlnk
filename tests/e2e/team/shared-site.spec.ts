import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { memberOf, openApp, signInMember, studioOwner } from "./team-helpers";

/**
 * M19-10 at 390 and 1440: working on a shared site. An account with no own site lands in it; the
 * owner is named; Analytics, Audience and Domains are absent and their URLs refuse; an editor sees
 * "Ask the owner or a publisher to publish." instead of a working Publish; share links are absent;
 * the switcher lists the site under "Shared with you" with Leave this site; /claim stays reachable.
 */
test.afterAll(cleanupUsers);

test("M19-10 an editor works on the shared site, without the owner's tools", async ({ browser, context }) => {
  test.setTimeout(120_000);
  const owner = await studioOwner(context, "m19sh");
  const editor = await memberOf(owner, "editor", "m19sh-ed");
  const memberContext = await browser.newContext();
  await signInMember(memberContext, editor);
  const page = await memberContext.newPage();

  await openApp(page, "/editor");
  await expect(page).toHaveURL(url("app", "/editor"));
  await expect(page.getByTestId("shared-site-banner")).toContainText(`Shared with you by ${owner.email}`);
  await expect(page.getByTestId("shared-site-banner")).toContainText("Ask the owner or a publisher to publish.");
  await expect(page.getByRole("link", { name: /Analytics|Stats/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audience" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Domains" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  for (const path of ["/analytics", "/audience", "/domains", "/members"]) {
    const response = await page.goto(url("app", path));
    expect(response?.status(), path).toBe(404);
  }
  const csv = await page.request.get(url("app", "/analytics/export?kind=summary"));
  expect(csv.status()).toBe(404);
  const audience = await page.request.get(url("app", "/audience/export?form=all"));
  expect(audience.status()).toBe(404);

  await openApp(page, "/share");
  await expect(page.getByTestId("shared-site-banner")).toBeVisible();
  await expect(page.locator("#preview-links")).toHaveCount(0);

  // The switcher: under "Shared with you", with Leave this site.
  await openApp(page, "/editor");
  await page.getByRole("button", { name: /Switch site/ }).first().click();
  await expect(page.getByText("Shared with you", { exact: true })).toBeVisible();
  await expect(page.locator("[data-shared-site]")).toContainText(`Owner: ${owner.email}`);
  await expect(page.getByRole("menuitem", { name: "Leave this site" })).toBeVisible();

  // No own site: the claim step is still open.
  await openApp(page, "/claim");
  await expect(page.getByRole("heading", { name: "Pick your handle" })).toBeVisible();
  await memberContext.close();
});
