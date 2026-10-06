import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader, postgrest, restAs } from "../fixtures/http";
import {
  accessToken,
  css,
  emptyUser,
  expectDraft,
  MARA_EMAIL,
  openEditor,
  pageRow,
  seededUser,
  setDraft,
} from "./editor-helpers";
import { signInAs } from "../fixtures/auth";

/**
 * M2-03: the editor opens the current page's draft, read with the signed-in user's own session.
 * Phone project = 390x844, desktop = 1440x900.
 */

test.afterAll(cleanupUsers);

// M7-05: the header bar is the workspace's pinned toolbar. The page's address is the mono line above
// its name, the name is the page's one h1 (the preview draws a heading of its own inside its frame).
const toolbar = (page: Page) => page.getByTestId("workspace-toolbar");
const addressLine = (page: Page, address: string) =>
  page
    .getByTestId("workspace")
    .getByText(address, { exact: true })
    .filter({ visible: true })
    .first();
const pageTitle = (page: Page) => page.locator("h1:not([data-page-frame] *)");

test.describe("M2-03 the editor opens the current page's draft", () => {
  test("M2-03 mara's current page renders: breadcrumb, h1, name, bio and the seeded blocks", async ({
    page,
    context,
  }) => {
    await signInAs(context, MARA_EMAIL);
    const response = await page.goto(url("app", "/editor"));
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Editor — HYDLNK");

    const header = page.getByTestId("workspace-toolbar");
    await expect(header.locator("p")).toHaveText("mara.hydlnk.com");
    await expect(header.getByRole("heading", { level: 1 })).toHaveText("Main page");
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Mara Okafor");
    await expect(page.getByLabel("Bio", { exact: true })).toHaveValue(
      "Portrait & studio photographer · Orlando, FL",
    );
    // Every seeded block is in the list, in page order.
    const ids = await page
      .locator("li[data-block-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
    expect(ids).toEqual([
      "Sx4kT9pLq2Wa",
      "Hd7mN3cYb8Ue",
      "Bt5rJ1fGz6Os",
      "Qw8vC2nKd4Ly",
      "Lc6hP0yRe3Zi",
      "Ym1gA5uVf7Tx",
      "Jn9bE4sXo2Mq",
      "Vk3wD8tHa5Pr",
      "Ge2zU7qNc9Fl",
      "Im4gB6kWs8Xz",
    ]);
    await expect(page.getByRole("heading", { name: "Blocks · 10" })).toBeVisible();
  });

  test("M2-03 the Editor link keeps aria-current='page' on the sidebar and the tab bar", async ({
    page,
    context,
  }) => {
    await seededUser(context);
    await openEditor(page);
    const current = page.locator("nav a[aria-current='page']:visible");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Editor");
  });

  test("M2-03 signed out: a redirect to the sign-in route and none of any draft text", async () => {
    const res = await appRaw("/editor");
    expect([302, 303, 307]).toContain(res.status);
    expect(new URL(res.location!, "http://app.localhost:3000").pathname).toBe("/login");
    for (const text of ["Mara Okafor", "Portrait", "Display name", "Bio"]) {
      expect(res.body).not.toContain(text);
    }
  });

  test("M2-03 cross-tenant: another user's page id in hl-page shows the user's own page; the API returns []", async ({
    page,
    context,
  }) => {
    const jonas = await emptyUser(context, "jonas", {
      draft: {
        version: 1,
        rev: 0,
        profile: { name: "Jonas Only", bio: "Jonas private bio", photo: null },
        theme: { ref: null, overrides: {} },
        blocks: [],
      },
    });
    const mara = await adminClient().from("pages").select("id").eq("handle", "mara").single();
    expect(mara.error).toBeNull();
    const maraId = mara.data!.id as string;

    await context.addCookies([{ name: "hl-page", value: maraId, url: url("app") }]);
    const cookies = cookieHeader(await authCookies(context));
    const raw = await appRaw("/editor", { cookie: `${cookies}; hl-page=${maraId}` });
    expect(raw.status).toBe(200);
    expect(raw.body).not.toContain("Mara Okafor");
    expect(raw.body).not.toContain("Portrait & studio");
    expect(raw.body).not.toContain("Portrait sessions");

    await openEditor(page);
    await expect(addressLine(page, `${jonas.handle}.hydlnk.com`)).toBeVisible();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Jonas Only");
    await expect(page.locator("body")).not.toContainText("Mara Okafor");

    const token = await accessToken(context);
    const direct = await postgrest(`pages?id=eq.${maraId}&select=id,draft`, token);
    expect(direct.status).toBe(200);
    expect(await direct.json()).toEqual([]);
  });

  test("M2-03 header bar (the toolbar, M7-05): mono address, 22px title, Preview menu and charcoal Publish", async ({
    page,
    context,
  }, info) => {
    const user = await seededUser(context);
    await openEditor(page);
    const crumb = addressLine(page, `${user.handle}.hydlnk.com`);
    await expect(crumb).toBeVisible();
    expect(await css(crumb, "font-size")).toBe("12px");
    expect(await css(crumb, "font-family")).toMatch(/Geist.?Mono/);
    expect(await css(crumb, "color")).toBe("rgb(94, 90, 84)");
    const h1 = pageTitle(page);
    await expect(h1).toHaveText("Main page");
    expect(await css(h1, "font-size")).toBe("22px");
    expect(await css(h1, "font-weight")).toBe("700");

    // M6-11: 'Preview your draft' (in the Preview menu from 760px up) opens the draft preview, not the live page.
    const menu = toolbar(page).getByRole("button", { name: "Preview", exact: true });
    if (phoneOnly(info)) {
      await expect(menu).toHaveCount(0);
    } else {
      await menu.click();
      const preview = page.getByRole("menuitem", { name: "Preview your draft" });
      await expect(preview).toHaveAttribute("href", `/preview/${user.pageId}`);
      await expect(preview).toHaveAttribute("target", "_blank");
      await expect(preview).toHaveAttribute("rel", "noopener");
      await page.keyboard.press("Escape");
    }

    const publish = toolbar(page).getByRole("button", { name: "Publish", exact: true });
    await expect(publish).toBeVisible();
    expect(await css(publish, "background-color")).toBe("rgb(28, 27, 26)");
    expect(await css(publish, "color")).toBe("rgb(255, 255, 255)");
  });

  test("M2-03 a page with an empty draft opens with defaults: name = handle, no bio, no blocks", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "def");
    const response = await page.goto(url("app", "/editor"));
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(user.handle);
    await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("");
    await expect(page.getByRole("heading", { name: "Blocks · 0" })).toBeVisible();
    await expect(page.getByText("No blocks yet. Add your first block above.")).toBeVisible();
    await expect(page.locator("li[data-block-id]")).toHaveCount(0);
    // What signup creates is a valid draft: no notice.
    await expect(page.getByText("Some content couldn’t be read")).toHaveCount(0);
    await expect(page.getByText("Application error")).toHaveCount(0);
    // Nothing was written by opening it.
    await page.waitForTimeout(1500);
    expect((await pageRow(user.pageId)).draft.rev).toBe(0);
  });

  test('M2-03 a corrupted draft ({} and {"blocks": 5}) loads repaired, shows the notice and writes nothing until an edit', async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "bad");
    const token = await accessToken(context);
    const NOTICE =
      "Some content couldn’t be read and was reset in the editor. Nothing is saved until you edit.";

    for (const corrupted of [{}, { blocks: 5 }]) {
      const patch = await restAs(token, `/pages?id=eq.${user.pageId}`, {
        method: "PATCH",
        body: { draft: corrupted },
      });
      expect(patch.status).toBe(200);

      const response = await page.goto(url("app", "/editor"));
      expect(response?.status()).toBe(200);
      await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(user.handle);
      await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("");
      await expect(page.getByRole("heading", { name: "Blocks · 0" })).toBeVisible();
      await expect(page.getByText(NOTICE)).toBeVisible();
      await page.waitForTimeout(1500);
      expect((await pageRow(user.pageId)).draft).toEqual(corrupted);
    }

    // The first edit saves a valid document over it (the stored draft had no rev: it becomes 1).
    await page.getByLabel("Display name", { exact: true }).fill("Repaired Name");
    const saved = await expectDraft(user.pageId, (d) => d.profile?.name === "Repaired Name");
    expect(saved).toMatchObject({ version: 1, rev: 1, blocks: [], profile: { bio: "" } });
    await expect(page.locator("[data-save-status]")).toHaveText("Saved");
  });

  test("M2-03 a draft whose rev is not a plain number still saves its first edit (no false stale-tab alert)", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "rev");
    const token = await accessToken(context);
    // The stale-tab guard filters on Postgres' own text of `draft->>'rev'`: for these values that
    // text is not what a JavaScript String() of the parsed JSON gives.
    const odd = [{ rev: {} }, { rev: [1, 2] }, { rev: 1.5 }, { rev: "abc" }, { rev: true }];
    for (const [index, corrupted] of odd.entries()) {
      const patch = await restAs(token, `/pages?id=eq.${user.pageId}`, {
        method: "PATCH",
        body: { draft: corrupted },
      });
      expect(patch.status).toBe(200);
      await page.goto(url("app", "/editor"));
      await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
      const name = `Odd rev ${index}`;
      await page.getByLabel("Display name", { exact: true }).fill(name);
      await expect(page.locator("[data-save-status]")).toHaveText("Saved");
      await expect(page.getByText("This page changed in another tab.")).toHaveCount(0);
      const saved = await expectDraft(user.pageId, (d) => d.profile?.name === name);
      expect(saved.rev).toBe(1);
    }
  });

  test("M2-03 phone: the pinned row holds Undo, Redo, the chip and Publish; every control is 44px, no sideways scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context);
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);

    const chip = (await page.locator("[data-publish-status]").boundingBox())!;
    const publish = (await toolbar(page).getByRole("button", { name: "Publish" }).boundingBox())!;
    expect(publish.height).toBeGreaterThanOrEqual(44);
    expect(chip.x + chip.width).toBeLessThanOrEqual(390);
    expect(publish.x + publish.width).toBeLessThanOrEqual(390);
    // The chip and Publish share the one short row.
    expect(Math.abs(chip.y + chip.height / 2 - (publish.y + publish.height / 2))).toBeLessThan(30);
  });

  test("M2-03 desktop: address and title left; chip, Preview and Publish on one row at the right", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context);
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    const title = (await pageTitle(page).boundingBox())!;
    const chip = (await page.locator("[data-publish-status]").boundingBox())!;
    const preview = (await toolbar(page)
      .getByRole("button", { name: "Preview", exact: true })
      .boundingBox())!;
    const publish = (await toolbar(page).getByRole("button", { name: "Publish" }).boundingBox())!;
    const mid = (b: { y: number; height: number }) => b.y + b.height / 2;
    for (const box of [chip, preview, publish]) {
      expect(Math.abs(mid(box) - mid(preview))).toBeLessThan(8);
      expect(box.x).toBeGreaterThan(title.x + title.width);
    }
    expect(chip.x + chip.width).toBeLessThanOrEqual(preview.x);
    expect(preview.x + preview.width).toBeLessThanOrEqual(publish.x);
    expect(publish.x + publish.width).toBeGreaterThan(1440 - 40 - 1);
    expect(publish.x + publish.width).toBeLessThanOrEqual(1440);
  });
});

test("M2-03 the draft is not changed by loading the editor twice", async ({ page, context }) => {
  const user = await seededUser(context, "nochg");
  const before = await pageRow(user.pageId);
  await openEditor(page);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  const after = await pageRow(user.pageId);
  expect(after.draft).toEqual(before.draft);
  expect(after.published).toEqual(before.published);
  void setDraft;
});
