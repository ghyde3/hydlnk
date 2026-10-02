import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly, signedInUser } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { newBlockId } from "@/lib/document";
import {
  css,
  draftWith,
  emptyUser,
  expectDraft,
  openEditor,
  pageRow,
  previewScreen,
  rowOf,
  saveIndicator,
  seededUser,
  setDraft,
  statusChip,
} from "./editor-helpers";

/** M2-24 (publish errors on the blocks that failed) and M2-27 (the publish-state chip). */

test.afterAll(cleanupUsers);

const NOIR = "00000000-0000-4000-8000-000000000001";
const publishButton = (page: Page) =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });
const alertFor = (page: Page, text: string | RegExp) =>
  page.getByRole("alert").filter({ hasText: text });
const rowButton = (page: Page, id: string) => rowOf(page, id).locator("button[aria-expanded]");

const BAD = { link: "lnkBad001", embed: "embBad001", image: "imgBad001", header: "hdrGood01" };

/** A published page whose draft was then broken in three ways through the API. */
async function brokenPage(context: import("@playwright/test").BrowserContext, label: string) {
  const user = await seededUser(context, label);
  const draft = (await pageRow(user.pageId)).draft;
  await setDraft(user.pageId, {
    ...draft,
    blocks: [
      { id: BAD.link, type: "link", visible: true, label: "Broken link", url: "" },
      { id: BAD.header, type: "header", visible: true, text: "A fine header" },
      {
        id: BAD.embed,
        type: "embed",
        visible: true,
        url: "https://example.com/not-a-video",
        caption: "Bad embed",
      },
      { id: BAD.image, type: "image", visible: true, image: null, alt: "", url: "" },
    ],
  });
  return user;
}

test.describe("M2-24 publish errors", () => {
  test("M2-24 three failing blocks: the alert, the marked rows, the first one open and focused; nothing is published", async ({
    page,
    context,
  }) => {
    const user = await brokenPage(context, "pe1");
    const before = await pageRow(user.pageId);
    await openEditor(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await publishButton(page).click();

    const alert = alertFor(page, "Fix 3 blocks before publishing.");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Broken link");
    await expect(alert).toContainText("Bad embed");
    await expect(alert).toContainText("Add a short description of this image.");
    await expect(page.getByRole("alert").filter({ hasText: "Fix" })).toHaveCount(1);

    // Rows: #B23A2B border, #E8C4BD fill.
    for (const id of [BAD.link, BAD.embed, BAD.image]) {
      expect(await css(rowOf(page, id), "border-top-color"), id).toBe("rgb(178, 58, 43)");
      expect(await css(rowOf(page, id), "background-color"), id).toBe("rgb(232, 196, 189)");
    }
    expect(await css(rowOf(page, BAD.header), "border-top-color")).toBe("rgb(226, 223, 217)");

    // The first failing block is open, in view, with its first invalid input focused.
    await expect(rowButton(page, BAD.link)).toHaveAttribute("aria-expanded", "true");
    await expect(rowOf(page, BAD.link)).toBeInViewport();
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("aria-invalid", "true");
    await expect(rowOf(page, BAD.link).locator(":focus")).toHaveCount(1);
    const message = rowOf(page, BAD.link).getByText(
      "Enter a full web address, like https://example.com.",
    );
    await expect(message).toBeVisible();
    expect(await css(message, "color")).toBe("rgb(178, 58, 43)");

    // The other rows carry their own messages once opened.
    await rowButton(page, BAD.embed).click();
    await expect(
      rowOf(page, BAD.embed).getByText(
        "Paste a link to a YouTube video or a Spotify track, album, playlist or episode.",
      ),
    ).toBeVisible();
    await rowButton(page, BAD.image).click();
    await expect(
      rowOf(page, BAD.image).getByText("Add a short description of this image."),
    ).toBeVisible();
    await expect(rowOf(page, BAD.image).getByText("Upload an image.")).toBeVisible();

    // The chip stays "Unpublished changes"; nothing was published.
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
  });

  test("M2-24 a block whose only error is the missing image focuses its Upload button", async ({
    page,
    context,
  }) => {
    const handleDraft = (handle: string) =>
      draftWith(handle, [
        { id: "img-only-0001", type: "image", visible: true, image: null, alt: "A fine photo" },
      ]);
    await emptyUser(context, "pe9", { draft: handleDraft("zq-pe9") });
    await openEditor(page);
    await publishButton(page).click();
    await expect(alertFor(page, "Fix 1 block before publishing.")).toBeVisible();
    const row = rowOf(page, "img-only-0001");
    await expect(row.getByText("Upload an image.")).toBeVisible();
    await expect(row.getByRole("button", { name: "Upload image" })).toBeFocused();
  });

  test("M2-24 fixing a field clears its error as soon as it validates; the chip stays Unpublished changes", async ({
    page,
    context,
  }) => {
    await brokenPage(context, "pe2");
    await openEditor(page);
    await publishButton(page).click();
    await expect(alertFor(page, "Fix 3 blocks before publishing.")).toBeVisible();

    const url = rowOf(page, BAD.link).getByLabel("Link", { exact: true });
    await url.fill("https://example.com/portraits");
    await url.blur();
    await expect(alertFor(page, "Fix 2 blocks before publishing.")).toBeVisible();
    await expect(rowOf(page, BAD.link).getByText("Enter a full web address")).toHaveCount(0);
    expect(await css(rowOf(page, BAD.link), "border-top-color")).not.toBe("rgb(178, 58, 43)");
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    // The other two are still marked.
    expect(await css(rowOf(page, BAD.embed), "border-top-color")).toBe("rgb(178, 58, 43)");

    // One block left: the wording is singular.
    await rowButton(page, BAD.embed).click();
    const embed = rowOf(page, BAD.embed)
      .getByLabel(/link|url|video/i)
      .first();
    await embed.fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    await embed.blur();
    await expect(alertFor(page, "Fix 1 block before publishing.")).toBeVisible();
  });

  test("M2-24 a profile error highlights Display name and takes focus", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "pe3");
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, { ...draft, profile: { ...draft.profile, name: "" } });
    await openEditor(page);
    await publishButton(page).click();
    const name = page.getByLabel("Display name", { exact: true });
    await expect(alertFor(page, "Fix your profile before publishing.")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Add a display name.", { exact: true }).first()).toBeVisible();
    await expect(name).toBeFocused();
    expect(await css(name, "border-top-color")).toBe("rgb(178, 58, 43)");
    await name.fill("Back again");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await expect(alertFor(page, "Fix")).toHaveCount(0);
  });

  test("M2-24 a social icon and a grid cell are highlighted by id", async ({ page, context }) => {
    const user = await seededUser(context, "pe4");
    const draft = (await pageRow(user.pageId)).draft;
    const social = draft.blocks.find((b) => b.type === "social")!;
    const grid = draft.blocks.find((b) => b.type === "grid")!;
    const broken = draft.blocks.map((b) => {
      if (b.id === social.id && b.type === "social") {
        return {
          ...b,
          icons: b.icons.map((icon, i) =>
            i === 1 && icon.platform !== "email" ? { ...icon, url: "" } : icon,
          ),
        };
      }
      if (b.id === grid.id && b.type === "grid") {
        return { ...b, cells: b.cells.map((cell, i) => (i === 0 ? { ...cell, title: "" } : cell)) };
      }
      return b;
    });
    await setDraft(user.pageId, { ...draft, blocks: broken });
    await openEditor(page);
    await publishButton(page).click();
    await expect(alertFor(page, "Fix 2 blocks before publishing.")).toBeVisible();
    const iconId = (social as { icons: { id: string }[] }).icons[1]!.id;
    const cellId = (grid as { cells: { id: string }[] }).cells[0]!.id;
    await expect(rowButton(page, social.id)).toHaveAttribute("aria-expanded", "true");
    await expect(rowOf(page, social.id).locator(`[data-item-id="${iconId}"]`)).toBeVisible();
    await expect(
      rowOf(page, social.id).locator(`[data-item-id="${iconId}"][data-invalid="true"]`),
    ).toHaveCount(1);
    // Opening the grid row collapses the social row (one open row at a time), so the icon is
    // checked first.
    await rowButton(page, grid.id).click();
    await expect(rowOf(page, grid.id).locator(`[data-item-id="${cellId}"]`)).toBeVisible();
    await expect(
      rowOf(page, grid.id).locator(`[data-item-id="${cellId}"][data-invalid="true"]`),
    ).toHaveCount(1);
  });

  test("M2-24 more than 50 blocks (written through the API) is refused at Publish with a page-level message", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pe5");
    await setDraft(
      user.pageId,
      draftWith(
        user.handle,
        Array.from({ length: 51 }, () => ({ id: newBlockId(), type: "divider", visible: true })),
      ),
    );
    await openEditor(page);
    await publishButton(page).click();
    const alert = alertFor(page, "Fix your page before publishing.");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Use 50 blocks or fewer.");
    const row = await pageRow(user.pageId);
    expect(row.published).toBeNull();
    expect(row.published_at).toBeNull();
    await expect(statusChip(page)).toHaveText("Not published");
  });

  test("M2-24 phone: Publish on the Preview tab switches to Blocks and shows the alert; everything wraps and is 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await brokenPage(context, "pe6");
    await openEditor(page);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await publishButton(page).click();
    await expect(page.getByRole("tab", { name: "Blocks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(alertFor(page, "Fix 3 blocks before publishing.")).toBeVisible();
    await expect(rowButton(page, BAD.link)).toHaveAttribute("aria-expanded", "true");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    const box = (await alertFor(page, "Fix 3 blocks").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 16 + 0.5);
  });

  test("M2-24 desktop: the alert spans the block column (max 720px) and the preview stays visible", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await brokenPage(context, "pe7");
    await openEditor(page);
    await publishButton(page).click();
    const alert = alertFor(page, "Fix 3 blocks before publishing.");
    await expect(alert).toBeVisible();
    const column = (await page.getByRole("region", { name: "Blocks", exact: true }).boundingBox())!;
    const box = (await alert.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.width - column.width)).toBeLessThanOrEqual(1);
    await expect(previewScreen(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// M2-27
// ---------------------------------------------------------------------------------------------

test.describe("M2-27 the status chip", () => {
  test("M2-27 three states with their colours, a 6px dot, 12px/500 text and a polite live region", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "st1");
    await openEditor(page);
    const chip = statusChip(page);
    await expect(chip).toHaveText("Published");
    await expect(chip).toHaveAttribute("aria-live", "polite");
    expect(await css(chip, "font-size")).toBe("12px");
    expect(await css(chip, "font-weight")).toBe("500");
    expect(await css(chip, "border-top-left-radius")).toBe("4px");
    expect(await css(chip, "background-color")).toBe("rgb(231, 243, 236)");
    // The text is #2B7448 (the spec's #2F7D4F is 4.42:1, below AA at 12px); the dot is #2F7D4F.
    expect(await css(chip, "color")).toBe("rgb(43, 116, 72)");
    const dot = chip.locator("span");
    expect((await dot.boundingBox())!.width).toBe(6);
    expect(await css(dot, "background-color")).toBe("rgb(47, 125, 79)");

    await page.getByLabel("Bio", { exact: true }).fill("Changed bio");
    await expect(chip).toHaveText("Unpublished changes");
    expect(await css(chip, "background-color")).toBe("rgb(246, 238, 223)");
    expect(await css(chip, "color")).toBe("rgb(107, 82, 38)");

    // Never published: neutral.
    await adminClient()
      .from("pages")
      .update({ published: null, published_at: null })
      .eq("id", user.pageId)
      .throwOnError();
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(chip).toHaveText("Not published");
    expect(await css(chip, "background-color")).toBe("rgb(239, 237, 233)");
    expect(await css(chip, "color")).toBe("rgb(94, 90, 84)");
  });

  test("M2-27 editing the bio flips the chip before the save returns; it persists; typing the old bio back returns it", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "st2");
    await openEditor(page);
    const bio = page.getByLabel("Bio", { exact: true });
    const original = await bio.inputValue();
    await expect(statusChip(page)).toHaveText("Published");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/rest/v1/pages?*", async (route) => {
      if (route.request().method() === "PATCH") await gate;
      await route.continue();
    });
    await bio.fill(`${original} (edited)`);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await expect(saveIndicator(page)).toHaveText("Saving...");
    release();
    await expect(saveIndicator(page)).toHaveText("Saved");
    await page.unroute("**/rest/v1/pages?*");
    await expectDraft(user.pageId, (d) => d.profile.bio.endsWith("(edited)"));

    await page.reload();
    await expect(statusChip(page)).toHaveText("Unpublished changes");

    await page.getByLabel("Bio", { exact: true }).fill(original);
    await expect(statusChip(page)).toHaveText("Published");
    await expect(saveIndicator(page)).toHaveText("Saved");
    await page.reload();
    await expect(statusChip(page)).toHaveText("Published");
  });

  test("M2-27 reordering and a visibility toggle change it; editing a block hidden in both does not", async ({
    page,
    context,
  }) => {
    await seededUser(context, "st3");
    await openEditor(page);
    const chip = statusChip(page);
    await expect(chip).toHaveText("Published");

    // Hidden in both the draft and the published copy: the seeded image block. Edit its alt text.
    const image = "Im4gB6kWs8Xz";
    await rowButton(page, image).click();
    await rowOf(page, image).getByLabel("Alt text", { exact: true }).fill("Edited while hidden");
    await expect(rowButton(page, image).locator("> span").nth(1)).toHaveText("Edited while hidden");
    await page.waitForTimeout(300);
    await expect(chip).toHaveText("Published");

    // Reorder: move the divider up.
    const divider = "Vk3wD8tHa5Pr";
    await rowButton(page, divider).click();
    await rowOf(page, divider).getByRole("button", { name: "Move up" }).click();
    await expect(chip).toHaveText("Unpublished changes");
    await rowOf(page, divider).getByRole("button", { name: "Move down" }).click();
    await expect(chip).toHaveText("Published"); // back where it was

    // Visibility.
    const link = "Qw8vC2nKd4Ly";
    await rowOf(page, link).getByRole("button", { name: "Visible on page" }).click();
    await expect(chip).toHaveText("Unpublished changes");
    await rowOf(page, link).getByRole("button", { name: "Visible on page" }).click();
    await expect(chip).toHaveText("Published");
  });

  test("M2-27 a new page is Not published; after Publish it is Published without a reload, with a View live page link", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "st4");
    await openEditor(page);
    const chip = statusChip(page);
    await expect(chip).toHaveText("Not published");
    await expect(page.getByRole("link", { name: "View live page" })).toHaveCount(0);

    await publishButton(page).click();
    await expect(chip).toHaveText("Published");
    // The header link; the "Published." toast carries a second one (M2-23).
    const link = page.locator("main > header").getByRole("link", { name: "View live page" });
    await expect(link).toHaveAttribute("href", `http://${user.handle}.localhost:3000`);
    await expect(link).toHaveAttribute("target", "_blank");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const row = await pageRow(user.pageId);
    expect(row.published_at).not.toBeNull();
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);

    // And an edit after Publish flips it again.
    await page.getByLabel("Bio", { exact: true }).fill("After publish");
    await expect(chip).toHaveText("Unpublished changes");
  });

  test("M2-27 a change to the draft's theme row flips the chip on reload with no draft edit", async ({
    page,
    context,
  }) => {
    const admin = adminClient();
    const user = await signedInUser(context, { label: "st5", plan: "pro" });
    const noir = await admin.from("themes").select("tokens").eq("id", NOIR).single();
    expect(noir.error).toBeNull();
    const theme = await admin
      .from("themes")
      .insert({ owner_id: user.userId, name: "Freeze fixture", tokens: noir.data!.tokens })
      .select("id")
      .single();
    expect(theme.error).toBeNull();
    const draft = (await pageRow(user.pageId)).draft;
    await setDraft(user.pageId, { ...draft, theme: { ref: theme.data!.id, overrides: {} } });

    await openEditor(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes"); // the theme ref differs
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveText("Published");
    await page.reload();
    await expect(statusChip(page)).toHaveText("Published");

    const changed = {
      ...(noir.data!.tokens as Record<string, unknown>),
      bg: "#101820",
      accent: "#7FB069",
    };
    const updated = await admin.from("themes").update({ tokens: changed }).eq("id", theme.data!.id);
    expect(updated.error).toBeNull();
    await page.reload();
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    // The preview resolves the new theme values.
    await expect
      .poll(() => css(previewScreen(page).locator("[data-page-root]"), "background-color"))
      .toBe("rgb(16, 24, 32)");
    await admin.from("themes").delete().eq("id", theme.data!.id);
  });

  test("M2-27 phone: the chip wraps inside the header; the live link and every control are 44px", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "st6");
    await openEditor(page);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    await expectTapTargets(page, "main > header");
    const header = (await page.locator("main > header").boundingBox())!;
    const chip = (await statusChip(page).boundingBox())!;
    expect(chip.x).toBeGreaterThanOrEqual(header.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(header.x + header.width);
    const link = (await page.getByRole("link", { name: "View live page" }).boundingBox())!;
    expect(link.height).toBeGreaterThanOrEqual(44);
  });

  test("M2-27 desktop: the chip sits left of the Preview and Publish buttons", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "st7");
    await openEditor(page);
    const chip = (await statusChip(page).boundingBox())!;
    const preview = (await page.getByRole("link", { name: "Preview", exact: true }).boundingBox())!;
    const publish = (await publishButton(page).boundingBox())!;
    expect(chip.x + chip.width).toBeLessThanOrEqual(preview.x);
    expect(preview.x + preview.width).toBeLessThanOrEqual(publish.x);
  });
});
