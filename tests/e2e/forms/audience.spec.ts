import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { publishHome } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { draftOf, publishDocOf, userWithDraft } from "../m2/blocks-helpers";
import { CONTACT_ID, SIGNUP_ID, contactForm, recordRow, signupForm } from "./forms-helpers";

/**
 * M17-08, M17-09 and the notice of M17-02 at 390x844 and 1440x900: the Audience screen lists the
 * current site's submissions as text, filters, deletes one and all of a form, shows the month's meter
 * and the over-limit notice, exports CSV, and another account sees none of it, by URL or by export.
 */

async function siteWithForms(context: BrowserContext, label: string) {
  const blocks = [signupForm(), contactForm()];
  const user = await userWithDraft(context, label, (handle) => draftOf(handle, blocks));
  await publishHome(user.pageId, publishDocOf(blocks));
  return user;
}

const screen = (page: Page) => page.getByTestId("audience-screen");
const rows = (page: Page) => page.getByTestId("audience-row");

test("M17-08 the submissions of the site, as text, filtered, deleted; the meter; the nav", async ({
  page,
  context,
}, info) => {
  const a = await siteWithForms(context, "aud");
  expect(
    await recordRow(a.pageId, { blockId: SIGNUP_ID, kind: "signup", email: "one@example.test" }),
  ).toBe("stored");
  expect(
    await recordRow(a.pageId, { blockId: SIGNUP_ID, kind: "signup", email: "two@example.test" }),
  ).toBe("stored");
  expect(
    await recordRow(a.pageId, {
      blockId: CONTACT_ID,
      kind: "contact",
      email: "vera@example.test",
      name: '=HYPERLINK("http://evil.example","x")',
      message: "<script>alert(1)</script>",
    }),
  ).toBe("stored");

  await page.goto(url("app", "/audience"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audience");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId("audience-meter")).toHaveText("3 / 100 this month");
  await expect(page.getByTestId("audience-over-limit")).toHaveCount(0);
  await expect(page.getByTestId("audience-responsibility")).toHaveText(
    "These are details people sent you through your forms. You decide how to use them and you’re responsible for that.",
  );
  // Newest first, every value as text.
  await expect(rows(page).first()).toContainText("<script>alert(1)</script>");
  await expect(rows(page).first()).toContainText("Write to me · Home");
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss),
  ).toBeUndefined();
  await expect(screen(page).locator("script")).toHaveCount(0);
  // HYDLNK tokens only on this screen.
  expect(await screen(page).evaluate((el) => el.outerHTML.includes("--t-"))).toBe(false);

  // The layout: a stacked card on a phone, a table row from 760px.
  const display = await rows(page)
    .first()
    .evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe(info.project.name === "phone" ? "block" : "table-row");
  await expectTapTargets(page, '[data-testid="audience-screen"]');
  await expectNoHorizontalScroll(page);

  // The nav names Audience, current here.
  const nav =
    info.project.name === "phone"
      ? page.getByRole("navigation", { name: "App sections" })
      : page.getByRole("navigation", { name: "App" });
  await expect(nav.locator("a[aria-current='page']")).toHaveText("Audience");

  // Filter by form.
  await page.getByTestId("audience-filter").selectOption(SIGNUP_ID);
  await expect(page).toHaveURL(/\/audience\?form=formSignE2E1$/);
  await expect(rows(page)).toHaveCount(2);

  // Delete one; the month's count stays.
  await rows(page).first().getByTestId("audience-delete").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("audience-meter")).toHaveText("3 / 100 this month");

  // Delete all from this form, asked in a dialog; Cancel first does nothing.
  await page.getByTestId("audience-delete-all").click();
  const dialog = page.getByTestId("audience-delete-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId("audience-delete-all").click();
  await dialog.getByRole("button", { name: "Delete all" }).click();
  await expect(dialog).toBeHidden();
  await page.goto(url("app", "/audience"));
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("audience-meter")).toHaveText("3 / 100 this month");

  // The CSV of the site: the header, the one row left, the formula opened as text.
  const csv = await page.request.get(url("app", "/audience/export?form=all"));
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(csv.headers()["content-disposition"]).toMatch(
    new RegExp(`^attachment; filename="${a.handle}-audience-\\d{4}-\\d{2}-\\d{2}\\.csv"$`),
  );
  const body = await csv.text();
  expect(body.startsWith("﻿submitted_at,form,kind,email,name,message\r\n")).toBe(true);
  expect(body).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
  expect((await page.request.get(url("app", "/audience/export?form=../x"))).status()).toBe(400);
});

test("M17-08 / M17-09 another account sees none of it, by URL or by export", async ({
  page,
  context,
  browser,
}, info) => {
  test.skip(info.project.name === "phone", "one isolation pass is enough");
  const a = await siteWithForms(context, "auda");
  await recordRow(a.pageId, {
    blockId: CONTACT_ID,
    kind: "contact",
    email: "secret@example.test",
    name: "A's visitor",
    message: "for A only",
  });

  const otherContext = await browser.newContext();
  const b = await userWithDraft(otherContext, "audb");
  const other = await otherContext.newPage();
  for (const query of [
    "",
    `?form=${CONTACT_ID}`,
    `?form=${CONTACT_ID}&site=${a.pageId}&owner=${a.userId}`,
  ]) {
    await other.goto(url("app", `/audience${query}`));
    await expect(other.getByTestId("audience-empty")).toHaveText(
      "No submissions yet. Add a form block to collect sign-ups and messages.",
    );
    await expect(other.getByText("secret@example.test")).toHaveCount(0);
  }
  const exported = await other.request.get(
    url("app", `/audience/export?form=${CONTACT_ID}&site=${a.pageId}`),
  );
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toBe("﻿submitted_at,form,kind,email,name,message\r\n");
  expect(b.pageId).not.toBe(a.pageId);
  await otherContext.close();

  // A still sees their own.
  await page.goto(url("app", "/audience"));
  await expect(page.getByText("secret@example.test")).toBeVisible();
});

test("M17-02 over the month's limit: the notice with the numbers of the plan", async ({
  page,
  context,
}) => {
  const a = await siteWithForms(context, "audl");
  const seed = Array.from({ length: 100 }, (_, i) => ({
    site_id: a.pageId,
    block_id: SIGNUP_ID,
    kind: "signup",
    email: `seed${i}@example.test`,
    visitor_hash: "e".repeat(64),
  }));
  const inserted = await adminClient().from("form_submissions").insert(seed);
  expect(inserted.error).toBeNull();
  expect(
    await recordRow(a.pageId, { blockId: SIGNUP_ID, kind: "signup", email: "late1@example.test" }),
  ).toBe("over_limit_first");
  expect(
    await recordRow(a.pageId, { blockId: SIGNUP_ID, kind: "signup", email: "late2@example.test" }),
  ).toBe("over_limit");
  await page.goto(url("app", "/audience"));
  await expect(page.getByTestId("audience-meter")).toHaveText("100 / 100 this month");
  await expect(page.getByTestId("audience-over-limit")).toHaveText(
    "You’ve reached this month’s limit of 100 form submissions on Free. 2 were not saved. Upgrade to keep more, or wait until the 1st.",
  );
  await expect(page.getByTestId("audience-pager")).toContainText("Page 1 of 2");
  await expect(rows(page)).toHaveCount(50);
  await expectNoHorizontalScroll(page);
});

test("M17-08 a site with no submissions shows the empty state", async ({ page, context }) => {
  await userWithDraft(context, "aude");
  await page.goto(url("app", "/audience"));
  await expect(page.getByTestId("audience-empty")).toHaveText(
    "No submissions yet. Add a form block to collect sign-ups and messages.",
  );
  await expect(page.getByTestId("audience-meter")).toHaveText("0 / 100 this month");
  await expectNoHorizontalScroll(page);
});
