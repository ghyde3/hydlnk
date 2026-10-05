import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { emptyUser, openEditor, pageRow, previewScreen } from "../m2/editor-helpers";

/**
 * M11-08 (the editor: the pages of a site), M11-07 step 3 (the page link's form) and the Free limit.
 * Every test makes its own user and site; mara's rows are never touched. One flow runs at both
 * viewports (phone 390x844 and desktop 1440x900): add two pages, rename, reorder, hide one from the
 * menu, delete one, hit the Free limit, with no sideways scroll and 44px targets on the way.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

interface SubRow {
  id: string;
  draft: {
    path: string;
    title: string;
    description: string;
    blocks: Array<Record<string, unknown>>;
  };
}

async function subPages(siteId: string): Promise<SubRow[]> {
  const { data, error } = await adminClient()
    .from("site_pages")
    .select("id, draft, created_at")
    .eq("page_id", siteId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data as unknown as SubRow[];
}

async function navItems(siteId: string): Promise<string[]> {
  const { draft } = await pageRow(siteId);
  return (draft as { nav?: { items?: string[] } }).nav?.items ?? [];
}

const rowsOf = (page: Page) => page.getByTestId("page-row");
const rowTitled = (page: Page, title: string) =>
  page.getByTestId("page-row").filter({ hasText: title });

async function addPage(page: Page, title: string, path?: string) {
  await page.getByTestId("add-page").click();
  const form = page.getByTestId("add-page-form");
  await form.locator('[data-field="new-page-title"]').fill(title);
  if (path !== undefined) await form.locator('[data-field="new-page-path"]').fill(path);
  await form.getByTestId("add-page-submit").click();
  await expect(rowTitled(page, title)).toBeVisible();
}

test("M11-08 add, rename, reorder, hide, delete and the Free limit", async ({ page, context }) => {
  const user = await emptyUser(context, "pgs");
  await openEditor(page);

  // The list: Home only, at first. Home is the open page.
  await expect(page.getByTestId("pages-card")).toBeVisible();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(rowsOf(page).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("pages-count")).toHaveText("1 of 3 pages");

  // Add page: the path follows the title, and is checked as it is typed.
  await page.getByTestId("add-page").click();
  const form = page.getByTestId("add-page-form");
  const titleInput = form.locator('[data-field="new-page-title"]');
  const pathInput = form.locator('[data-field="new-page-path"]');
  await titleInput.fill("Our Menu");
  await expect(pathInput).toHaveValue("our-menu");
  await pathInput.fill("og");
  await expect(form).toContainText("That path is reserved");
  await expect(form.getByTestId("add-page-submit")).toBeDisabled();
  await pathInput.fill("Bad Path");
  await expect(form).toContainText("Use 1 to 40 lowercase letters");
  await pathInput.fill("menu");
  await expect(form.getByTestId("add-page-submit")).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="pages-card"]');
  await form.getByTestId("add-page-submit").click();

  // The new page is open, exists in the database and joined the menu.
  await expect(rowTitled(page, "Our Menu")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("page-settings")).toBeVisible();
  await expect.poll(async () => (await subPages(user.pageId)).length).toBe(1);
  expect((await subPages(user.pageId))[0]!.draft).toMatchObject({
    path: "menu",
    title: "Our Menu",
  });
  const first = (await subPages(user.pageId))[0]!.id;
  await expect.poll(() => navItems(user.pageId)).toEqual([first]);

  // A second page, with the suggested path.
  await addPage(page, "Hours");
  await expect.poll(async () => (await subPages(user.pageId)).length).toBe(2);
  const second = (await subPages(user.pageId))[1]!;
  expect(second.draft.path).toBe("hours");
  await expect.poll(() => navItems(user.pageId)).toEqual([first, second.id]);
  await expect(rowsOf(page)).toHaveCount(3);
  await expect(page.getByTestId("pages-count")).toHaveText("3 of 3 pages");

  // At the Free limit Add page gives way to the message and an upgrade link; the server refuses too.
  await expect(page.getByTestId("add-page")).toHaveCount(0);
  const note = page.getByTestId("page-limit-note");
  await expect(note).toContainText(
    "Free includes 3 pages per site, Home and 2 more. Pro includes 10.",
  );
  await expect(note.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
    "href",
    "/settings#plans",
  );
  const refused = await page.evaluate(async (siteId) => {
    const response = await fetch(`/api/pages/${siteId}/sub-pages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return response.status;
  }, user.pageId);
  expect(refused).toBe(403);
  expect(await subPages(user.pageId)).toHaveLength(2);

  // Rename (the open page is Hours): the title is draft, saved as you type.
  await page.locator('[data-field="page-title"]').fill("Opening hours");
  await expect(rowTitled(page, "Opening hours")).toBeVisible();
  await expect
    .poll(async () => (await subPages(user.pageId))[1]!.draft.title)
    .toBe("Opening hours");
  await page.locator('[data-field="page-description"]').fill("When we are open.");
  await expect
    .poll(async () => (await subPages(user.pageId))[1]!.draft.description)
    .toBe("When we are open.");

  // Edit the path: a path another page holds is refused live.
  await page.locator('[data-field="page-path"]').fill("menu");
  await expect(page.getByTestId("page-settings")).toContainText(
    "Another page of this site already uses that path.",
  );
  await page.locator('[data-field="page-path"]').fill("open");
  await expect(page.getByTestId("page-settings")).not.toContainText("already uses that path");
  await expect.poll(async () => (await subPages(user.pageId))[1]!.draft.path).toBe("open");

  // Reorder the menu: Hours moves up, ahead of Our Menu.
  await expect(page.getByTestId("menu-order")).toContainText("Menu place 2 of 2");
  await page.getByTestId("menu-up").click();
  await expect(page.getByTestId("menu-order")).toContainText("Menu place 1 of 2");
  await expect(rowsOf(page).nth(1)).toContainText("Opening hours");
  await expect.poll(() => navItems(user.pageId)).toEqual([second.id, first]);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="page-settings"]');

  // Hide Our Menu from the menu: it stays a page, outside the menu.
  await rowTitled(page, "Our Menu").click();
  await expect(page.locator('[data-field="page-title"]')).toHaveValue("Our Menu");
  await expect(page.getByTestId("page-in-menu")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("page-in-menu").click();
  await expect(page.getByTestId("page-in-menu")).toHaveAttribute("aria-pressed", "false");
  await expect(rowTitled(page, "Our Menu")).toContainText("Not in menu");
  await expect.poll(() => navItems(user.pageId)).toEqual([second.id]);

  // Delete it: the confirmation says the page leaves the live site now; delete is immediate.
  await page.getByTestId("delete-page").click();
  const dialog = page.getByTestId("delete-page-dialog");
  await expect(dialog).toContainText("leaves the live site now");
  await expectTapTargets(page, '[data-testid="delete-page-dialog"]');
  await dialog.getByTestId("delete-page-confirm").click();
  await expect(rowsOf(page)).toHaveCount(2);
  await expect(rowTitled(page, "Our Menu")).toHaveCount(0);
  expect(await subPages(user.pageId)).toHaveLength(1);
  expect(await navItems(user.pageId)).toEqual([second.id]);
  // Back to Home, and the limit message gives way to Add page again.
  await expect(rowsOf(page).first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("add-page")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("M11-08 a sub-page edits its blocks with the same builder and autosave, and the preview shows the menu", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pgb");
  await openEditor(page);
  await addPage(page, "Gallery");
  const sub = async () => (await subPages(user.pageId))[0]!;

  // Add a header block on the sub-page, type its text: it autosaves into site_pages, not into Home.
  await page.getByRole("button", { name: "Header", exact: true }).first().click();
  const text = page.locator('[data-field="text"]').first();
  await text.fill("Summer photos");
  await expect.poll(async () => (await sub()).draft.blocks.map((b) => b.type)).toEqual(["header"]);
  await expect.poll(async () => (await sub()).draft.blocks[0]?.text).toBe("Summer photos");
  expect((await pageRow(user.pageId)).draft.blocks).toHaveLength(0);

  // The preview draws the sub-page with the menu; a menu entry opens that page in the editor.
  if ((page.viewportSize()?.width ?? 1440) < 760) {
    await page.getByTestId("mini-phone").click();
  }
  const screen = previewScreen(page);
  await expect(screen.locator("h1.pg-pagetitle")).toHaveText("Gallery");
  await expect(screen.locator("nav.pg-menu")).toBeVisible();
  await expect(screen.getByText("Summer photos")).toBeVisible();
  await screen.locator("nav.pg-menu a", { hasText: "Home" }).click();
  if ((page.viewportSize()?.width ?? 1440) < 760) {
    await page.getByTestId("preview-sheet-close").click();
  }
  await expect(rowsOf(page).first()).toHaveAttribute("aria-current", "page");

  // Reload: the page and its block come back from the database.
  await page.reload();
  await expect(page.getByTestId("pages-card")).toBeVisible();
  await rowTitled(page, "Gallery").click();
  await expect(page.locator("li[data-block-id]").first()).toContainText("Summer photos");

  // Home's menu comes back with the draft: an edit to Home does not erase it from the database.
  const id = (await sub()).id;
  await expect.poll(() => navItems(user.pageId)).toEqual([id]);
  await rowsOf(page).first().click();
  await page.getByLabel("Display name", { exact: true }).fill("Renamed home");
  await expect
    .poll(async () => (await pageRow(user.pageId)).draft.profile.name)
    .toBe("Renamed home");
  expect(await navItems(user.pageId)).toEqual([id]);
});

test("M11-07 the page link block links to Home or a page of the site", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pgl");
  await openEditor(page);
  await addPage(page, "Contact us");
  await rowsOf(page).first().click();
  await expect(page.locator('[data-field="page-title"]')).toHaveCount(0);

  // The chip is there, the form lists Home and the site's pages by title.
  await page.getByRole("button", { name: "Page link", exact: true }).first().click();
  const target = page.locator('[data-field="target"]').first();
  await expect(target).toBeVisible();
  await expect(target.locator("option")).toHaveText(["Home", "Contact us"]);
  const sub = (await subPages(user.pageId))[0]!;
  await target.selectOption(sub.id);
  await page.locator('[data-field="label"]').first().fill("Get in touch");
  await expect
    .poll(async () => {
      const blocks = (await pageRow(user.pageId)).draft.blocks as unknown as Array<
        Record<string, unknown>
      >;
      return blocks.map((b) => [b.type, b.label, b.target]);
    })
    .toEqual([["page_link", "Get in touch", sub.id]]);
  await expectNoHorizontalScroll(page);
  await expectTapTargets(page, '[data-testid="block-list"], li[data-block-id]');
});

test("M11-05 a Publish that is refused for a sub-page opens that page and shows the error there", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "pge");
  await openEditor(page);
  await addPage(page, "Broken");
  // A link block with no address cannot be published.
  await page.getByRole("button", { name: "Link", exact: true }).first().click();
  await expect.poll(async () => (await subPages(user.pageId))[0]!.draft.blocks.length).toBe(1);
  await rowsOf(page).first().click();
  await expect(page.locator('[data-field="page-title"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  // The refused page is the one that opens, with its row marked and the error under the field.
  await expect(rowTitled(page, "Broken")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("page-needs-fix")).toBeVisible();
  await expect(page.locator("li[data-block-id]").first()).toContainText(/Add|link|address/i);
  expect(user.pageId).toBeTruthy();
});
