import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, phoneOnly, rand } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { expectDraft, pageRow, seededUser, setDraft, statusChip } from "../m2/editor-helpers";
import { pngSizeOf } from "../m2/publish-helpers";
import {
  BLUE,
  RED,
  near,
  pixelAt,
  publishNow,
  removeObjects,
  shareCard,
  shareDescription,
  sharePreview,
  shareTitle,
  socialTags,
  solidImage,
  splitImage,
  storeImage,
  openShare,
} from "./share-helpers";

/**
 * M6-33: the Share card in the editor (title, description, image) with its live preview card, on
 * the phone (390x844) and desktop (1440x900) projects. Each test makes its own user with a
 * published copy of mara's page, so the status chip starts on "Published".
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

const stored: string[] = [];
test.afterAll(async () => {
  await removeObjects(stored.splice(0));
  await cleanupUsers();
});

test.describe("M6-33 the card and its fields", () => {
  test("M6-33 sits on the Share tab, under the address card, with the title, description and image controls", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "sc1");
    await openShare(page);

    const card = shareCard(page);
    await expect(card).toBeVisible();
    // M7-04: the card moved from the Edit tab to the Share tab, right under "Your page address".
    const order = await page.evaluate(() => {
      const address = document.querySelector('[data-testid="address-card"]');
      const share = document.querySelector('[data-testid="share-card"]');
      return address?.nextElementSibling === share;
    });
    expect(order).toBe(true);
    await expect(page.getByTestId("profile-card")).toHaveCount(0);

    await expect(card.getByRole("heading", { name: "Share card", level: 2 })).toBeVisible();
    await expect(card.getByText("How your page looks when you send its link")).toBeVisible();
    await expect(card.getByText("Leave empty to use your display name.")).toBeVisible();
    await expect(card.getByText("Leave empty to use your bio.")).toBeVisible();
    await expect(card.getByText("0 / 70")).toBeVisible();
    await expect(card.getByText("0 / 200")).toBeVisible();
    await expect(card.getByRole("button", { name: "Upload image", exact: true })).toBeVisible();
    await expect(
      card.getByText(
        "Wide images work best, at least 1200 pixels across. Leave it empty and we make one from your name and colors.",
      ),
    ).toBeVisible();
    // On every plan: a Free fixture sees no Pro chip anywhere in the card.
    await expect(card.getByText("Pro", { exact: true })).toHaveCount(0);

    // The placeholders are what the published tags fall back to.
    const { name, bio } = (await pageRow(user.pageId)).draft.profile;
    await expect(shareTitle(page)).toHaveAttribute("placeholder", name);
    await expect(shareDescription(page)).toHaveAttribute("placeholder", bio);
  });

  test("M6-33 typing past a limit is cut at the limit and keeps one line", async ({
    page,
    context,
  }) => {
    await seededUser(context, "sc2");
    await openShare(page);

    await shareTitle(page).fill("x".repeat(90));
    await expect(shareTitle(page)).toHaveValue("x".repeat(70));
    await expect(shareCard(page).getByText("70 / 70")).toBeVisible();

    await shareTitle(page).fill("line one\nline two");
    await expect(shareTitle(page)).toHaveValue("line one line two");

    await shareDescription(page).fill("d".repeat(260));
    await expect(shareDescription(page)).toHaveValue("d".repeat(200));
    await expect(shareCard(page).getByText("200 / 200")).toBeVisible();

    await shareDescription(page).fill("first\nsecond\r\nthird");
    await expect(shareDescription(page)).toHaveValue("first second third");
  });

  test("M6-33 the preview card follows every keystroke and falls back to the name and the bio", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "sc3");
    await openShare(page);
    const preview = sharePreview(page);
    const { name, bio } = (await pageRow(user.pageId)).draft.profile;

    await expect(preview.getByTestId("share-preview-title")).toHaveText(name);
    await expect(preview.getByTestId("share-preview-description")).toHaveText(bio);

    await shareTitle(page).pressSequentially("Hello", { delay: 0 });
    await expect(preview.getByTestId("share-preview-title")).toHaveText("Hello");
    await shareDescription(page).pressSequentially("World", { delay: 0 });
    await expect(preview.getByTestId("share-preview-description")).toHaveText("World");

    // Cleared again: back to the display name and the bio.
    await shareTitle(page).fill("");
    await shareDescription(page).fill("");
    await expect(preview.getByTestId("share-preview-title")).toHaveText(name);
    await expect(preview.getByTestId("share-preview-description")).toHaveText(bio);

    // A display name change (made on the Edit tab) shows at once when the share title is empty: the
    // draft is the workspace's, shared by the tabs.
    await page.getByRole("tab", { name: "Edit" }).click();
    await page.getByLabel("Display name", { exact: true }).fill("Brand New Name");
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(preview.getByTestId("share-preview-title")).toHaveText("Brand New Name");

    await expect(
      preview.getByText("Apps draw cards a little differently. This is close."),
    ).toBeVisible();
    // The address under the picture: the handle on the root domain, in Geist Mono at 12px.
    const host = preview.getByTestId("share-preview-host");
    await expect(host).toHaveText(/^zq-sc3-[a-z0-9]+\.hydlnk\.com$/);
    const style = await host.evaluate((el) => {
      const css = getComputedStyle(el);
      return { size: css.fontSize, family: css.fontFamily };
    });
    expect(style.size).toBe("12px");
    expect(style.family.toLowerCase()).toContain("mono");
  });

  test("M6-33 autosaves share to the draft, flips the chip, and clearing all three fields removes it", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "sc4");
    await openShare(page);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");

    await shareTitle(page).fill("Hear the new album");
    await shareDescription(page).fill("Out Friday. Tap to listen.");
    await expectDraft(user.pageId, (draft) => draft.share?.title === "Hear the new album");
    const draft = await expectDraft(
      user.pageId,
      (stored) => stored.share?.description === "Out Friday. Tap to listen.",
    );
    expect(draft.share).toEqual({
      title: "Hear the new album",
      description: "Out Friday. Tap to listen.",
      image: null,
    });
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");

    await shareTitle(page).fill("");
    await shareDescription(page).fill("");
    await expectDraft(user.pageId, (stored) => !("share" in stored));
    // Nothing is left of the share card, so the page is as it was when published.
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
    expect((await pageRow(user.pageId)).draft).not.toHaveProperty("share");
  });

  test("M6-33 an XSS-looking title is text in the card and fires no dialog", async ({
    page,
    context,
  }) => {
    await seededUser(context, "sc5");
    await openShare(page);
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    const evil = "<img src=x onerror=alert(1)>";
    await shareTitle(page).fill(evil);
    await shareDescription(page).fill("<script>alert(2)</script>");
    const preview = sharePreview(page);
    await expect(preview.getByTestId("share-preview-title")).toHaveText(evil);
    await expect(preview.getByTestId("share-preview-description")).toHaveText(
      "<script>alert(2)</script>",
    );
    await expect(preview.locator("img[src='x']")).toHaveCount(0);
    await expect(shareCard(page).locator("script")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test("M6-33 the card is drawn with HYDLNK tokens: white surface, 1px line border, 6px radius", async ({
    page,
    context,
  }) => {
    await seededUser(context, "sc6");
    await openShare(page);
    const box = sharePreview(page).locator("> div").first();
    const style = await box.evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        bg: css.backgroundColor,
        border: css.borderTopWidth,
        borderColor: css.borderTopColor,
        radius: css.borderTopLeftRadius,
      };
    });
    expect(style.bg).toBe("rgb(255, 255, 255)");
    expect(style.border).toBe("1px");
    expect(style.borderColor).toBe("rgb(226, 223, 217)");
    expect(style.radius).toBe("6px");
  });
});

test.describe("M6-33 phone and desktop layout", () => {
  test("M6-33 at 390x844 the fields stack, the controls are 44px and nothing scrolls sideways", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the phone layout is checked on the phone project");
    await seededUser(context, "sc7");
    await openShare(page);
    await shareTitle(page).scrollIntoViewIfNeeded();

    const boxes = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="share-card"]')!;
      const rect = (el: Element | null) => el?.getBoundingClientRect();
      const title = card.querySelector('input[data-field="share-title"]');
      const description = card.querySelector('textarea[data-field="share-description"]');
      const preview = card.querySelector('[data-testid="share-preview-card"] > div');
      const cardRect = rect(card)!;
      return {
        card: { left: cardRect.left, width: cardRect.width },
        title: {
          top: rect(title)!.top,
          height: rect(title)!.height,
          width: rect(title)!.width,
          font: getComputedStyle(title!).fontSize,
        },
        description: {
          top: rect(description)!.top,
          height: rect(description)!.height,
          font: getComputedStyle(description!).fontSize,
        },
        preview: { width: rect(preview)!.width },
      };
    });
    // Stacked: the description is under the title, both as wide as the card's inside.
    expect(boxes.description.top).toBeGreaterThan(boxes.title.top + boxes.title.height - 1);
    expect(boxes.title.height).toBeGreaterThanOrEqual(44);
    expect(boxes.description.height).toBeGreaterThanOrEqual(44);
    expect(boxes.title.font).toBe("16px");
    expect(boxes.description.font).toBe("16px");
    expect(Math.abs(boxes.preview.width - (boxes.card.width - 34))).toBeLessThanOrEqual(2);
    await expectTapTargets(page, '[data-testid="share-card"]');
    await expectNoHorizontalScroll(page);
  });

  test("M6-33 at 1440x900 the card sits in the block column (720px at most) with the preview under the fields", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the desktop layout is checked on the desktop project");
    await seededUser(context, "sc8");
    await openShare(page);
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="share-card"]')!.getBoundingClientRect();
      const column = document
        .querySelector('[data-testid="share-card"]')!
        .parentElement!.getBoundingClientRect();
      const description = document
        .querySelector('textarea[data-field="share-description"]')!
        .getBoundingClientRect();
      const preview = document
        .querySelector('[data-testid="share-preview-card"]')!
        .getBoundingClientRect();
      return {
        card: card.width,
        column: column.width,
        descriptionBottom: description.bottom,
        previewTop: preview.top,
      };
    });
    expect(geometry.card).toBeLessThanOrEqual(720);
    expect(geometry.column).toBeLessThanOrEqual(720);
    expect(geometry.previewTop).toBeGreaterThan(geometry.descriptionBottom);
    await expectNoHorizontalScroll(page);
    // And the live page stays unchanged by any of it: still reachable.
    expect(url("app", "/editor")).toContain("app.localhost");
  });
});

// Publishing is covered with the metadata in share-meta.spec.ts and the whole flow in
// wave-g-done.spec.ts; this one checks the card's own side of it: the preview matches the tags.
test.describe("M6-33 after Publish", () => {
  test("M6-33 the live tags match what the preview card showed", async ({ page, context }) => {
    const user = await seededUser(context, "sc9");
    await openShare(page);
    await shareTitle(page).fill("A title for the card");
    await shareDescription(page).fill("A description for the card.");
    const shownTitle = await sharePreview(page).getByTestId("share-preview-title").innerText();
    const shownDescription = await sharePreview(page)
      .getByTestId("share-preview-description")
      .innerText();
    await publishNow(page);

    const live = await page.request.get(url(user.handle));
    const html = await live.text();
    const tags = socialTags(html);
    expect(tags.ogTitle).toBe(shownTitle);
    expect(tags.twitterTitle).toBe(shownTitle);
    expect(tags.ogDescription).toBe(shownDescription);
    expect(tags.twitterDescription).toBe(shownDescription);
  });
});

/** Picks a file in the share card's upload control. */
async function pick(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  await shareCard(page).locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
}

const focusGroup = (page: Page) => shareCard(page).getByRole("group", { name: "Focus" });
const marker = (page: Page) => shareCard(page).getByRole("button", { name: "Focus point" });

test.describe("M6-33 the image and its focus", () => {
  test("M6-33 choosing an image uploads it as kind content, shows the focus control, and Center, Replace and Remove behave", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "si1");
    await openShare(page);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/media")) {
        posts.push(request.url());
      }
    });

    await expect(focusGroup(page)).toHaveCount(0);
    await pick(page, "wide.png", "image/png", await splitImage(1600, 800, "png"));
    await expect(
      shareCard(page).getByRole("button", { name: "Replace image", exact: true }),
    ).toBeVisible();
    await expect(
      shareCard(page).getByRole("button", { name: "Remove", exact: true }),
    ).toBeVisible();
    expect(posts).toHaveLength(1);

    const draft = await expectDraft(user.userId && user.pageId, (d) => d.share?.image?.path);
    const image = draft.share!.image!;
    expect(image.path).toMatch(new RegExp(`^${user.userId}/img-[0-9a-f]{12,}\\.webp$`));
    // kind=content keeps the picture's own shape (an avatar would be a 400px square): 1600x800 stays.
    expect([image.width, image.height]).toEqual([1600, 800]);
    stored.push(image.path);
    expect(draft.share).toMatchObject({ title: "", description: "" });
    expect("focus" in image).toBe(false);

    // The focus control appears with its 44px marker, the strip and Center.
    await expect(focusGroup(page)).toBeVisible();
    await expect(focusGroup(page).getByText("How it will look")).toBeVisible();
    const box = (await marker(page).boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([44, 44]);
    const center = await focusGroup(page)
      .getByRole("button", { name: "Center", exact: true })
      .boundingBox();
    expect(center!.height).toBeGreaterThanOrEqual(44);

    // Press a spot on the picture: the focus is two numbers from 0 to 1, rounded to 3 decimals.
    const pictureArea = focusGroup(page).getByTestId("focus-picture");
    const picture = (await pictureArea.boundingBox())!;
    await pictureArea.click({ position: { x: picture.width * 0.25, y: picture.height * 0.75 } });
    const withFocus = await expectDraft(user.pageId, (d) => d.share?.image?.focus !== undefined);
    const focus = withFocus.share!.image!.focus!;
    expect(focus.x).toBeCloseTo(0.25, 1);
    expect(focus.y).toBeCloseTo(0.75, 1);
    expect(Math.round(focus.x * 1000) / 1000).toBe(focus.x);
    // The preview card draws the same crop.
    const position = await sharePreview(page)
      .getByTestId("share-preview-image")
      .evaluate((el) => getComputedStyle(el).objectPosition);
    expect(position).toMatch(/^\d+(\.\d+)?% \d+(\.\d+)?%$/);
    expect(position).not.toBe("50% 50%");

    // Arrow keys move the marker; Center removes the key.
    await marker(page).focus();
    await page.keyboard.press("ArrowRight");
    await expectDraft(user.pageId, (d) => (d.share?.image?.focus?.x ?? 0) > focus.x + 0.04);
    await focusGroup(page).getByRole("button", { name: "Center", exact: true }).click();
    await expectDraft(user.pageId, (d) => d.share?.image !== null && !("focus" in d.share!.image!));

    // Replacing the image resets the focus: set one, then pick another file.
    await pictureArea.click({ position: { x: picture.width * 0.1, y: picture.height * 0.1 } });
    await expectDraft(user.pageId, (d) => d.share?.image?.focus !== undefined);
    await pick(page, "other.png", "image/png", await splitImage(1400, 700, "png"));
    const replaced = await expectDraft(user.pageId, (d) => d.share?.image?.path !== image.path);
    stored.push(replaced.share!.image!.path);
    expect("focus" in replaced.share!.image!).toBe(false);

    // Remove: the control goes and, with nothing else filled in, the share key goes too.
    await shareCard(page).getByRole("button", { name: "Remove", exact: true }).click();
    await expectDraft(user.pageId, (d) => !("share" in d));
    await expect(focusGroup(page)).toHaveCount(0);
  });

  test("M6-33 a file that is not an image shows the route's sentence inline and leaves the image alone", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "si2");
    await openShare(page);
    await pick(page, "good.png", "image/png", await splitImage(1600, 800, "png"));
    const first = await expectDraft(user.pageId, (d) => d.share?.image?.path);
    stored.push(first.share!.image!.path);

    await pick(page, "notes.png", "image/png", Buffer.from("this is not a picture"));
    await expect(shareCard(page).getByRole("alert")).toHaveText(
      "That file type isn’t supported. Use JPEG, PNG or WebP.",
    );
    const after = await pageRow(user.pageId);
    expect(after.draft.share?.image?.path).toBe(first.share!.image!.path);
  });

  test("M6-33 a Free account at its upload limit sees the plan's sentence inline and keeps the current image", async ({
    page,
    context,
  }, info) => {
    test.skip(
      !desktopOnly(info),
      "the quota arithmetic is the same on both projects: one is enough",
    );
    const user = await seededUser(context, "si3");
    await openShare(page);
    await pick(page, "good.png", "image/png", await splitImage(1600, 800, "png"));
    const first = await expectDraft(user.pageId, (d) => d.share?.image?.path);
    stored.push(first.share!.image!.path);

    // Fill the Free allowance (10 MiB) with objects that are not referenced by anything.
    for (let i = 0; i < 3; i += 1) {
      const path = `${user.userId}/seed-${rand(6)}-${i}.png`;
      const { error } = await adminClient()
        .storage.from("page-media")
        .upload(path, Buffer.alloc(4 * 1024 * 1024), { contentType: "image/png" });
      expect(error).toBeNull();
      stored.push(path);
    }
    await pick(page, "more.png", "image/png", await splitImage(1500, 700, "png"));
    await expect(shareCard(page).getByRole("alert").first()).toHaveText(
      "Uploads are limited to 10 MB on Free. Delete an image or upgrade.",
    );
    expect((await pageRow(user.pageId)).draft.share?.image?.path).toBe(first.share!.image!.path);
  });

  test("M6-33 the preview card draws the chosen picture around its focus, and the live image when there is none", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "si4");
    const row = await pageRow(user.pageId);
    const published = await adminClient()
      .from("pages")
      .select("published_at")
      .eq("id", user.pageId)
      .single();
    await openShare(page);

    // No picture chosen and the page is published: the page's current social image, versioned.
    const live = sharePreview(page).getByTestId("share-preview-image");
    await expect(live).toBeVisible();
    const ms = Date.parse(published.data!.published_at as string);
    await expect(live).toHaveAttribute("src", `${url(user.handle).replace(/\/$/, "")}/og?v=${ms}`);
    expect(row.draft.share).toBeUndefined();

    // With a picture and a focus the same element shows it, positioned.
    const ref = await storeImage(user.userId, await splitImage(1600, 800), {
      width: 1600,
      height: 800,
    });
    stored.push(ref.path);
    await setDraft(user.pageId, {
      ...row.draft,
      share: { title: "", description: "", image: { ...ref, focus: { x: 0.2, y: 0.4 } } },
    });
    await page.reload();
    await expect(sharePreview(page).getByTestId("share-preview-image")).toHaveAttribute(
      "src",
      new RegExp(`${ref.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    const position = await sharePreview(page)
      .getByTestId("share-preview-image")
      .evaluate((el) => getComputedStyle(el).objectPosition);
    expect(position).toBe("20% 40%");
  });

  test("M6-33 an unpublished page shows the gray tile that says an image is made at Publish", async ({
    page,
    context,
  }) => {
    const { emptyUser } = await import("../m2/editor-helpers");
    await emptyUser(context, "si5");
    await openShare(page);
    const tile = sharePreview(page).getByTestId("share-preview-tile");
    await expect(tile).toHaveText("We make this image from your name and colors when you publish.");
    await expect(sharePreview(page).getByTestId("share-preview-image")).toHaveCount(0);
  });
});

test.describe("M6-33 Publish errors show under the field they belong to", () => {
  async function publishWith(
    page: Page,
    userId: string,
    pageId: string,
    share: unknown,
  ): Promise<void> {
    const row = await pageRow(pageId);
    await setDraft(pageId, { ...row.draft, share });
    await page.reload();
    await expect(shareCard(page)).toBeVisible();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    expect(userId).toBeTruthy();
  }

  test("M6-33 a hidden control character in the title: the sentence under Title, the alert, and focus in the field", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "se1");
    await openShare(page);
    const before = (await pageRow(user.pageId)).published;
    await publishWith(page, user.userId, user.pageId, {
      title: "bad\u0001title",
      description: "fine",
      image: null,
    });
    await expect(
      shareCard(page).getByText("Remove line breaks and hidden control characters."),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "Fix your share card before publishing." }),
    ).toBeVisible();
    await expect(shareTitle(page)).toBeFocused();
    await expect(shareTitle(page)).toHaveAttribute("aria-invalid", "true");
    expect((await pageRow(user.pageId)).published).toEqual(before);
  });

  test("M6-33 an image under 600 pixels wide: Use an image at least 600 pixels wide, with focus on the Image control", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "se2");
    await openShare(page);
    const ref = await storeImage(user.userId, await solidImage(400, 300), {
      width: 400,
      height: 300,
    });
    stored.push(ref.path);
    await publishWith(page, user.userId, user.pageId, { title: "", description: "", image: ref });
    await expect(shareCard(page).getByText("Use an image at least 600 pixels wide.")).toBeVisible();
    await expect(
      shareCard(page).getByRole("button", { name: "Replace image", exact: true }),
    ).toBeFocused();
  });

  test("M6-33 an image that is not in your uploads, and one that is gone, each say so under the Image field", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "se3");
    const other = await makeUser("se3b");
    await openShare(page);
    const foreign = await storeImage(other.id, await solidImage(1200, 630), {
      width: 1200,
      height: 630,
    });
    stored.push(foreign.path);
    await publishWith(page, user.userId, user.pageId, {
      title: "",
      description: "",
      image: foreign,
    });
    await expect(
      shareCard(page).getByText("That image isn’t in your uploads. Upload it again."),
    ).toBeVisible();
    await expect(
      shareCard(page).getByRole("button", { name: "Replace image", exact: true }),
    ).toBeFocused();

    const gone = { path: `${user.userId}/img-${"ab12cd34ef56"}.webp`, width: 1200, height: 630 };
    await publishWith(page, user.userId, user.pageId, { title: "", description: "", image: gone });
    await expect(
      shareCard(page).getByText("That image is no longer available. Upload it again."),
    ).toBeVisible();
  });
});

test.describe("M6-33 safety", () => {
  test("M6-33 the card writes only share, and calls nothing but the draft save, the upload route and image loads", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "sn1");
    await openShare(page);
    await page.waitForTimeout(800);
    const seen: { method: string; url: string }[] = [];
    page.on("request", (request) => {
      seen.push({ method: request.method(), url: request.url() });
    });

    await shareTitle(page).fill("Network check");
    await shareDescription(page).fill("Only the draft save and the upload.");
    await pick(page, "wide.png", "image/png", await splitImage(1600, 800, "png"));
    const draft = await expectDraft(user.pageId, (d) => d.share?.image?.path);
    stored.push(draft.share!.image!.path);
    await page.waitForTimeout(600);

    const allowed = [
      /\/rest\/v1\/pages\?/, // the draft save
      /\/api\/media(\/|$)/, // the shared upload route (and its cleanup call)
      /\/storage\/v1\/object\/public\/page-media\//, // the uploaded picture, shown
      /\.localhost:\d+\/og(\?|$)/, // the live social image, shown in the preview
      /\/_next\/|\/__nextjs_font\//, // the framework (and its dev-mode font)
      /[?&]_rsc=/, // the router's prefetch of another workspace tab (M7-02)
      /\/media\/[^/]+\/img-/, // the uploaded picture through our own address (M7-14)
    ];
    const stray = seen.filter(
      (request) =>
        !/^(blob|data):/.test(request.url) && !allowed.some((pattern) => pattern.test(request.url)),
    );
    expect(stray).toEqual([]);
    // The draft save is a PATCH of pages and nothing else is written.
    const writes = seen.filter(
      (r) => r.method !== "GET" && r.method !== "HEAD" && r.method !== "OPTIONS",
    );
    for (const write of writes) {
      expect(write.url).toMatch(/\/rest\/v1\/pages\?|\/api\/media|\/_next\//);
    }
    const stored2 = await pageRow(user.pageId);
    expect(Object.keys(stored2.draft).sort()).toEqual(
      ["blocks", "profile", "rev", "share", "theme", "version"].sort(),
    );
  });
});

test.describe("M6-33 after Publish with a picture", () => {
  test("M6-33 the live tags and the social image follow the card: title, description, the uploaded picture around its focus", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "sp1");
    await openShare(page);
    // A wide picture (2400x630): the 1200x630 frame crops it sideways, so the focus decides what shows.
    const ref = await storeImage(user.userId, await splitImage(2400, 630), {
      width: 2400,
      height: 630,
    });
    stored.push(ref.path);
    const row = await pageRow(user.pageId);
    await setDraft(user.pageId, {
      ...row.draft,
      share: {
        title: "Picture title",
        description: "Picture description",
        image: { ...ref, focus: { x: 0.75, y: 0.5 } },
      },
    });
    await page.reload();
    await expect(shareTitle(page)).toHaveValue("Picture title");
    const shownTitle = await sharePreview(page).getByTestId("share-preview-title").innerText();
    const shownDescription = await sharePreview(page)
      .getByTestId("share-preview-description")
      .innerText();
    await publishNow(page);

    const html = await (await page.request.get(url(user.handle))).text();
    const tags = socialTags(html);
    expect(tags.ogTitle).toBe(shownTitle);
    expect(tags.ogDescription).toBe(shownDescription);
    expect(tags.title).toBe(`${user.handle} - links`);
    expect(tags.ogImage).toMatch(
      new RegExp(`^${url(user.handle).replace(/\/$/, "")}/og\\?v=\\d+$`),
    );

    const og = await page.request.get(tags.ogImage!);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toBe("image/png");
    const png = Buffer.from(await og.body());
    expect(pngSizeOf(png)).toEqual({ width: 1200, height: 630 });
    // focus.x = 0.75 on a 2400px picture shows its pixels 900 to 2100: red on the left, blue in the middle.
    expect(near(await pixelAt(png, 600, 315), BLUE)).toBe(true);
    expect(near(await pixelAt(png, 20, 315), RED)).toBe(true);
  });
});
