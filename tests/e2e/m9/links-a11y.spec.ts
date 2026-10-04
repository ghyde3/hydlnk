import { expect, test } from "@playwright/test";
import { axeViolations } from "../fixtures/a11y";
import { cleanupUsers } from "../fixtures/data";
import { draftOf, userWithDraft } from "../m2/blocks-helpers";
import { openTab, publishButton } from "../m7/workspace-helpers";
import { docOf, link, livePage, startStub, type Stub } from "./links-helpers";

/**
 * M9-28, M9-29, M9-32 accessibility: axe-core finds no serious or critical violation on the Share
 * tab with the redirect card on, off, locked (Free) and with an error, with the tracking card filled
 * and invalid, and on the lock's interstitial (age and code, with and without an error), on both
 * viewports. Focus shows the 2px brass outline on the cards' controls.
 */

test.afterAll(async () => {
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

const A = "lnk-a11y-aaa01";
const B = "lnk-a11y-bbb02";
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "link",
  visible: true,
  label: `Link ${id.slice(-2)}`,
  url: `https://shop.example/${id.slice(-2)}`,
  ...extra,
});

test.describe("M9-32 the Share tab", () => {
  test("M9-32 axe finds nothing serious with the redirect card off, on, and with the tracking card holding an error", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "ax1", (h) => draftOf(h, [item(A), item(B)]), { plan: "pro" });
    await openTab(page, "Share");
    expect(await axeViolations(page), "card off").toEqual([]);

    await page.getByTestId("redirect-switch").click();
    await expect(page.getByTestId("redirect-warning")).toBeVisible();
    expect(await axeViolations(page), "card on").toEqual([]);

    await page.getByTestId("link-tracking-card").getByLabel("Source", { exact: true }).fill("a&b");
    await expect(
      page
        .getByTestId("link-tracking-card")
        .getByText("Use letters, numbers, spaces, dots, dashes and underscores."),
    ).toBeVisible();
    expect(await axeViolations(page), "tracking error").toEqual([]);
  });

  test("M9-32 axe finds nothing serious on a Free account's locked card, and with a Publish error under the switch", async ({
    page,
    context,
  }) => {
    await userWithDraft(
      context,
      "ax2",
      (h) => draftOf(h, [item(A)], { redirect: { linkId: A } } as never),
      { plan: "free" },
    );
    await openTab(page, "Share");
    expect(await axeViolations(page), "downgraded").toEqual([]);
    await publishButton(page).click();
    await expect(
      page
        .getByTestId("redirect-card")
        .getByText("Redirect mode is part of Pro. Upgrade to use it."),
    ).toBeVisible();
    expect(await axeViolations(page), "with the error").toEqual([]);
  });

  test("M9-32 the cards' controls show the 2px brass focus outline", async ({ page, context }) => {
    await userWithDraft(context, "ax3", (h) => draftOf(h, [item(A)]), { plan: "pro" });
    await openTab(page, "Share");
    for (const control of [
      page.getByTestId("redirect-switch"),
      page.getByTestId("link-tracking-card").getByLabel("Medium", { exact: true }),
    ]) {
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const outline = await control.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });
      expect(outline.style).not.toBe("none");
      expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
    }
  });
});

test.describe("M9-29 the interstitial", () => {
  let stub: Stub;
  test.beforeAll(async () => {
    stub = await startStub();
  });
  test.afterAll(async () => {
    await stub.close();
  });

  test("M9-29 axe finds nothing serious on the age and code interstitials, with and without an error", async ({
    page,
  }) => {
    const live = await livePage(
      "ax4",
      docOf([
        link("lnkage000001", stub.url("/a"), { lock: { kind: "age" } }),
        link("lnkcode00001", stub.url("/b"), {
          lock: { kind: "code", salt: "A".repeat(22), hash: "B".repeat(43) },
        }),
      ]),
    );
    await page.goto(`${live.origin}/r/${live.pageId}/lnkage000001`);
    expect(await axeViolations(page), "age").toEqual([]);
    await page.goto(`${live.origin}/r/${live.pageId}/lnkcode00001`);
    expect(await axeViolations(page), "code").toEqual([]);
    await page.getByLabel("Code").fill("nope-nope");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("That code didn’t match. Try again.")).toBeVisible();
    expect(await axeViolations(page), "code with an error").toEqual([]);
  });
});
