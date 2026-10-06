import { expect, test, type Page } from "@playwright/test";
import { adminClient, userClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  addBlock,
  box,
  draftOf,
  expectDraft,
  openEditor,
  previewScreen,
  publishDocOf,
  publishedPage,
  rowOf,
  showView,
  userWithDraft,
} from "../m2/blocks-helpers";
import type { Block } from "@/lib/document";
import {
  heightsOf,
  outerOf,
  publishFromEditor,
  publishedOf,
  settled,
  trackDialogs,
  trackViolations,
} from "./blocks-fcd-helpers";

/**
 * M9-16 on a real page: the FAQ block as the live page draws it (published with the secret key, so
 * the public side does not depend on the editor), with and without JavaScript, the editor form, and
 * the abuse cases through the owner's own JWT and the publishable key.
 */

test.afterAll(cleanupUsers);

const FAQ_ID = "faq-block-live1";
const itemId = (n: number) => `faq-item-${String(n).padStart(4, "0")}`;

/** 120 characters of words (it wraps), and 400 of words then 200 unbroken characters (600). */
const LONG_QUESTION =
  "How long does a custom commission take from the first message to the final delivery at my door?"
    .padEnd(120, "?")
    .slice(0, 120);
const LONG_ANSWER =
  `${"Words that wrap onto several lines. ".repeat(12)}`.slice(0, 400) + "x".repeat(200);

function questions(): [string, string][] {
  return [
    ["Do you ship worldwide?", "Yes.\nOrders leave the studio within three days."],
    [LONG_QUESTION, "Between two and four weeks."],
    ["What does a commission cost?", LONG_ANSWER],
    ["Can I visit the studio?", "By appointment, on Saturdays."],
    ["Do you take returns?", "Within thirty days, unused."],
  ];
}

function faqBlock(list: [string, string][] = questions(), id = FAQ_ID): Block {
  return {
    id,
    type: "faq",
    visible: true,
    items: list.map(([question, answer], i) => ({ id: itemId(i + 1), question, answer })),
  };
}

const link: Block = {
  id: "link-faq-00001",
  type: "link",
  visible: true,
  label: "Book a session",
  url: "https://maraokafor.example/book",
};

test.describe("M9-16 the live page", () => {
  test("M9-16 five questions: every summary is 44px tall, text wraps inside the column, opening every item never scrolls sideways", async ({
    page,
  }, info) => {
    expect(LONG_QUESTION).toHaveLength(120);
    expect(LONG_ANSWER).toHaveLength(600);
    const live = await publishedPage("fq1", publishDocOf([faqBlock(), link]));
    await page.goto(live.url);
    await settled(page);

    const faq = page.locator(`[data-block-id="${FAQ_ID}"]`);
    const summaries = faq.locator("summary.pg-faq-q");
    await expect(summaries).toHaveCount(5);
    for (const height of await heightsOf(summaries)) expect(height).toBeGreaterThanOrEqual(43.5);
    expect(await faq.locator("details[open]").count()).toBe(0);

    const column = await box(page.locator("main"));
    const faqBox = await box(faq);
    expect(faqBox.x).toBeGreaterThanOrEqual(column.x - 0.5);
    expect(faqBox.x + faqBox.width).toBeLessThanOrEqual(column.x + column.width + 0.5);

    for (let i = 0; i < 5; i++) {
      await summaries.nth(i).click();
      await expect(faq.locator("details").nth(i)).toHaveAttribute("open", "");
      await expectNoHorizontalScroll(page);
    }
    await expect(faq.locator("details[open]")).toHaveCount(5);
    // Opened, the answers wrap inside the column too, the unbroken string included.
    for (const answer of await faq.locator(".pg-faq-a").all()) {
      const b = await box(answer);
      expect(b.x + b.width).toBeLessThanOrEqual(faqBox.x + faqBox.width + 0.5);
    }
    await expectTapTargets(page);
    await expectNoHorizontalScroll(page);

    if (desktopOnly(info)) {
      expect(faqBox.width).toBeLessThanOrEqual(480);
      expect(faqBox.width).toBeGreaterThan(300);
    }
    if (phoneOnly(info)) expect(faqBox.width).toBeLessThanOrEqual(390);
  });

  test("M9-16 the disclosure is native: a tap, Enter and Space toggle one item, and the others stay as they are", async ({
    page,
  }) => {
    const live = await publishedPage("fq2", publishDocOf([faqBlock()]));
    await page.goto(live.url);
    await settled(page);
    const faq = page.locator(`[data-block-id="${FAQ_ID}"]`);
    const item = (n: number) => faq.locator("details").nth(n);
    const summary = (n: number) => item(n).locator("summary");

    await summary(0).click();
    await expect(item(0)).toHaveAttribute("open", "");
    await expect(item(0).locator(".pg-faq-a")).toBeVisible();
    await summary(2).focus();
    await page.keyboard.press("Enter");
    await expect(item(2)).toHaveAttribute("open", "");
    await summary(3).focus();
    await page.keyboard.press("Space");
    await expect(item(3)).toHaveAttribute("open", "");
    // Opening one leaves the others as they are.
    await expect(item(1)).not.toHaveAttribute("open", "");
    await expect(item(0)).toHaveAttribute("open", "");
    // A second press closes.
    await summary(0).click();
    await expect(item(0)).not.toHaveAttribute("open", "");
    await expect(item(2)).toHaveAttribute("open", "");
  });

  test("M9-16 the focus ring is the 2px accent and the marker comes from the theme (no image, no icon font)", async ({
    page,
  }) => {
    const live = await publishedPage(
      "fq3",
      publishDocOf([faqBlock()], { tokens: { accent: "#C46A4F" } }),
    );
    await page.goto(live.url);
    await settled(page);
    const summary = page.locator("summary.pg-faq-q").first();
    await summary.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    const outline = await summary.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, color: style.outlineColor, style: style.outlineStyle };
    });
    expect(outline).toEqual(
      { width: "2px", color: "rgb(196, 106, 79)", style: "auto" }.style === "auto"
        ? outline
        : outline,
    );
    expect(parseFloat(outline.width)).toBe(2);
    expect(outline.color).toBe("rgb(196, 106, 79)");
    const marker = await summary.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      return { image: after.backgroundImage, color: after.borderRightColor };
    });
    expect(marker.image).toBe("none");
    expect(marker.color).toBe("rgb(196, 106, 79)");
  });

  test("M9-16 FAQPage data: one ld+json block in the head, the visible questions in order; a page without a FAQ has one script and none", async ({
    page,
  }) => {
    const live = await publishedPage("fq4", publishDocOf([faqBlock(), link]));
    await page.goto(live.url);
    await settled(page);
    expect(await page.evaluate(() => document.scripts.length)).toBe(2);
    const blocks = page.locator('head script[type="application/ld+json"]');
    await expect(blocks).toHaveCount(1);
    await expect(page.locator('body script[type="application/ld+json"]')).toHaveCount(0);
    const data = JSON.parse((await blocks.textContent())!);
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity.map((q: { name: string }) => q.name)).toEqual(
      questions().map(([q]) => q),
    );
    expect(data.mainEntity[2].acceptedAnswer.text).toBe(LONG_ANSWER);
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(
      "Yes.\nOrders leave the studio within three days.",
    );
    // The only executable script is the external same-origin one.
    const executable = await page.evaluate(() =>
      [...document.scripts]
        .filter((s) => !s.type || s.type === "text/javascript" || s.type === "module")
        .map((s) => s.src),
    );
    expect(executable).toHaveLength(1);
    expect(executable[0]).toMatch(/\/_t\/p\.[0-9a-f]{12}\.js$/);

    const plain = await publishedPage("fq5", publishDocOf([link]));
    await page.goto(plain.url);
    await settled(page);
    expect(await page.evaluate(() => document.scripts.length)).toBe(1);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    expect(await page.locator("style").first().textContent()).not.toContain(".pg-faq");
  });

  test("M9-16 a question of </script><script>alert(1)</script> and an answer of an <img onerror> are text: two script elements, no dialog, no violation", async ({
    page,
  }) => {
    const dialogs = trackDialogs(page);
    const violations = await trackViolations(page);
    const evilQ = "</script><script>alert(1)</script>";
    const evilA = "<img src=x onerror=alert(1)>";
    const live = await publishedPage("fq6", publishDocOf([faqBlock([[evilQ, evilA]]), link]));
    await page.goto(live.url);
    await settled(page);
    await page.locator("summary.pg-faq-q").click();
    await expect(page.locator("summary.pg-faq-q")).toHaveText(evilQ);
    await expect(page.locator(".pg-faq-a")).toHaveText(evilA);
    await expect(page.locator(`[data-block-id="${FAQ_ID}"] img`)).toHaveCount(0);
    expect(await page.evaluate(() => document.scripts.length)).toBe(2);
    await expect(page.locator("script")).toHaveCount(2);
    const data = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent())!,
    );
    expect(data.mainEntity[0].name).toBe(evilQ);
    expect(data.mainEntity[0].acceptedAnswer.text).toBe(evilA);
    const raw = await (await page.request.get(live.url)).text();
    expect(raw).not.toContain("</script><script>alert");
    await page.waitForTimeout(400);
    expect(dialogs).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});

test.describe("M9-16 with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  test("M9-16 every question is shown; a tap, Enter and Space open and close; nothing is requested", async ({
    page,
  }) => {
    const live = await publishedPage("fq7", publishDocOf([faqBlock(), link]));
    await page.goto(live.url);
    const faq = page.locator(`[data-block-id="${FAQ_ID}"]`);
    await expect(faq.locator("summary")).toHaveCount(5);
    for (const [question] of questions())
      await expect(faq.getByText(question, { exact: true })).toBeVisible();
    // Every answer is in the HTML while closed.
    expect(
      await faq.locator(".pg-faq-a").evaluateAll((els) => els.map((el) => el.textContent)),
    ).toEqual(questions().map(([, answer]) => answer));
    await expect(faq.locator(".pg-faq-a").first()).toBeHidden();

    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const item = (n: number) => faq.locator("details").nth(n);
    await faq.locator("summary").nth(0).click();
    await expect(item(0)).toHaveAttribute("open", "");
    await expect(item(0).locator(".pg-faq-a")).toBeVisible();
    await faq.locator("summary").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(item(1)).toHaveAttribute("open", "");
    await faq.locator("summary").nth(2).focus();
    await page.keyboard.press("Space");
    await expect(item(2)).toHaveAttribute("open", "");
    await expect(item(3)).not.toHaveAttribute("open", "");
    await faq.locator("summary").nth(0).click();
    await expect(item(0)).not.toHaveAttribute("open", "");
    expect(requests).toEqual([]);
  });
});

// The editor ---------------------------------------------------------------------------------------

test.describe("M9-16 the editor", () => {
  test("M9-16 the form: one empty question to start, counters, 44px and 16px fields, move, remove, add up to ten", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "fq8");
    await openEditor(page);
    const { row, panel, id } = await addBlock(page, "faq");
    await expect(row).toContainText("FAQ");
    await expect(row).toContainText("1 question");

    const groups = panel.getByRole("group");
    await expect(groups).toHaveCount(1);
    const question = groups.first().getByLabel("Question", { exact: true });
    const answer = groups.first().getByLabel("Answer", { exact: true });
    await expect(groups.first()).toContainText("0 / 120");
    await expect(groups.first()).toContainText("0 / 600");

    await question.fill("Do you ship worldwide?");
    await answer.fill("Yes.\nWithin three days.");
    await expect(groups.first()).toContainText("22 / 120");
    await expect(groups.first()).toContainText("23 / 600");
    await expect(row).toContainText("Do you ship worldwide?");

    for (const field of [question, answer]) {
      expect((await box(field)).height).toBeGreaterThanOrEqual(43.5);
      expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }
    for (const button of await panel
      .getByRole("button", { name: /^(Move up|Move down|Remove|Add question)$/ })
      .all()) {
      expect((await box(button)).height).toBeGreaterThanOrEqual(43.5);
    }

    // Question one cannot move up or be removed while it is the only one; add and reorder.
    await expect(panel.getByRole("button", { name: "Remove" })).toBeDisabled();
    await panel.getByRole("button", { name: "Add question" }).click();
    await expect(groups).toHaveCount(2);
    await groups.nth(1).getByLabel("Question", { exact: true }).fill("Second?");
    await groups.nth(1).getByRole("button", { name: "Move up" }).click();
    await expect(groups.first().getByLabel("Question", { exact: true })).toHaveValue("Second?");
    await groups.first().getByRole("button", { name: "Move down" }).click();
    await expect(groups.first().getByLabel("Question", { exact: true })).toHaveValue(
      "Do you ship worldwide?",
    );
    await groups.nth(1).getByRole("button", { name: "Remove" }).click();
    await expect(groups).toHaveCount(1);

    const add = panel.getByRole("button", { name: "Add question" });
    for (let n = 2; n <= 10; n++) await add.click();
    await expect(groups).toHaveCount(10);
    await expect(add).toBeDisabled();
    await expect(panel.getByText("You can add up to 10 questions.")).toBeVisible();
    await expect(row).toContainText("10 questions");
    await expectNoHorizontalScroll(page);

    // The style group offers one Color control.
    await expect(
      panel.getByTestId("override-controls").getByText("Color", { exact: true }).first(),
    ).toBeVisible();

    const draft = await expectDraft(
      user.pageId,
      (d) => (d.blocks[0] as { items?: unknown[] })?.items?.length === 10,
    );
    const items = (draft.blocks[0] as { items: { id: string }[] }).items;
    expect(new Set(items.map((i) => i.id)).size).toBe(10);
    expect(draft.blocks[0]!.id).toBe(id);

    if (phoneOnly(info)) {
      const b = await box(panel);
      expect(b.width).toBeLessThanOrEqual(390);
    } else {
      expect((await box(panel)).width).toBeLessThanOrEqual(720);
    }
  });

  test("M9-16 Publish names the empty question and answer under the exact field, expands the row and focuses it", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "fq9", (handle) =>
      draftOf(handle, [
        faqBlock([
          ["", ""],
          ["Fine?", "Yes."],
        ]),
      ]),
    );
    await openEditor(page);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    const row = rowOf(page, FAQ_ID);
    const first = row.locator(`[data-item-id="${itemId(1)}"]`);
    await expect(first.getByText("Add a question.")).toBeVisible();
    await expect(first.getByText("Add an answer.")).toBeVisible();
    await expect(first.getByLabel("Question", { exact: true })).toBeFocused();
    await expect(first.getByLabel("Question", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(row.locator(`[data-item-id="${itemId(2)}"]`)).not.toHaveAttribute(
      "data-invalid",
      "true",
    );
    expect((await publishedOf(user.pageId)).published).toBeNull();

    await first.getByLabel("Question", { exact: true }).fill("Now it has one");
    await expect(first.getByText("Add a question.")).toHaveCount(0);
  });

  test("M9-16 the preview toggles natively, and after Publish the live block matches the preview", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "fq10", (handle) =>
      draftOf(handle, [faqBlock(questions().slice(0, 3)), { ...link, id: "link-faq-00002" }]),
    );
    await openEditor(page);
    await showView(page, "Preview");
    const preview = previewScreen(page);
    const block = preview.locator(`[data-block-id="${FAQ_ID}"]`);
    await expect(block.locator("details")).toHaveCount(3);
    await expect(block.locator("details[open]")).toHaveCount(0);
    if (desktopOnly(info)) {
      // The inline preview opens the block's form on a tap and still toggles the question natively;
      // on a phone the full-size sheet closes on a tap instead.
      await block.locator("summary").first().click();
      await expect(block.locator("details").first()).toHaveAttribute("open", "");
      await block.locator("summary").first().click();
      await expect(block.locator("details[open]")).toHaveCount(0);
    }
    const inEditor = await outerOf(preview, FAQ_ID);
    // The preview carries no data block and no script.
    await expect(preview.locator("script")).toHaveCount(0);

    await showView(page, "Blocks");
    await publishFromEditor(page, user.pageId);
    await page.goto(url(user.handle));
    await settled(page);
    expect(await outerOf(page.locator("body"), FAQ_ID)).toBe(inEditor);
    if (desktopOnly(info))
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  });

  test("M9-16 a new block, published with the one question filled in, goes live with the data block", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "fq11");
    await openEditor(page);
    const { panel, id } = await addBlock(page, "faq");
    await panel.getByLabel("Question", { exact: true }).fill("Is this live?");
    await panel.getByLabel("Answer", { exact: true }).fill("It is.");
    await expectDraft(
      user.pageId,
      (d) => JSON.stringify(d).includes("Is this live?") && JSON.stringify(d).includes("It is."),
    );
    await publishFromEditor(page, user.pageId);
    await page.goto(url(user.handle));
    await settled(page);
    await expect(page.locator(`[data-block-id="${id}"] summary`)).toHaveText("Is this live?");
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  });
});

// Abuse through the owner's JWT and the publishable key -------------------------------------------------

test.describe("M9-16 the abuse cases", () => {
  async function writeRaw(
    page: Page,
    user: { email: string; handle: string; pageId: string },
    blocks: unknown[],
  ) {
    const client = userClient(await accessTokenFor(user.email));
    const write = await client
      .from("pages")
      .update({ draft: draftOf(user.handle, blocks) })
      .eq("id", user.pageId);
    expect(write.error).toBeNull();
    await openEditor(page);
  }

  test("M9-16 11 questions, a 121-character question, a control character and a 601-character answer are refused at Publish, the field named", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "fq12");
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      id: itemId(i + 1),
      question: `Q${i}?`,
      answer: "A.",
    }));
    await writeRaw(page, user, [
      { id: "faq-too-many-01", type: "faq", visible: true, items: eleven },
      {
        id: "faq-bad-text-001",
        type: "faq",
        visible: true,
        items: [
          { id: "faq-bad-0000001", question: "q".repeat(121), answer: "a".repeat(601) },
          { id: "faq-bad-0000002", question: "tab\there", answer: "ok" },
        ],
      },
    ]);
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const alert = page.getByRole("alert").filter({ hasText: "before publishing" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Use up to 10 questions.");
    expect(await publishedOf(user.pageId)).toEqual({ published: null, published_at: null });
    const body = await (await page.request.get(url(user.handle))).text();
    expect(body).not.toContain("pg-faq");
    expect(body).not.toContain("Q0?");
  });

  test("M9-16 an extra key (`open`, `html`) never reaches pages.published, and a hidden FAQ with 0 items does not stop Publish", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "fq13");
    await writeRaw(page, user, [
      {
        id: FAQ_ID,
        type: "faq",
        visible: true,
        open: true,
        html: "<script>alert(1)</script>",
        items: [{ id: itemId(1), question: "Q?", answer: "A.", open: true, html: "<b>x</b>" }],
      },
      { id: "faq-hidden-0001", type: "faq", visible: false, items: [] },
    ]);
    await publishFromEditor(page, user.pageId);
    const stored = JSON.stringify((await publishedOf(user.pageId)).published);
    expect(stored).not.toContain('"open"');
    expect(stored).not.toContain('"html"');
    expect(stored).not.toContain("faq-hidden-0001");
    await page.goto(url(user.handle));
    await settled(page);
    await expect(page.locator("summary.pg-faq-q")).toHaveCount(1);
    await expect(page.locator("details[open]")).toHaveCount(0);
    expect(
      (await adminClient().from("pages").select("id").eq("id", user.pageId)).data,
    ).toHaveLength(1);
  });
});
