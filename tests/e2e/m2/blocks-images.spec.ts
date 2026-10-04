import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../helpers";
import { cleanupUsers, phoneOnly } from "../fixtures/data";
import {
  addBlock,
  box,
  expectDraft,
  makePng,
  openEditor,
  previewScreen,
  showView,
  userWithDraft,
} from "./blocks-helpers";

/**
 * M2-20 and M2-21: the upload, replace and remove control inside the Image and Card panels, through
 * POST /api/media, and what the preview draws from the stored reference.
 */

test.afterAll(cleanupUsers);

const png = (width = 400, height = 160, rgb?: [number, number, number]) => ({
  name: "picture.png",
  mimeType: "image/png",
  buffer: makePng(width, height, rgb),
});

test.describe("M2-20 image block with alt text", () => {
  test("M2-20 / M2-21 text typed while the file uploads is still there when it lands", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ir");
    await openEditor(page);
    // Hold the upload so the edit lands while it is in flight.
    await page.route("**/api/media", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    const image = await addBlock(page, "image");
    await image.panel.locator('input[type="file"]').setInputFiles(png(300, 200));
    await expect(image.panel.getByRole("button", { name: "Uploading..." })).toBeVisible();
    await image.panel.getByLabel("Alt text", { exact: true }).fill("Typed during the upload");
    await expect(image.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 25_000,
    });
    await expect(image.panel.getByLabel("Alt text", { exact: true })).toHaveValue(
      "Typed during the upload",
    );
    await expectDraft(user.pageId, (d) =>
      d.blocks.some(
        (b) =>
          b.id === image.id &&
          b.type === "image" &&
          b.alt === "Typed during the upload" &&
          b.image !== null,
      ),
    );

    const card = await addBlock(page, "card");
    await card.panel.locator('input[type="file"]').setInputFiles(png(300, 200));
    await expect(card.panel.getByRole("button", { name: "Uploading..." })).toBeVisible();
    await card.panel.getByLabel("Title", { exact: true }).fill("Typed during the card upload");
    await expect(card.panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 25_000,
    });
    await expect(card.panel.getByLabel("Title", { exact: true })).toHaveValue(
      "Typed during the card upload",
    );
  });

  test("M2-20 upload, alt text and link: the preview draws an img with its size, lazy loading and alt, inside the link", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "iu");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "image");

    await panel.locator('input[type="file"]').setInputFiles(png(400, 160));
    const replace = panel.getByRole("button", { name: "Replace image" });
    await expect(replace).toBeVisible({ timeout: 25_000 });
    await expect(panel.getByRole("button", { name: "Remove" })).toBeVisible();
    for (const button of [replace, panel.getByRole("button", { name: "Remove" })]) {
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
    }

    await panel.getByLabel("Alt text", { exact: true }).fill("The studio at golden hour");
    await panel.getByLabel("Link (optional)").fill("https://maraokafor.com/studio");

    const stored = await expectDraft(
      user.pageId,
      (d) =>
        d.blocks.some(
          (b) =>
            b.id === id &&
            b.type === "image" &&
            b.image !== null &&
            b.alt === "The studio at golden hour",
        ),
      "the image reference in the draft",
    );
    const block = stored.blocks.find((b) => b.id === id)!;
    if (block.type !== "image" || !block.image) throw new Error("image block missing");
    expect(block.image).toEqual({
      path: expect.stringMatching(/^[0-9a-f-]{36}\/.+\.(jpg|png|webp)$/),
      width: 400,
      height: 160,
    });
    expect(block.image.path.startsWith(`${user.userId}/`)).toBe(true);

    await showView(page, "Preview");
    const root = previewScreen(page).locator(`[data-block-id="${id}"]`);
    const img = root.locator("img");
    await expect(img).toHaveAttribute("alt", "The studio at golden hour");
    await expect(img).toHaveAttribute("width", "400");
    await expect(img).toHaveAttribute("height", "160");
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect(img).toHaveAttribute("src", new RegExp(`^/media/${user.userId}/`));
    const link = root.locator("a");
    // The link goes through the click redirect (M4-22): the destination is not in the markup.
    await expect(link).toHaveAttribute("href", new RegExp(`^/r/[0-9a-f-]{36}/${id}$`));
    await expect(link).toHaveAttribute("rel", "nofollow noopener");
    await expect(link.locator("img")).toHaveCount(1);

    await expect(img).toHaveJSProperty("complete", true);
    expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(400);
    const rendered = await box(img);
    const column = await box(root);
    expect(rendered.width).toBeCloseTo(column.width, 0);
    expect(rendered.width / rendered.height).toBeCloseTo(400 / 160, 1);
  });

  test("M2-20 replacing changes only the draft reference, and removing brings the placeholder back", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "ir");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "image");
    const pathOf = async () => {
      const draft = await expectDraft(user.pageId, (d) => d.blocks.some((b) => b.id === id));
      const block = draft.blocks.find((b) => b.id === id);
      return block && block.type === "image" ? block.image?.path : undefined;
    };

    await panel.locator('input[type="file"]').setInputFiles(png(300, 200, [10, 120, 200]));
    await expect(panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 25_000,
    });
    await expect.poll(pathOf).toBeTruthy();
    const first = await pathOf();

    const deletes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE") deletes.push(request.url());
    });
    await panel.locator('input[type="file"]').setInputFiles(png(300, 200, [200, 20, 20]));
    await expect.poll(async () => (await pathOf()) !== first).toBe(true);

    await panel.getByRole("button", { name: "Remove" }).click();
    await expect(panel.getByRole("button", { name: "Upload image" })).toBeVisible();
    await expect.poll(pathOf).toBeUndefined();
    expect(deletes).toEqual([]);

    await showView(page, "Preview");
    await expect(previewScreen(page).locator(`[data-block-id="${id}"]`)).toHaveText("Image");
  });

  test("M2-20 the image fills the column and the page does not scroll sideways", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(!phoneOnly(testInfo), "phone layout check");
    await userWithDraft(context, "iw");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "image");
    await panel.locator('input[type="file"]').setInputFiles(png(1200, 600));
    await expect(panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 25_000,
    });
    await panel.getByLabel("Alt text", { exact: true }).fill("Wide");
    await expectNoHorizontalScroll(page);
    await showView(page, "Preview");
    const img = previewScreen(page).locator(`[data-block-id="${id}"] img`);
    await expect(img).toHaveJSProperty("complete", true);
    const rendered = await box(img);
    expect(rendered.width / rendered.height).toBeCloseTo(2, 1);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("M2-21 link card block", () => {
  test("M2-21 an uploaded image fills the 5:2 banner with an empty alt, and the title stays in the link", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "cu");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "card");
    await panel.getByLabel("Title", { exact: true }).fill("Night Market");
    await panel.getByLabel("Link", { exact: true }).fill("https://maraokafor.com/night-market");
    await panel.locator('input[type="file"]').setInputFiles(png(500, 300));
    await expect(panel.getByRole("button", { name: "Replace image" })).toBeVisible({
      timeout: 25_000,
    });

    await showView(page, "Preview");
    const card = previewScreen(page).locator(`a[data-block-id="${id}"]`);
    const img = card.locator("img");
    await expect(img).toHaveAttribute("alt", "");
    await expect(img).toHaveJSProperty("complete", true);
    await expect(card.locator(".pg-card-title")).toHaveText("Night Market");
    const banner = await box(card.locator(".pg-card-banner"));
    expect(banner.width / banner.height).toBeCloseTo(5 / 2, 1);
    const fit = await img.evaluate((el) => getComputedStyle(el).objectFit);
    expect(fit).toBe("cover");

    await showView(page, "Blocks");
    await panel.getByRole("button", { name: "Remove" }).click();
    await showView(page, "Preview");
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card.locator(".pg-card-banner")).toBeVisible();
  });
});
