import { expect, test } from "@playwright/test";
import type { Block } from "@/lib/document";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { draftOf, expectDraft, openEditor, rowOf, userWithDraft } from "../m2/blocks-helpers";
import { expectTargets44 } from "../m16/posts-helpers";
import { SCHEDULE_TEST_IDS, fillLocal } from "./scheduling-helpers";

/**
 * M20-06 at 390x844 and 1440x900: a block's Schedule section. The browser runs in Europe/London so
 * the zone line and the stored UTC instant can be checked exactly (December: GMT, UTC+0).
 */

test.use({ timezoneId: "Europe/London" });
test.afterAll(cleanupUsers);

const LINK: Block = {
  id: "lnkSchedE2E01",
  type: "link",
  visible: true,
  label: "Tickets",
  url: "https://example.com/tickets",
} as Block;

/** Next year's 3 December and 24 December: always in the future, always GMT. */
const YEAR = new Date().getUTCFullYear() + 1;

test("M20-06 set a window on a link, reload: the times and the chip are still there", async ({ page, context }) => {
  const user = await userWithDraft(context, "m20blk", (handle) => draftOf(handle, [LINK]), { plan: "pro" });
  await openEditor(page);
  const row = rowOf(page, LINK.id);
  await row.getByRole("button", { expanded: false }).first().click();
  const section = row.getByTestId(SCHEDULE_TEST_IDS.blockSchedule);
  await section.getByRole("button", { name: /Schedule/ }).click();
  await expect(section.getByTestId(SCHEDULE_TEST_IDS.blockZone)).toHaveText("Times are in Europe/London, GMT+0.");

  await fillLocal(page, SCHEDULE_TEST_IDS.blockFrom, `${YEAR}-12-03T09:00`);
  await fillLocal(page, SCHEDULE_TEST_IDS.blockUntil, `${YEAR}-12-24T18:00`);
  await expect(row.getByTestId(SCHEDULE_TEST_IDS.blockChip)).toHaveText(`Starts 3 Dec ${YEAR}, 09:00`);
  await expectDraft(user.pageId, (draft) => {
    const block = (draft.blocks as Block[]).find((b) => b.id === LINK.id);
    return block?.schedule?.from === `${YEAR}-12-03T09:00:00Z` && block.schedule.until === `${YEAR}-12-24T18:00:00Z`;
  });
  const from = section.getByTestId(SCHEDULE_TEST_IDS.blockFrom);
  expect((await from.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await from.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  await expectTargets44(section);
  await expectNoHorizontalScroll(page);

  await page.reload();
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  await expect(rowOf(page, LINK.id).getByTestId(SCHEDULE_TEST_IDS.blockChip)).toHaveText(
    `Starts 3 Dec ${YEAR}, 09:00`,
  );
  await rowOf(page, LINK.id).getByRole("button", { expanded: false }).first().click();
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.blockFrom)).toHaveValue(`${YEAR}-12-03T09:00`);
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.blockUntil)).toHaveValue(`${YEAR}-12-24T18:00`);

  // "Show until" before "Show from": the field says so.
  await fillLocal(page, SCHEDULE_TEST_IDS.blockUntil, `${YEAR}-12-01T09:00`);
  await expect(page.getByText("“Show until” must be after “Show from”.")).toBeVisible();
  // Clear removes a time.
  await page.getByTestId(SCHEDULE_TEST_IDS.blockClear).nth(1).click();
  await expect(page.getByTestId(SCHEDULE_TEST_IDS.blockUntil)).toHaveValue("");
});

test("M20-06 on Free the section shows the plan notice and its controls are off", async ({ page, context }) => {
  await userWithDraft(context, "m20blkf", (handle) => draftOf(handle, [LINK]));
  await openEditor(page);
  const row = rowOf(page, LINK.id);
  await row.getByRole("button", { expanded: false }).first().click();
  const section = row.getByTestId(SCHEDULE_TEST_IDS.blockSchedule);
  await section.getByRole("button", { name: /Schedule/ }).click();
  await expect(section.getByTestId(SCHEDULE_TEST_IDS.blockUpgrade)).toContainText("Scheduling is part of Pro");
  await expect(section.getByRole("link", { name: "See plans" })).toBeVisible();
  await expect(section.getByTestId(SCHEDULE_TEST_IDS.blockFrom)).toBeDisabled();
  await expect(section.getByTestId(SCHEDULE_TEST_IDS.blockUntil)).toBeDisabled();
  await expectNoHorizontalScroll(page);
});
