import { expect, test, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, makeUser } from "../fixtures/data";
import { url } from "../helpers";
import { draftOf, openEditor, rowOf, userWithDraft, type TestPage } from "./blocks-helpers";

/**
 * The abuse cases of M2-17, M2-19, M2-20 and M2-21: a draft written straight to the database (as
 * PostgREST allows) with an unsafe icon URL, an embed to a foreign host or an image path that is not
 * the owner's. Publish must refuse it, name the block and the field, and the live page must never
 * show it. The draft is written with the secret key; the Publish button is the real gate.
 */

test.afterAll(cleanupUsers);

const URL_MESSAGE = "Enter a full web address, like https://example.com.";
const EMBED_MESSAGE =
  "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.";

async function publishedRow(pageId: string) {
  const { data, error } = await adminClient()
    .from("pages")
    .select("published, published_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Presses Publish and returns the alert text; the draft must not have been published. */
async function publishAndExpectRefusal(page: Page, user: TestPage): Promise<string> {
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
  await expect(alert).toBeVisible();
  const text = (await alert.textContent()) ?? "";
  expect(await publishedRow(user.pageId)).toEqual({ published: null, published_at: null });
  // The live page shows nothing of the draft.
  const response = await page.request.get(url(user.handle));
  const body = await response.text();
  expect(body).not.toContain("evil.example");
  expect(body).not.toContain("javascript:");
  expect(body).not.toContain("data-block-id");
  return text;
}

test.describe("M2-17 a social icon with an unsafe address", () => {
  test("M2-17 javascript: in a draft icon is refused at Publish, the icon is named and the page stays dark", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "xs", (handle) =>
      draftOf(handle, [
        {
          id: "Sx4kT9pLq2Wa",
          type: "social",
          visible: true,
          icons: [
            { id: "Ig3xQ7mNa2Ks", platform: "instagram", url: "https://instagram.com/mara" },
            { id: "Tk8vR1dLp5Wc", platform: "tiktok", url: "javascript:alert(1)" },
          ],
        },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 1 block before publishing.");
    expect(text).toContain(URL_MESSAGE);

    // The failing icon, by id, carries the message and the invalid flag; the good one does not.
    const row = rowOf(page, "Sx4kT9pLq2Wa");
    const bad = row.locator('[data-item-id="Tk8vR1dLp5Wc"]');
    await expect(bad).toHaveAttribute("data-invalid", "true");
    await expect(bad).toContainText(URL_MESSAGE);
    await expect(bad.getByLabel("Link", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(row.locator('[data-item-id="Ig3xQ7mNa2Ks"]')).not.toHaveAttribute(
      "data-invalid",
      "true",
    );

    // Fixing the address clears the message.
    await bad.getByLabel("Link", { exact: true }).fill("https://www.tiktok.com/@mara");
    await expect(bad).not.toContainText(URL_MESSAGE);
    await expect(bad.getByLabel("Link", { exact: true })).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test("M2-17 an email icon with a bad address is refused too", async ({ page, context }) => {
    const user = await userWithDraft(context, "xe", (handle) =>
      draftOf(handle, [
        {
          id: "Sx4kT9pLq2Wa",
          type: "social",
          visible: true,
          icons: [{ id: "Em2cF5sYt7Dn", platform: "email", address: "mailto:a@b.co?subject=x" }],
        },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 1 block before publishing.");
    await expect(
      rowOf(page, "Sx4kT9pLq2Wa").locator('[data-item-id="Em2cF5sYt7Dn"]'),
    ).toContainText("Enter a valid email address.");
  });
});

test.describe("M2-19 an embed to a foreign host", () => {
  test("M2-19 https://evil.example/x is refused at Publish and never rendered", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "xm", (handle) =>
      draftOf(handle, [
        {
          id: "Ym1gA5uVf7Tx",
          type: "embed",
          visible: true,
          url: "https://evil.example/x",
          caption: "Not a video",
        },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 1 block before publishing.");
    expect(text).toContain(EMBED_MESSAGE);
    const field = rowOf(page, "Ym1gA5uVf7Tx").getByLabel("Link", { exact: true });
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(rowOf(page, "Ym1gA5uVf7Tx")).toContainText(EMBED_MESSAGE);
  });
});

test.describe("M2-20 and M2-21 images that are not the owner's", () => {
  test("M2-20 an image path in another user's folder is refused at Publish and never rendered", async ({
    page,
    context,
  }) => {
    const stranger = await makeUser("xstr");
    const user = await userWithDraft(context, "xi", (handle) =>
      draftOf(handle, [
        {
          id: "Im4gB6kWs8Xz",
          type: "image",
          visible: true,
          image: { path: `${stranger.id}/abcd1234-abcd1234.png`, width: 400, height: 300 },
          alt: "Someone else's picture",
          url: "",
        },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 1 block before publishing.");
    expect(text).toContain("That image isn’t in your uploads. Upload it again.");
    await expect(rowOf(page, "Im4gB6kWs8Xz")).toContainText(
      "That image isn’t in your uploads. Upload it again.",
    );
  });

  test("M2-20 an image block without an image or alt text says what to add", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "xa", (handle) =>
      draftOf(handle, [
        { id: "Im5gB6kWs8Xz", type: "image", visible: true, image: null, alt: "", url: "" },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 1 block before publishing.");
    expect(text).toContain("Upload an image.");
    expect(text).toContain("Add a short description of this image.");

    // The block's panel shows both messages under its fields.
    const row = rowOf(page, "Im5gB6kWs8Xz");
    await expect(row).toContainText("Upload an image.");
    await expect(row).toContainText("Add a short description of this image.");
    await expect(row.getByLabel("Alt text", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test("M2-21 a card image path in another user's folder is refused at Publish", async ({
    page,
    context,
  }) => {
    const stranger = await makeUser("xstc");
    const user = await userWithDraft(context, "xc", (handle) =>
      draftOf(handle, [
        {
          id: "Lc6hP0yRe3Zi",
          type: "card",
          visible: true,
          title: "Night Market",
          caption: "",
          url: "https://maraokafor.example/night-market",
          image: { path: `${stranger.id}/abcd1234-abcd1234.png`, width: 400, height: 300 },
        },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 1 block before publishing.");
    expect(text).toContain("That image isn’t in your uploads. Upload it again.");
    await expect(rowOf(page, "Lc6hP0yRe3Zi")).toContainText(
      "That image isn’t in your uploads. Upload it again.",
    );
  });
});

test.describe("M2-15 and M2-16 required fields", () => {
  test("M2-15 a link without label or address, and empty header and text blocks, say what to add", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "xr", (handle) =>
      draftOf(handle, [
        { id: "Bt5rJ1fGz6Os", type: "link", visible: true, label: "", url: "" },
        { id: "Hd7mN3cYb8Ue", type: "header", visible: true, text: "" },
        { id: "Ge2zU7qNc9Fl", type: "text", visible: true, text: "" },
        { id: "Vk3wD8tHa5Pr", type: "divider", visible: true },
      ]),
    );
    await openEditor(page);
    const text = await publishAndExpectRefusal(page, user);
    expect(text).toContain("Fix 3 blocks before publishing.");
    expect(text).toContain("Add a link label.");
    expect(text).toContain(URL_MESSAGE);
    expect(text).toContain("Add a heading.");
    expect(text).toContain("Add some text.");
    // The divider needs nothing: it has no message and is not counted.
    expect(text).not.toMatch(/Divider:/);
  });
});
