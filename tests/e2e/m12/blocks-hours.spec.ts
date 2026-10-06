import { expect, test } from "@playwright/test";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  addBlock,
  box,
  expectDraft,
  openEditor,
  previewScreen,
  showView,
  userWithDraft,
} from "../m2/blocks-helpers";
import { publishFromEditor, settled } from "../m9/blocks-fcd-helpers";

/**
 * M12-02 on a real page: an hours block added in the editor (Monday 22:00 to 02:00, Tuesday closed,
 * New York), published, and drawn by the live page as a table that is the same for every visitor.
 * With a fixed browser clock the tenant script marks today and says "Open now" or "Closed now" in
 * the block's time zone; with JavaScript off the table is complete and nothing is marked.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

test("M12-02 M12-11 add an hours block, publish it, and see the table and Open now or Closed now with a fixed clock; without JavaScript no day is marked", async ({
  page,
  context,
  browser,
}) => {
  const user = await userWithDraft(context, "hr1");
  await openEditor(page);
  const { row, panel, id } = await addBlock(page, "hours");
  await expect(row).toContainText("Opening hours");

  await expect(panel.getByLabel("Time zone")).toHaveValue("America/New_York");
  const monday = panel.getByRole("group", { name: "Monday", exact: true });
  await monday.getByLabel("Monday opens").fill("22:00");
  await monday.getByLabel("Monday closes").fill("02:00");
  await expect(monday.getByText("Closes after midnight, the next day.")).toBeVisible();
  const tuesday = panel.getByRole("group", { name: "Tuesday", exact: true });
  await tuesday.getByRole("button", { name: "Tuesday closed" }).click();
  await expect(tuesday.getByLabel("Tuesday opens")).toHaveCount(0);
  // A second range on Friday.
  const friday = panel.getByRole("group", { name: "Friday", exact: true });
  await friday.getByRole("button", { name: "Add a time range" }).click();
  await expect(friday.getByLabel("Friday opens (2)")).toBeVisible();
  await panel.getByLabel("Note (optional)").fill("Closed on public holidays.");

  for (const control of await panel.locator("input, select, button").all()) {
    if (!(await control.isVisible())) continue;
    expect((await box(control)).height).toBeGreaterThanOrEqual(43.5);
  }
  await expectNoHorizontalScroll(page);
  await expectDraft(user.pageId, (draft) => {
    const block = draft.blocks.find((b) => b.id === id);
    return (
      block?.type === "hours" &&
      block.days.mon.ranges[0]!.open === "22:00" &&
      block.days.mon.ranges[0]!.close === "02:00" &&
      block.days.tue.closed === true &&
      block.days.fri.ranges.length === 2 &&
      block.note === "Closed on public holidays."
    );
  });

  await showView(page, "Preview");
  await expect(previewScreen(page).locator(`.pg-hours[data-block-id="${id}"] tr`)).toHaveCount(7);
  await showView(page, "Blocks");
  await publishFromEditor(page, user.pageId);

  // Monday 23:00 in New York (Tuesday 04:00Z): open on Monday's late range.
  const state = async (iso: string) => {
    const tab = await context.newPage();
    await tab.clock.install({ time: new Date(iso) });
    await tab.goto(url(user.handle));
    await settled(tab);
    return tab;
  };
  const open = await state("2026-01-06T04:00:00Z");
  const hours = open.locator(`.pg-hours[data-block-id="${id}"]`);
  await expect(hours.locator("tr")).toHaveCount(7);
  await expect(hours.locator(".pg-hours-status")).toHaveText("Open now");
  await expect(hours).toHaveAttribute("data-open", "true");
  await expect(hours.locator("[aria-current]")).toHaveCount(1);
  await expect(hours.locator("[aria-current] th")).toHaveText("Monday");
  await expect(hours.locator(".pg-hours-note")).toHaveText("Closed on public holidays.");
  await expect(hours.locator("tr").nth(1).locator("td")).toHaveText("Closed");
  await expect(hours.locator("tr").nth(0).locator("td")).toHaveText("22:00–02:00");
  await expectNoHorizontalScroll(open);
  await expectTapTargets(open, ".pg-hours");
  await open.close();

  // Tuesday 04:00 in New York (09:00Z): Monday's range has ended, and Tuesday is closed.
  const closed = await state("2026-01-06T09:00:00Z");
  const closedHours = closed.locator(`.pg-hours[data-block-id="${id}"]`);
  await expect(closedHours.locator(".pg-hours-status")).toHaveText("Closed now");
  await expect(closedHours).toHaveAttribute("data-open", "false");
  await expect(closedHours.locator("[aria-current] th")).toHaveText("Tuesday");
  await closed.close();

  // 01:00 Tuesday in New York is still Monday's late range, and the day is already Tuesday there.
  const late = await state("2026-01-06T06:00:00Z");
  await expect(late.locator(".pg-hours-status")).toHaveText("Open now");
  await expect(late.locator("[aria-current] th")).toHaveText("Tuesday");
  await late.close();

  // M12-11, without JavaScript: the whole table, no day marked (a cached page cannot know today in
  // the block's time zone), no status line.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const bare = await plain.newPage();
  await bare.goto(url(user.handle));
  const bareHours = bare.locator(`.pg-hours[data-block-id="${id}"]`);
  await expect(bareHours.locator("tr")).toHaveCount(7);
  await expect(bareHours.locator("[aria-current]")).toHaveCount(0);
  await expect(bareHours.locator(".pg-hours-status")).toBeHidden();
  await expect(bareHours).not.toHaveAttribute("data-open", /.*/);
  await plain.close();
});
