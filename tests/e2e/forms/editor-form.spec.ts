import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { addBlock, expectDraft, openEditor, previewScreen, showView } from "../m2/blocks-helpers";
import { emptyUser } from "../m2/editor-helpers";
import { publishFromEditor } from "../m9/page-helpers";
import type { FormBlock } from "@/lib/document";

/**
 * M17-07 at 390x844 and 1440x900 on the editor: add a form block, edit every field, switch the kind
 * (the default words follow, typed ones stay), the preview shows the form and pressing its button
 * sends nothing, publish, and the live page draws the same form.
 */

test("M17-07 add, edit and publish a form block; the preview posts nowhere", async ({
  page,
  context,
}) => {
  const user = await emptyUser(context, "fed", { plan: "free" });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/f/")) posts.push(request.url());
  });
  await openEditor(page);
  const { panel, id, row } = await addBlock(page, "form");
  await expect(row).toContainText("Sign-up form");

  const field = (name: string) => panel.locator(`[data-field="${name}"]`);
  await expect(field("kind")).toHaveValue("signup");
  await expect(field("buttonLabel")).toHaveValue("Subscribe");
  await expect(field("consent")).toHaveValue(
    "Your details go to the owner of this page, who may contact you.",
  );
  await expect(field("notify")).toHaveCount(0);

  // Switching the kind swaps the default words; switching back swaps them again.
  await field("kind").selectOption("contact");
  await expect(field("buttonLabel")).toHaveValue("Send");
  await expect(field("successMessage")).toHaveValue("Thanks. Your message was sent.");
  await expect(field("askName")).toHaveCount(0);
  await expect(panel.getByTestId("form-notify")).toContainText(
    `Messages go to ${user.email}, your sign-in address.`,
  );

  // Every field, then a typed label survives a kind switch.
  await field("heading").fill("Write to me");
  await field("description").fill("I answer within a day.");
  await field("buttonLabel").fill("Send it");
  await field("successMessage").fill("Got it. Talk soon.");
  await field("consent").fill("I may write back to you.");
  await field("notify").click();
  await field("kind").selectOption("signup");
  await expect(field("buttonLabel")).toHaveValue("Send it");
  await field("askName").click();
  await field("kind").selectOption("contact");
  await expect(row).toContainText("Write to me");

  await expectDraft(user.pageId, (draft) => {
    const block = draft.blocks.find((b) => b.id === id) as FormBlock | undefined;
    return (
      block?.kind === "contact" &&
      block.heading === "Write to me" &&
      block.buttonLabel === "Send it" &&
      block.notify === true &&
      block.consent === "I may write back to you."
    );
  });

  // Controls of the panel: 44px, 16px inputs, no sideways scroll.
  await expectTapTargets(page, '[id^="block-panel-"]');
  for (const input of await panel.locator("input, select").all()) {
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
  }
  await expectNoHorizontalScroll(page);

  // The preview shows the form, and its button sends nothing.
  await showView(page, "Preview");
  const preview = previewScreen(page).locator(`form[data-block-id="${id}"]`);
  await expect(preview.getByRole("heading", { name: "Write to me" })).toBeVisible();
  // One canonical form of the markup (attribute order differs between React on the client and the
  // server's string), compared with the live page below.
  const canonical = (el: Element): string => {
    const walk = (node: Element): string => {
      const attrs = [...node.attributes]
        .filter((attr) => attr.name !== "value")
        .map((attr) => `${attr.name}="${attr.value}"`)
        .sort()
        .join(" ");
      return `<${node.tagName.toLowerCase()} ${attrs}>${[...node.childNodes]
        .map((child) => (child.nodeType === 1 ? walk(child as Element) : (child.textContent ?? "")))
        .join("")}</${node.tagName.toLowerCase()}>`;
    };
    return walk(el);
  };
  const previewHtml = await preview.evaluate(
    `(${canonical.toString()})(document.querySelector('[data-testid="preview-screen"] form[data-block-id="${id}"]'))`,
  );
  await preview.getByLabel("Name").fill("Vera");
  await preview.getByLabel("Email").fill("vera@example.test");
  await preview.getByLabel("Message").fill("Hi");
  await preview.getByRole("button", { name: "Send it" }).click({ force: true });
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
  if (await page.getByTestId("preview-sheet").isVisible()) await showView(page, "Blocks");

  await publishFromEditor(page);
  await page.goto(url(user.handle));
  const live = page.locator(`form[data-block-id="${id}"]`);
  await expect(live.getByRole("heading", { name: "Write to me" })).toBeVisible();
  // The same component draws both: the live markup is the preview's.
  const liveHtml = await page.evaluate(
    `(${canonical.toString()})(document.querySelector('form[data-block-id="${id}"]'))`,
  );
  expect(liveHtml).toBe(previewHtml);
  await expectNoHorizontalScroll(page);
});
