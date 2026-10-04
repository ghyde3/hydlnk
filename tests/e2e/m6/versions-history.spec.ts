import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { openEditor } from "../m2/editor-helpers";
import { clickTab } from "../m7/workspace-helpers";
import {
  EDITOR_URL,
  HISTORY_URL,
  allRows,
  css,
  makeVersions,
  openHistory,
  rowFor,
  trackActions,
  trackRest,
  versionRows,
} from "./versions-helpers";

/**
 * M6-50: the version history screen: the header link, the list, the preview (a bezel on desktop, a
 * full-screen sheet on a phone) and the locked, empty and failed states. The restore flow has its
 * own file (versions-restore.spec.ts).
 */

test.afterAll(cleanupUsers);

// One zone and one language for every time on screen: 16:11:03 UTC is 9:11 AM on the US west coast.
test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

const FIRST_AT = "2026-10-03T16:11:00.000Z";
const TIME_OF_THIRD = "Oct 3, 2026, 9:11 AM";

/**
 * M7-05 and M7-04 move the History link out of the editor header: from 760px it is the 'Version
 * history' item of the toolbar's '⋯' menu, on a phone the link of the Share tab's 'Version history'
 * card. Both are the same link, with the same Pro chip on a Free account.
 */
async function historyLink(page: Page, info: TestInfo): Promise<Locator> {
  if (desktopOnly(info)) {
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "More actions" })
      .click();
    return page.getByRole("menuitem", { name: /^Version history/ });
  }
  await clickTab(page, "Share");
  return page.getByRole("link", { name: /^Open version history/ });
}

test.describe("M6-50 the History link", () => {
  test("M6-50 the toolbar's menu (the Share tab on a phone) links to /editor/history on Pro, and Editor stays current", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "vh1", plan: "pro" });
    await page.goto(EDITOR_URL);
    await openEditor(page);
    const link = await historyLink(page, info);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/editor/history");
    expect(await link.evaluate((a) => (a as HTMLAnchorElement).href)).toBe(HISTORY_URL);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // no chip on a plan that has history
    await expect(link.locator("[data-history-pro-chip]")).toHaveCount(0);

    await link.click();
    await expect(page).toHaveURL(HISTORY_URL);
    await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
    const nav = desktopOnly(info)
      ? page.getByRole("navigation", { name: "App", exact: true })
      : page.getByRole("navigation", { name: "App sections" });
    await expect(nav.getByRole("link", { name: "Editor" })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
  });

  test("M6-50 a Free account sees the link with a brass-soft Pro chip, and it opens the locked card", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "vh2", plan: "free" });
    await page.goto(EDITOR_URL);
    await openEditor(page);
    const link = await historyLink(page, info);
    await expect(link).toBeVisible();
    const chip = link.locator("[data-history-pro-chip]");
    await expect(chip).toHaveText("Pro");
    expect(await css(chip, "background-color")).toBe("rgb(246, 238, 223)");
    expect(await css(chip, "color")).toBe("rgb(107, 82, 38)");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(HISTORY_URL);
    await expect(page.getByTestId("history-locked")).toBeVisible();
  });
});

test.describe("M6-50 the list", () => {
  test("M6-50 header, rows newest first, Live now on the live one, labels and the time in the viewer's zone", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vh3", plan: "pro" });
    const made = await makeVersions(user.pageId, 3, { firstAt: "2026-10-03T16:11:00.000Z" });
    await openHistory(page);

    const header = page.locator("main > header").first();
    await expect(header.locator("p")).toHaveText(`${user.handle}.hydlnk.com / history`);
    expect(await css(header.locator("p"), "font-size")).toBe("12px");
    await expect(header.getByRole("heading", { level: 1 })).toHaveText("Version history");
    const back = header.getByRole("link", { name: "Back to editor" });
    await expect(back).toHaveAttribute("href", "/editor");
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page).toHaveTitle(/Version history/);

    // newest first
    const names = await allRows(page).evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-version-no")),
    );
    expect(names).toEqual(["3", "2", "1"]);
    expect(made.map((m) => m.versionNo)).toEqual([1, 2, 3]);

    const third = rowFor(page, 3);
    await expect(third.getByText("Version 3", { exact: true })).toBeVisible();
    expect(await css(third.getByText("Version 3", { exact: true }), "font-size")).toBe("14px");
    expect(await css(third.getByText("Version 3", { exact: true }), "font-weight")).toBe("600");
    // the time, in the viewer's zone, mono 12px
    const time = third.locator("time");
    await expect(time).toHaveText(TIME_OF_THIRD);
    await expect(time).toHaveAttribute("datetime", /^2026-10-03T16:11:03/);
    expect(await css(time, "font-size")).toBe("12px");
    expect(await css(time, "font-family")).toMatch(/mono/i);

    // "Live now" on exactly one row: the one whose document is the page's current published document
    await expect(page.getByTestId("live-chip")).toHaveCount(1);
    await expect(third.getByTestId("live-chip")).toHaveText("Live now");
    expect(await css(third.getByTestId("live-chip"), "background-color")).toBe(
      "rgb(231, 243, 236)",
    );
    await expect(rowFor(page, 2).getByTestId("live-chip")).toHaveCount(0);

    // two buttons per row with the version in their names
    for (const n of [1, 2, 3]) {
      const row = rowFor(page, n);
      await expect(
        row.getByRole("button", { name: `Preview version ${n}`, exact: true }),
      ).toHaveText("Preview");
      await expect(
        row.getByRole("button", { name: `Restore version ${n}`, exact: true }),
      ).toHaveText("Restore");
    }
    await expectTapTargets(page, "li[data-testid=version-row]");
    await expectNoHorizontalScroll(page);
  });

  test("M6-50 a version that is not the live one has no chip, and republishing an older document moves it", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vh4", plan: "pro" });
    const made = await makeVersions(user.pageId, 2);
    // publish version 1's document again: it is the live one now (a third version)
    const rows = await versionRows(user.pageId);
    const { error } = await adminClient()
      .from("pages")
      .update({ published: rows[0]!.document as never, published_at: new Date().toISOString() })
      .eq("id", user.pageId);
    expect(error).toBeNull();
    expect(made).toHaveLength(2);
    await openHistory(page);
    await expect(allRows(page)).toHaveCount(3);
    // versions 1 and 3 hold the same document: both equal the live one, so both say Live now
    await expect(page.getByTestId("live-chip")).toHaveCount(2);
    await expect(rowFor(page, 2).getByTestId("live-chip")).toHaveCount(0);
  });

  test("M6-50 at most 25 rows are listed, newest first", async ({ page, context }, info) => {
    test.skip(
      !desktopOnly(info),
      "the list is the same on a phone; one project is enough for 27 publishes",
    );
    const user = await signedInUser(context, { label: "vh5", plan: "studio" });
    await makeVersions(user.pageId, 27);
    await openHistory(page);
    await expect(allRows(page)).toHaveCount(25);
    const numbers = await allRows(page).evaluateAll((rows) =>
      rows.map((row) => Number(row.getAttribute("data-version-no"))),
    );
    expect(numbers[0]).toBe(27);
    expect(numbers.at(-1)).toBe(3);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  test("M6-50 a Pro account with no versions yet sees the empty state", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "vh6", plan: "pro" });
    await page.goto(HISTORY_URL);
    await expect(page.getByTestId("history-empty")).toHaveText(
      "No versions yet. Each time you publish, that version is kept here.",
    );
    await expect(allRows(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M6-50 locked states", () => {
  async function expectLocked(page: Page, info: { project: { name: string } }) {
    const card = page.getByTestId("history-locked");
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("heading", { level: 2, name: "Version history comes with Pro" }),
    ).toBeVisible();
    await expect(card).toContainText(
      "Pro keeps your last 25 published versions, so you can look back and restore one.",
    );
    const plans = card.getByRole("link", { name: "See plans" });
    await expect(plans).toHaveAttribute("href", "/settings#plans");
    expect((await plans.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(allRows(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    if (phoneOnly(info as never)) {
      const width = (await plans.boundingBox())!.width;
      expect(width).toBeGreaterThan(300);
    }
  }

  test("M6-50 a Free account sees the locked card, and the screen asks for no versions and calls no action", async ({
    page,
    context,
  }, info) => {
    await signedInUser(context, { label: "vh7", plan: "free" });
    const rest = trackRest(page, "page_versions");
    const actions = trackActions(page);
    await page.goto(HISTORY_URL);
    await expectLocked(page, info);
    expect(rest).toHaveLength(0);
    expect(actions).toHaveLength(0);
    await page.getByTestId("history-locked").getByRole("link", { name: "See plans" }).click();
    await expect(page).toHaveURL(/\/settings#plans$/);
  });

  test("M6-50 a Pro account that was downgraded sees the locked card too, and its rows are kept", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "vh8", plan: "pro" });
    await makeVersions(user.pageId, 2);
    await adminClient().from("accounts").update({ plan: "free" }).eq("id", user.userId);
    await page.goto(HISTORY_URL);
    await expectLocked(page, info);
    expect(await versionRows(user.pageId)).toHaveLength(2);
    // and an upgrade shows them again with no data change
    await adminClient().from("accounts").update({ plan: "pro" }).eq("id", user.userId);
    await page.goto(HISTORY_URL);
    await expect(allRows(page)).toHaveCount(2);
  });

  test("M6-50 a downgrade while the screen is open turns it into the locked card on the next Preview", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vh9", plan: "pro" });
    await makeVersions(user.pageId, 2);
    await openHistory(page);
    await adminClient().from("accounts").update({ plan: "free" }).eq("id", user.userId);
    await rowFor(page, 2).getByRole("button", { name: "Preview version 2" }).click();
    await expect(page.getByTestId("history-locked")).toBeVisible();
    await expect(allRows(page)).toHaveCount(0);
  });
});

test.describe("M6-50 preview", () => {
  test("M6-50 Preview draws the version with its own tokens and fonts, announces it and writes nothing", async ({
    page,
    context,
  }, info) => {
    const user = await signedInUser(context, { label: "vh10", plan: "pro" });
    await makeVersions(user.pageId, 2, {
      firstAt: FIRST_AT,
      extra: (i, base) => ({
        tokens: {
          ...(base.tokens as Record<string, unknown>),
          bg: i === 1 ? "#112233" : "#445566",
          fontHeading: i === 1 ? "Lora" : "Playfair Display",
          fontBody: "Inter",
        },
      }),
    });
    await openHistory(page);
    const patches: string[] = [];
    page.on("request", (request) => {
      if (["PATCH", "PUT", "DELETE"].includes(request.method()))
        patches.push(`${request.method()} ${request.url()}`);
    });
    const actions = trackActions(page);
    const draftBefore = JSON.stringify(
      (await adminClient().from("pages").select("draft").eq("id", user.pageId).single()).data,
    );

    await rowFor(page, 1).getByRole("button", { name: "Preview version 1" }).click();

    if (desktopOnly(info)) {
      const column = page.getByTestId("history-preview");
      await expect(column.getByRole("heading", { name: "Version 1" })).toBeVisible();
      await expect(column.locator("time")).toHaveText("Oct 3, 2026, 9:11 AM");
      await expect(column.getByRole("status")).toHaveText("Previewing version 1.");
      await expect(column.getByTestId("version-bezel")).toBeVisible();
      const box = (await column.getByTestId("version-bezel").boundingBox())!;
      expect(Math.round(box.width)).toBe(310);
      expect(Math.round(box.height)).toBe(660);
      expect(Math.round((await column.boundingBox())!.width)).toBe(330);
      await expect(column.locator("[data-page-root]")).toBeVisible();
      expect(await css(column.locator("[data-page-root]"), "--t-bg")).toBe("#112233");
      // only that version's two families are requested
      const href = await column.locator("link[data-preview-fonts]").first().getAttribute("href");
      expect(href).toContain("family=Lora");
      expect(href).toContain("family=Inter");
      expect(href).not.toContain("Playfair");
      // another version replaces it
      await rowFor(page, 2).getByRole("button", { name: "Preview version 2" }).click();
      await expect(column.getByRole("heading", { name: "Version 2" })).toBeVisible();
      await expect(column.getByRole("status")).toHaveText("Previewing version 2.");
      expect(await css(column.locator("[data-page-root]"), "--t-bg")).toBe("#445566");
      expect(
        await column.locator("link[data-preview-fonts]").first().getAttribute("href"),
      ).toContain("Playfair");
    } else {
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("heading", { name: "Version 1" })).toBeVisible();
      await expect(sheet.getByRole("status")).toHaveText("Previewing version 1.");
      await expect(sheet.getByTestId("version-bezel")).toHaveCount(0);
      expect(await css(sheet.locator("[data-page-root]"), "--t-bg")).toBe("#112233");
    }
    // previewing reads: no PATCH, PUT or DELETE anywhere, and the draft is as it was
    expect(patches).toEqual([]);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(
      JSON.stringify(
        (await adminClient().from("pages").select("draft").eq("id", user.pageId).single()).data,
      ),
    ).toBe(draftBefore);
  });

  test("M6-50 images that are no longer stored are counted under the header (plural and singular)", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the line is the same in the sheet; one project is enough");
    const user = await signedInUser(context, { label: "vh11", plan: "pro" });
    const gone = (name: string) => ({
      path: `${user.userId}/${name}.webp`,
      width: 400,
      height: 400,
    });
    await makeVersions(user.pageId, 2, {
      extra: (i, base) => {
        const profile = base.profile as Record<string, unknown>;
        const blocks = [...(base.blocks as Record<string, unknown>[])];
        const card = blocks.findIndex((b) => b.type === "card");
        if (i === 2) blocks[card] = { ...blocks[card], image: gone("gone-card-img1") };
        return {
          profile: { ...profile, bio: `Bio ${i}`, photo: gone("gone-photo-001") },
          blocks,
        };
      },
    });
    await openHistory(page);
    const column = page.getByTestId("history-preview");
    await rowFor(page, 1).getByRole("button", { name: "Preview version 1" }).click();
    await expect(column.getByTestId("preview-missing")).toHaveText(
      "An image in this version is no longer stored.",
    );
    await rowFor(page, 2).getByRole("button", { name: "Preview version 2" }).click();
    await expect(column.getByTestId("preview-missing")).toHaveText(
      "2 images in this version are no longer stored.",
    );
  });

  test("M6-50 phone: Preview opens a full-screen sheet, the page behind does not scroll, Close returns focus", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the sheet is the phone layout");
    const user = await signedInUser(context, { label: "vh12", plan: "pro" });
    await makeVersions(user.pageId, 8);
    await openHistory(page);
    const opener = rowFor(page, 5).getByRole("button", { name: "Preview version 5" });
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(844 - 1);
    const close = sheet.getByRole("button", { name: "Close", exact: true });
    const restore = sheet.getByRole("button", { name: "Restore this version", exact: true });
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await restore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(sheet.locator("[data-page-root]")).toBeVisible();
    // the page at full width, no bezel
    expect(
      Math.round((await sheet.locator("[data-page-root]").boundingBox())!.width),
    ).toBeGreaterThanOrEqual(358);
    // the page behind does not scroll
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
      "hidden",
    );
    await expectNoHorizontalScroll(page);
    await close.click();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe(
      "hidden",
    );
  });

  test("M6-50 phone: Escape closes the sheet", async ({ page, context }, info) => {
    test.skip(!phoneOnly(info), "the sheet is the phone layout");
    const user = await signedInUser(context, { label: "vh13", plan: "pro" });
    await makeVersions(user.pageId, 2);
    await openHistory(page);
    await rowFor(page, 2).getByRole("button", { name: "Preview version 2" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("M6-50 layout", () => {
  test("M6-50 desktop: the list is the 720px column and the preview the sticky 330px column; the confirmation does not move it", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the two-column layout is the desktop one");
    const user = await signedInUser(context, { label: "vh14", plan: "pro" });
    await makeVersions(user.pageId, 12);
    await openHistory(page);
    expect(Math.round((await page.getByTestId("version-list").boundingBox())!.width)).toBe(720);
    await rowFor(page, 12).getByRole("button", { name: "Preview version 12" }).click();
    const column = page.getByTestId("history-preview");
    await expect(column.getByRole("heading", { name: "Version 12" })).toBeVisible();
    expect(Math.round((await column.boundingBox())!.width)).toBe(330);
    expect(await css(column, "position")).toBe("sticky");
    // sticky: scrolling the list keeps the column in view
    await rowFor(page, 1).scrollIntoViewIfNeeded();
    const scrolled = (await column.boundingBox())!;
    expect(scrolled.y).toBeGreaterThanOrEqual(0);
    expect(scrolled.y).toBeLessThan(40);

    // opening a confirmation inline does not move the preview
    await rowFor(page, 11).scrollIntoViewIfNeeded();
    const before = (await column.boundingBox())!;
    await rowFor(page, 11).getByRole("button", { name: "Restore version 11" }).click();
    const confirm = rowFor(page, 11).getByTestId("restore-confirm");
    await expect(confirm).toBeVisible();
    const after = (await column.boundingBox())!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.height).toBe(before.height);
    // inline: inside the row, under its buttons
    const rowBox = (await rowFor(page, 11).boundingBox())!;
    const confirmBox = (await confirm.boundingBox())!;
    expect(confirmBox.y).toBeGreaterThanOrEqual(rowBox.y);
    expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
  });

  test("M6-50 phone: the rows stack with Preview and Restore side by side, each at least 44px tall", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the stacked row is the phone layout");
    const user = await signedInUser(context, { label: "vh15", plan: "pro" });
    await makeVersions(user.pageId, 3);
    await openHistory(page);
    const row = rowFor(page, 3);
    const preview = (await row.getByRole("button", { name: "Preview version 3" }).boundingBox())!;
    const restore = (await row.getByRole("button", { name: "Restore version 3" }).boundingBox())!;
    expect(preview.height).toBeGreaterThanOrEqual(44);
    expect(restore.height).toBeGreaterThanOrEqual(44);
    // side by side: the same line, one after the other
    expect(Math.abs(preview.y - restore.y)).toBeLessThan(2);
    expect(restore.x).toBeGreaterThan(preview.x + preview.width - 1);
    // stacked under the name: the buttons are below the title and time
    const title = (await row.getByText("Version 3", { exact: true }).boundingBox())!;
    expect(preview.y).toBeGreaterThan(title.y + title.height - 1);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "li[data-testid=version-row]");
  });
});

test.describe("M6-50 failures and abuse", () => {
  test("M6-50 a list that cannot be read shows the card with Retry, and Retry reads it again", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vh16", plan: "pro" });
    await makeVersions(user.pageId, 2);
    await context.addCookies([{ name: "hl-fault", value: "versions-load", url: url("app", "/") }]);
    await page.goto(HISTORY_URL);
    const card = page.getByTestId("history-error");
    await expect(card).toBeVisible();
    await expect(card.getByRole("alert")).toHaveText("We couldn’t load your versions. Try again.");
    await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
    // no error text, no stack
    await expect(page.locator("body")).not.toContainText("Injected fault");
    await context.clearCookies({ name: "hl-fault" });
    await card.getByRole("button", { name: "Retry" }).click();
    await expect(allRows(page)).toHaveCount(2);
  });

  test("M6-50 signed out, the screen goes to sign in", async ({ page }) => {
    await page.goto(HISTORY_URL);
    await expect(page).toHaveURL(/\/login/);
  });

  test("M6-50 an hl-page cookie naming another user's page shows the signed-in user's own page", async ({
    page,
    context,
  }) => {
    const mine = await signedInUser(context, { label: "vh17", plan: "pro" });
    const theirs = await signedInUser(await page.context().browser()!.newContext(), {
      label: "vh18",
      plan: "pro",
    });
    await makeVersions(mine.pageId, 2, { label: "Mine" });
    await makeVersions(theirs.pageId, 3, { label: "Theirs" });
    await context.addCookies([{ name: "hl-page", value: theirs.pageId, url: url("app", "/") }]);
    await page.goto(HISTORY_URL);
    await expect(allRows(page)).toHaveCount(2);
    await expect(page.locator("main > header p")).toHaveText(`${mine.handle}.hydlnk.com / history`);
    await expect(page.locator("body")).not.toContainText(theirs.handle);
  });

  test("M6-50 the plan cards on Settings list Version history from the limits table", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "vh19", plan: "free" });
    await page.goto(url("app", "/settings"));
    const cell = (plan: string) =>
      page.locator(`[data-plan-card="${plan}"] [data-plan-feature="version-history"]`);
    await expect(cell("free")).toHaveText("Version history—");
    await expect(cell("pro")).toHaveText("Version historyLast 25 versions");
    await expect(cell("studio")).toHaveText("Version historyLast 25 versions");
  });

  test("M6-50 the pricing page lists Version history in the comparison and on the plan cards", async ({
    page,
  }) => {
    await page.goto(url(null, "/pricing"));
    const row = page.getByRole("row", { name: /^Version history/ });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-plan="Free"]')).toHaveText("—");
    await expect(row.locator('[data-plan="Pro"]')).toHaveText("Last 25 versions");
    await expect(row.locator('[data-plan="Studio"]')).toHaveText("Last 25 versions");
    // every other row is still on every plan: nothing else was added or removed from the table
    await expect(
      page.getByRole("row", { name: /^Blocks, themes and design options/ }),
    ).toContainText("All");
    await expectNoHorizontalScroll(page);
  });
});
