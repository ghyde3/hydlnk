import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { emptyUser, openEditor, statusChip } from "../m2/editor-helpers";
import { STALE_MESSAGE } from "@/lib/editor/messages";
import { editSubPageHeader, entry, seedEntries } from "./entry-helpers";

/**
 * M15-10: a save that lands while a Publish page is still answering. The timing is forced: the
 * publish runs on the server, and its answer is held in the browser (route interception) until the
 * next edit has been autosaved. Afterwards the editor must still hold the newer rev (the next edit is
 * stored, no "changed in another tab"), and the page must read "Unpublished changes": what is live is
 * the draft as it was published, not the one typed since.
 * Runs at phone 390x844 and desktop 1440x900; each run makes its own user and site.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

const bar = (page: Page) => page.getByTestId("publish-bar");
const row = (page: Page, key: string) => page.getByTestId(`publish-row-${key}`);

async function openBar(page: Page): Promise<void> {
  if (await bar(page).isVisible()) return;
  await page.getByTestId("publish-bar-toggle").click();
  await expect(bar(page)).toBeVisible();
}
async function closeBar(page: Page): Promise<void> {
  if (!(await bar(page).isVisible())) return;
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
}

/**
 * Holds the ANSWER of every Server Action (a POST with a `next-action` header) from now on: the
 * action runs on the server at once, the browser gets its answer only after `release()`.
 */
async function holdActionAnswers(page: Page) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let answered = 0;
  await page.route(
    () => true,
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || request.headers()["next-action"] === undefined) {
        return route.fallback();
      }
      const response = await route.fetch();
      answered += 1;
      await gate;
      await route.fulfill({ response });
    },
  );
  return {
    /** The server has answered at least one held action (its effect is in the database). */
    answered: () => answered,
    release: async () => {
      open();
      await page.unrouteAll({ behavior: "wait" });
    },
  };
}

async function editHomeLabel(page: Page, text: string) {
  await page.getByTestId("page-row").filter({ hasText: "Home" }).click();
  const link = page.locator('li[data-block-id="lnk-aaaaaaaa"]');
  await expect(link).toBeVisible();
  if ((await page.locator('[data-field="label"]').count()) === 0) await link.click();
  await page.locator('[data-field="label"]').first().fill(text);
}

const blocksOf = async (id: string) => JSON.stringify((await entry(id)).draft.blocks);

test("M15-10 a save during Publish page of a sub-page keeps its rev, and the row is not Live", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const [one, two, three] = [`One ${mark}`, `Two ${mark}`, `Three ${mark}`];
  const user = await emptyUser(context, "race", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);
  const host = `${user.handle}.localhost:3000`;

  await openEditor(page);
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });

  await editSubPageHeader(page, one);
  await expect.poll(() => blocksOf(subId)).toContain(one);
  const sent = (await entry(subId)).rev;

  // Publish page, its answer held.
  await openBar(page);
  const held = await holdActionAnswers(page);
  await row(page, subId).getByRole("button", { name: "Publish page", exact: true }).click();
  await expect.poll(() => held.answered(), { timeout: 30_000 }).toBeGreaterThan(0);

  // Type again while the bar waits (the field is still open under it; `fill` needs no click): the
  // autosave stores it and moves the entry on.
  await page.locator('[data-field="text"]').first().fill(two);
  await expect.poll(() => blocksOf(subId), { timeout: 20_000 }).toContain(two);
  expect((await entry(subId)).rev).toBeGreaterThan(sent);

  await held.release();
  await openBar(page);
  // What is live is "One"; the draft says "Two": the row must not read Live.
  await expect(row(page, subId).getByRole("button", { name: "Publish page" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(row(page, subId)).toHaveAttribute("data-state", "changed");
  await expect
    .poll(async () => (await rawRequest(host, "/gallery")).body.includes(one), { timeout: 30_000 })
    .toBe(true);
  expect((await rawRequest(host, "/gallery")).body).not.toContain(two);
  await closeBar(page);

  // Type once more: it is stored, and nothing says the page changed elsewhere.
  await editSubPageHeader(page, three);
  await expect.poll(() => blocksOf(subId), { timeout: 20_000 }).toContain(three);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
});

test("M15-10 a save during Publish page of Home keeps Home's rev", async ({ page, context }) => {
  const mark = rand(5);
  const [one, two, three] = [`One ${mark}`, `Two ${mark}`, `Three ${mark}`];
  const user = await emptyUser(context, "race", { plan: "pro" });
  const { homeId } = await seedEntries(user.pageId);

  await openEditor(page);
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });

  await editHomeLabel(page, one);
  await expect.poll(() => blocksOf(homeId)).toContain(one);
  const sent = (await entry(homeId)).rev;

  await openBar(page);
  const held = await holdActionAnswers(page);
  await row(page, "home").getByRole("button", { name: "Publish page", exact: true }).click();
  await expect.poll(() => held.answered(), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.locator('[data-field="label"]').first().fill(two);
  await expect.poll(() => blocksOf(homeId), { timeout: 20_000 }).toContain(two);
  expect((await entry(homeId)).rev).toBeGreaterThan(sent);

  await held.release();
  await openBar(page);
  await expect(row(page, "home").getByRole("button", { name: "Publish page" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(row(page, "home")).toHaveAttribute("data-state", "changed");
  await closeBar(page);

  await editHomeLabel(page, three);
  await expect.poll(() => blocksOf(homeId), { timeout: 20_000 }).toContain(three);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
});
