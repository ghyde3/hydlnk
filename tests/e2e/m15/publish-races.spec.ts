import { expect, test, type Page } from "@playwright/test";
import { cleanupUsers, rand } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { emptyUser, openEditor, pageRow, reloadEditor, statusChip } from "../m2/editor-helpers";
import { PUBLISH_CONFLICT_MESSAGE } from "@/components/workspace/publish-note";
import { STALE_MESSAGE } from "@/lib/editor/messages";
import { adminClient } from "../fixtures/auth";
import { editSubPageHeader, entry, seedEntries } from "./entry-helpers";
import { DEV_PORT } from "../helpers";

/**
 * M15-10: editing while a publish is still out. A save and a publish of the same entry never overlap:
 * Publish stores the pending edits, then the save queues it covers WAIT until its answer is in, and
 * only then send what was typed meanwhile, with the revs the publish answered. Typing is never
 * blocked. The timing is forced with route interception: the answer of the Server Action (or the
 * request itself) is held in the browser while the test types.
 *
 *   - Publish page (a sub-page, Home): the edit typed meanwhile is stored after the answer, the page
 *     reads "Unpublished changes" and nothing says it changed in another tab;
 *   - A3: a publish that moves the entry's rev (a page the content move rewrote) loses no edit;
 *   - A4: this tab's own autosave cannot land before a Publish all changes whose request is still on
 *     its way, so there is no false "changed somewhere else";
 *   - A5: after Publish all changes only the page typed on meanwhile reads "Unpublished changes";
 *   - A2: the editor adopts the revs the publish answered and reads none on its own, so a write by
 *     someone else right after the publish is a conflict on the next save, never an overwrite.
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

/**
 * Holds every Server Action REQUEST in the browser from now on: nothing reaches the server until
 * `release()`.
 */
async function holdActionRequests(page: Page) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let seen = 0;
  await page.route(
    () => true,
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || request.headers()["next-action"] === undefined) {
        return route.fallback();
      }
      seen += 1;
      await gate;
      await route.fallback();
    },
  );
  return {
    /** How many actions the browser has tried to send. */
    seen: () => seen,
    release: async () => {
      open();
      await page.unrouteAll({ behavior: "wait" });
    },
  };
}

/** Longer than the autosave debounce (800 ms) and a round trip: a save that was going to be sent has been. */
const PAST_THE_DEBOUNCE_MS = 2_500;

async function publishAllOnce(page: Page): Promise<void> {
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
}

/** Opens the sub-page's header field without typing. */
async function openSubPageHeader(page: Page): Promise<void> {
  await page.getByTestId("page-row").filter({ hasText: "Gallery" }).click();
  const block = page.locator("li[data-block-id]").first();
  await expect(block).toBeVisible();
  if ((await page.locator('[data-field="text"]').count()) === 0) await block.click();
  await expect(page.locator('[data-field="text"]').first()).toBeVisible();
}

async function editHomeLabel(page: Page, text: string) {
  await page.getByTestId("page-row").filter({ hasText: "Home" }).click();
  const link = page.locator('li[data-block-id="lnk-aaaaaaaa"]');
  await expect(link).toBeVisible();
  if ((await page.locator('[data-field="label"]').count()) === 0) await link.click();
  await page.locator('[data-field="label"]').first().fill(text);
}

const blocksOf = async (id: string) => JSON.stringify((await entry(id)).draft.blocks);

test("M15-10 an edit during Publish page of a sub-page waits for the answer, is stored, and the row is not Live", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const [one, two, three] = [`One ${mark}`, `Two ${mark}`, `Three ${mark}`];
  const user = await emptyUser(context, "race", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);
  const host = `${user.handle}.localhost:${DEV_PORT}`;

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

  // Type again while the bar waits (the field is still open under it; `fill` needs no click). The
  // edit is taken and WAITS: no save of this page is sent while its publish is out.
  await page.locator('[data-field="text"]').first().fill(two);
  await expect(page.locator('[data-field="text"]').first()).toHaveValue(two);
  await page.waitForTimeout(PAST_THE_DEBOUNCE_MS);
  expect(await blocksOf(subId)).not.toContain(two);
  expect((await entry(subId)).rev).toBe(sent);

  // The answer arrives: now the edit is stored, on top of the rev the publish left.
  await held.release();
  await expect.poll(() => blocksOf(subId), { timeout: 20_000 }).toContain(two);
  expect((await entry(subId)).rev).toBeGreaterThan(sent);
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

test("M15-10 an edit during Publish page of Home waits for the answer and is stored", async ({
  page,
  context,
}) => {
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

  // The edit waits for the publish's answer, then it is stored.
  await page.locator('[data-field="label"]').first().fill(two);
  await page.waitForTimeout(PAST_THE_DEBOUNCE_MS);
  expect(await blocksOf(homeId)).not.toContain(two);
  expect((await entry(homeId)).rev).toBe(sent);

  await held.release();
  await expect.poll(() => blocksOf(homeId), { timeout: 20_000 }).toContain(two);
  expect((await entry(homeId)).rev).toBeGreaterThan(sent);
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

test("M15-10 A3: Publish page moves the page's rev while an edit waits, and the edit is not lost", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const [moved, two] = [`Moved ${mark}`, `Two ${mark}`];
  const user = await emptyUser(context, "race", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);

  await openEditor(page);
  await publishAllOnce(page);

  // A page as the content move leaves a rewritten one: its revision at the current rev is not its
  // draft. Publishing it moves the entry's rev by one without changing the draft.
  const before = (await entry(subId)).rev;
  const rewritten = await adminClient()
    .from("content_entries")
    .update({
      draft: {
        path: "gallery",
        title: "Gallery",
        description: "",
        blocks: [{ id: "hdr-aaaaaaaa", type: "header", visible: true, text: moved }],
      } as never,
    })
    .eq("id", subId);
  expect(rewritten.error).toBeNull();
  expect((await entry(subId)).rev).toBe(before);
  await reloadEditor(page);
  await openSubPageHeader(page);

  await openBar(page);
  const held = await holdActionAnswers(page);
  await row(page, subId).getByRole("button", { name: "Publish page", exact: true }).click();
  await expect.poll(() => held.answered(), { timeout: 30_000 }).toBeGreaterThan(0);
  // The publish is in the database and it moved the rev; the editor does not know yet.
  expect((await entry(subId)).rev).toBe(before + 1);

  await page.locator('[data-field="text"]').first().fill(two);
  await page.waitForTimeout(PAST_THE_DEBOUNCE_MS);
  // Nothing was sent with the rev from before: no refusal, no notice, the edit waits.
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  expect(await blocksOf(subId)).not.toContain(two);

  await held.release();
  // The edit goes with the rev the publish answered, and is stored.
  await expect.poll(() => blocksOf(subId), { timeout: 20_000 }).toContain(two);
  expect((await entry(subId)).rev).toBe(before + 2);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await openBar(page);
  await expect(row(page, subId)).toHaveAttribute("data-state", "changed");
});

test("M15-10 A4, A5: typing while Publish all changes is out makes no conflict, and only that page reads Unpublished changes", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const [one, two, label] = [`One ${mark}`, `Two ${mark}`, `Label ${mark}`];
  const user = await emptyUser(context, "race", { plan: "pro" });
  const { homeId, subId } = await seedEntries(user.pageId);
  const host = `${user.handle}.localhost:${DEV_PORT}`;

  await openEditor(page);
  await publishAllOnce(page);

  // Both pages have something to publish.
  await editHomeLabel(page, label);
  await expect.poll(() => blocksOf(homeId)).toContain(label);
  await editSubPageHeader(page, one);
  await expect.poll(() => blocksOf(subId)).toContain(one);
  await expect(statusChip(page)).toHaveText("Unpublished changes");

  // Publish all changes, its REQUEST held in the browser: the server has not seen it yet.
  const held = await holdActionRequests(page);
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect.poll(() => held.seen(), { timeout: 30_000 }).toBeGreaterThan(0);

  // Typed on the sub-page meanwhile. Its autosave must not land first: the publish is checked
  // against the revs this tab held when it was sent.
  const sent = (await entry(subId)).rev;
  await page.locator('[data-field="text"]').first().fill(two);
  await page.waitForTimeout(PAST_THE_DEBOUNCE_MS);
  expect(await blocksOf(subId)).not.toContain(two);
  expect((await entry(subId)).rev).toBe(sent);

  await held.release();
  // Published, with no "changed somewhere else"; then the edit typed meanwhile is stored.
  await expect
    .poll(async () => (await rawRequest(host, "/gallery")).body.includes(one), { timeout: 30_000 })
    .toBe(true);
  await expect(page.getByText(PUBLISH_CONFLICT_MESSAGE)).toHaveCount(0);
  await expect.poll(() => blocksOf(subId), { timeout: 20_000 }).toContain(two);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  expect((await rawRequest(host, "/gallery")).body).not.toContain(two);
  expect((await rawRequest(host, "/")).body).toContain(label);

  // What went live is "One": the sub-page has unpublished changes, Home and the design are live.
  await expect(statusChip(page)).toHaveText("Unpublished changes");
  await openBar(page);
  await expect(row(page, subId)).toHaveAttribute("data-state", "changed");
  await expect(row(page, "home")).toHaveAttribute("data-state", "live");
  await expect(row(page, "design")).toHaveAttribute("data-state", "live");
});

test("M15-10 A2: a write by someone else right after Publish all changes is a conflict on the next save, not an overwrite", async ({
  page,
  context,
}) => {
  const mark = rand(5);
  const [foreign, mine] = [`Foreign ${mark}`, `Mine ${mark}`];
  const user = await emptyUser(context, "race", { plan: "pro" });
  const { subId } = await seedEntries(user.pageId);

  await openEditor(page);

  // Every read of the entries' revs by the browser is held from here on. The editor must make none
  // after a publish: such a read is unlocked, and what it finds may be another writer's rev.
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let revReads = 0;
  await page.route(/\/rest\/v1\/content_entries\?.*select=id(%2C|,)rev/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    revReads += 1;
    await gate;
    await route.fallback();
  });

  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
    { timeout: 30_000 },
  );
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  // The publish is done once its answer starts and the site reads live in the database: Next.js
  // sends an action's headers after the action ran. Not `response.finished()`: the body goes on
  // with the re-rendered /editor tree and ends only when the server's pending cache work does,
  // which the editor does not wait for (on CI's production build it did not end in three minutes).
  expect((await answered).status()).toBe(200);
  await expect
    .poll(async () => (await pageRow(user.pageId)).published_at, { timeout: 30_000 })
    .not.toBeNull();
  // Time for the editor to take the answer, and for a read it might still make after it to be sent
  // (and held). A read made later than this is held and counted all the same.
  await page.waitForTimeout(1_000);

  // Another writer (an MCP tool) saves the sub-page: a new draft at the next rev.
  const before = (await entry(subId)).rev;
  const other = await adminClient()
    .from("content_entries")
    .update({
      rev: before + 1,
      draft: {
        path: "gallery",
        title: "Gallery",
        description: "",
        blocks: [{ id: "hdr-aaaaaaaa", type: "header", visible: true, text: foreign }],
      } as never,
    })
    .eq("id", subId);
  expect(other.error).toBeNull();

  open();
  await page.unrouteAll({ behavior: "wait" });
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });
  expect(revReads).toBe(0);

  // The next keystroke on that page: refused, said so, and the other writer's draft stands.
  await editSubPageHeader(page, mine);
  await expect(page.getByText(STALE_MESSAGE)).toBeVisible({ timeout: 20_000 });
  expect(await blocksOf(subId)).toContain(foreign);
  expect(await blocksOf(subId)).not.toContain(mine);
  expect((await entry(subId)).rev).toBe(before + 1);
});
