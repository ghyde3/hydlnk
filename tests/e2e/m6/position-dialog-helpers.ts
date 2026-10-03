import { expect, type Page } from "@playwright/test";

/**
 * "Use photo" in the "Position your photo" dialog (M6-24). Choosing a profile photo no longer
 * uploads at once: the dialog opens, and the upload starts when the person confirms. Specs that
 * only need a photo to be uploaded call this right after `setInputFiles` on the Profile card's file
 * input, then expect "Uploading..." and the new avatar as before.
 */
export async function confirmPhoto(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Position your photo" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Use photo", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
