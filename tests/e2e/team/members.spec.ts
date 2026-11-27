import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { expectControlsAtLeast44, openApp, studioOwner } from "./team-helpers";
import { signedInUser } from "../fixtures/data";

/**
 * M19-09 (smoke at 390 and 1440): the members screen for the current site's owner. Studio: the
 * invite form (16px input, 44px controls), the meter, the empty lists; Free and Pro: "Team access is
 * part of Studio." with See plans and no form. No horizontal scroll.
 */
test.afterAll(cleanupUsers);

test("M19-09 a Studio owner sees the invite form, the meter and the lists", async ({ context, page }) => {
  await studioOwner(context, "m19mem");
  await openApp(page, "/members");
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
  await expect(page.getByTestId("members-meter")).toHaveText("0 of 10 members and invites");
  const email = page.getByLabel("Email");
  await expect(email).toBeVisible();
  expect(await email.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  await expect(page.getByLabel("Role")).toHaveValue("editor");
  await expect(page.getByRole("button", { name: "Send invite" })).toBeEnabled();
  await expect(page.getByText("Only you work on this site.")).toBeVisible();
  await expectControlsAtLeast44(page, '[data-testid="members-screen"]');
  await expectNoHorizontalScroll(page);
});

test("M19-09 a Pro owner is told team access is part of Studio, with no form", async ({ context, page }) => {
  await signedInUser(context, { label: "m19pro", plan: "pro" });
  await openApp(page, "/members");
  await expect(page.getByText("Team access is part of Studio.")).toBeVisible();
  await expect(page.getByRole("link", { name: "See plans" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
