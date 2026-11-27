import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { desktopOnly } from "../fixtures/data";
import { MAILPIT, getMessage, messagesTo, waitForMessages } from "../fixtures/mailpit";
import { randomIp } from "../m4/analytics-ingest-helpers";
import { CONTACT_ID, contactForm, formPage, waitForRows } from "./forms-helpers";

/**
 * M17-10 locally, against Mailpit: a contact message with "Email me each message" on arrives at the
 * account's own address with the visitor as Reply-To; with it off, nothing arrives. The message is
 * stored either way.
 */

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

async function ownerEmail(userId: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("owner lookup failed");
  return data.user.email;
}

async function send(page: import("@playwright/test").Page, pageUrl: string) {
  await page.goto(pageUrl);
  await page.waitForTimeout(3200);
  const form = page.locator(`form[data-block-id="${CONTACT_ID}"]`);
  await form.getByLabel("Name").fill("Vera Visitor");
  await form.getByLabel("Email").fill("vera.visitor@example.test");
  await form.getByLabel("Message").fill("Hello <b>owner</b>\nBcc: someone@example.test");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sent");
}

test("M17-10 with the setting on, the message arrives at the owner's address with the visitor as Reply-To", async ({
  page,
}, info) => {
  test.skip(!desktopOnly(info), "one email pass is enough");
  const live = await formPage("fm1", { blocks: [contactForm({ notify: true })] });
  const owner = await ownerEmail(live.userId);
  await send(page, live.url);
  await waitForRows(live.pageId, 1);
  const [message] = await waitForMessages(owner, 1, 20_000);
  expect(message, `no email in ${MAILPIT} for the owner`).toBeTruthy();
  expect(message!.Subject).toBe("New message from your HYDLNK form");
  const full = (await getMessage(message!.ID)) as unknown as {
    To: { Address: string }[];
    ReplyTo: { Address: string }[];
    Bcc: unknown[] | null;
    Cc: unknown[] | null;
    HTML: string;
    Text: string;
  };
  expect(full.To.map((to) => to.Address)).toEqual([owner]);
  expect(full.ReplyTo.map((to) => to.Address)).toEqual(["vera.visitor@example.test"]);
  expect(full.Bcc ?? []).toEqual([]);
  expect(full.Cc ?? []).toEqual([]);
  expect(full.HTML).not.toContain("<b>owner</b>");
  expect(full.HTML).toContain("&lt;b&gt;owner&lt;/b&gt;");
  expect(full.Text).toContain("Vera Visitor");
});

test("M17-10 with the setting off, nothing arrives", async ({ page }, info) => {
  test.skip(!desktopOnly(info), "one email pass is enough");
  const live = await formPage("fm2", { blocks: [contactForm({ notify: false })] });
  const owner = await ownerEmail(live.userId);
  await send(page, live.url);
  await waitForRows(live.pageId, 1);
  await page.waitForTimeout(3000);
  expect(await messagesTo(owner)).toEqual([]);
});
