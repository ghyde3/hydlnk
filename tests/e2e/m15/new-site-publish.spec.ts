import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, rand, trackEmail } from "../fixtures/data";
import { rawRequest } from "../fixtures/http";
import { getMessage, signInLinkFrom, waitForMessages } from "../fixtures/mailpit";
import { url } from "../helpers";
import { addBlock } from "../m2/blocks-helpers";
import { openEditor, statusChip } from "../m2/editor-helpers";

/**
 * M15-07: a brand-new account created after the cutover can publish. Sign up through the real
 * signup form and emailed link, claim a fresh handle, add one block, press Publish, then read the
 * handle host and find the block in the live HTML. The database holds exactly one '/' page entry
 * for the site. Guards the checkpoint finding that new sites could not publish. Runs at phone
 * 390x844 and desktop 1440x900.
 */

const RUN = rand(5);

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 180_000 });

test("M15-07 a new site made after the cutover publishes and serves its block", async ({
  page,
}, testInfo) => {
  const tag = testInfo.project.name === "phone" ? "p" : "d";
  const handle = `zq-ns-${RUN}-${tag}`;
  const email = `ns-${RUN}-${tag}@example.com`;
  const headline = `Hello ${RUN}${tag}`;
  trackEmail(email);

  // Sign up: the handle is available, the emailed link opens the editor.
  await page.goto(url("app", `/signup?handle=${handle}`));
  await expect(page.getByText(`${handle}.hydlnk.com is available`)).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const [message] = await waitForMessages(email, 1);
  await page.goto(signInLinkFrom((await getMessage(message!.ID)).HTML));
  await page.waitForURL(url("app", "/editor"), { timeout: 30_000 });
  await openEditor(page);

  // One block, then Publish.
  const { panel } = await addBlock(page, "header");
  await panel.locator('[data-field="text"]').first().fill(headline);
  const admin = adminClient();
  const site = await admin.from("pages").select("id").eq("handle", handle).single();
  expect(site.error).toBeNull();
  const siteId = site.data!.id as string;
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("content_entries")
          .select("draft")
          .eq("site_id", siteId)
          .eq("draft->>path", "/");
        return JSON.stringify(data ?? []).includes(headline);
      },
      { message: "autosave reached Home's entry", timeout: 20_000 },
    )
    .toBe(true);
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveText("Published", { timeout: 30_000 });

  // The handle host serves the block.
  await expect
    .poll(async () => (await rawRequest(`${handle}.localhost:3000`, "/")).body, { timeout: 20_000 })
    .toContain(headline);
  const live = await rawRequest(`${handle}.localhost:3000`, "/");
  expect(live.status).toBe(200);

  // Exactly one '/' page entry, and it is the published one.
  const entries = await admin
    .from("content_entries")
    .select("published, deleted_at")
    .eq("site_id", siteId)
    .eq("draft->>path", "/");
  expect(entries.error).toBeNull();
  expect(entries.data).toHaveLength(1);
  expect(entries.data![0]!.deleted_at).toBeNull();
  expect(JSON.stringify(entries.data![0]!.published)).toContain(headline);
});
