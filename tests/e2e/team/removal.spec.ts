import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { url } from "../helpers";
import { memberOf, openApp, removeMember, signInMember, studioOwner } from "./team-helpers";

/**
 * M19-11 at 390 and 1440 (two contexts): with the member's tab open, the owner removes them. The
 * next autosave is refused and the tab says "You no longer have access to this site." instead of the
 * conflict notice; a reload lands on /claim (the member has no site of their own).
 */
test.afterAll(cleanupUsers);

test("M19-11 removal is immediate in an open tab", async ({ browser, context }) => {
  test.setTimeout(120_000);
  const owner = await studioOwner(context, "m19rm");
  const editor = await memberOf(owner, "editor", "m19rm-ed");
  const memberContext = await browser.newContext();
  await signInMember(memberContext, editor);
  const page = await memberContext.newPage();
  await openApp(page, "/editor");
  await expect(page.getByTestId("shared-site-banner")).toBeVisible();

  await removeMember(owner, editor);

  // The next edit's autosave (the profile is in the design draft) is refused.
  await page.getByLabel("Bio", { exact: true }).fill("Written after the removal");
  await expect(page.locator('[data-save-problem="lost-access"]')).toHaveText(
    /You no longer have access to this site\./,
    { timeout: 20_000 },
  );
  await page.reload();
  await expect(page).toHaveURL(url("app", "/claim"));
  await memberContext.close();
});
