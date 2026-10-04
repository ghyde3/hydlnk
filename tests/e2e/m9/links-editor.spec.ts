import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, url } from "../helpers";
import { draftOf, userWithDraft } from "../m2/blocks-helpers";
import { expectDraft, openEditor, rowOf, statusChip } from "../m2/editor-helpers";
import { openTab, publishButton, undoButton, redoButton } from "../m7/workspace-helpers";
import { UTM_PATTERN_MESSAGE, type DraftDoc } from "@/lib/document";
import { getClick, getPage, postClick } from "./links-helpers";

/**
 * M9-28 the UTM controls (the Share tab's 'Link tracking' card and a link's 'Link tags' group), M9-30
 * the lock group of a link, and M9-32 the Share tab's 'Redirect mode' card, in the editor, on both
 * viewports: what they write into the draft, what Publish does with it, and what the live /r/ path
 * then answers.
 */

test.afterAll(async () => {
  await cleanupUsers();
});
test.describe.configure({ timeout: 120_000 });

const A = "lnk-edit-aaaa01";
const B = "lnk-edit-bbbb02";
const C = "lnk-edit-cccc03";

const link = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "link",
  visible: true,
  label: `Link ${id.slice(-2)}`,
  url: `https://shop.example/${id.slice(-2)}`,
  ...extra,
});

async function expand(page: Page, id: string): Promise<Locator> {
  const row = rowOf(page, id);
  const main = row.locator("button[aria-expanded]").first();
  if ((await main.getAttribute("aria-expanded")) !== "true") await main.click();
  const panel = row.locator('[id^="block-panel-"]');
  await expect(panel).toBeVisible();
  return panel;
}

const fontSize = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).fontSize);
const height = async (locator: Locator) => (await locator.boundingBox())!.height;
const blockOf = (draft: DraftDoc, id: string) =>
  draft.blocks.find((block) => block.id === id) as unknown as Record<string, unknown>;

// M9-28 ----------------------------------------------------------------------------------------

test.describe("M9-28 Link tracking: the page defaults", () => {
  const card = (page: Page) => page.getByTestId("link-tracking-card");
  const input = (page: Page, name: string) => card(page).getByLabel(name, { exact: true });

  test("M9-28 the card after the share card: three 16px, 44px fields with counters and placeholders, a disabled Clear all, the hint and the example", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "tr1", (h) => draftOf(h, [link(A)]));
    await openTab(page, "Share");
    await expect(card(page).getByRole("heading", { name: "Link tracking" })).toBeVisible();
    // It sits after the share card in the column, and has no Pro chip.
    const order = await page
      .locator("[data-testid='share-card'], [data-testid='link-tracking-card']")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(order).toEqual(["share-card", "link-tracking-card"]);
    await expect(card(page).getByText(/\bPro\b/)).toHaveCount(0);

    for (const [name, placeholder] of [
      ["Source", "hydlnk"],
      ["Medium", "link-in-bio"],
      ["Campaign", "spring-launch"],
    ] as const) {
      const field = input(page, name);
      await expect(field).toHaveAttribute("placeholder", placeholder);
      expect(await fontSize(field)).toBe("16px");
      expect(await height(field)).toBeGreaterThanOrEqual(44);
    }
    await expect(card(page).getByText("0 / 40")).toHaveCount(3);
    await expect(
      card(page).getByText(
        "Added to the end of every link on your page, such as ?utm_source=hydlnk. Email and phone links are left alone.",
      ),
    ).toBeVisible();
    const clear = card(page).getByRole("button", { name: "Clear all" });
    await expect(clear).toBeDisabled();
    expect(await height(clear)).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("utm-example")).toHaveText("https://example.com/page");
    await expectNoHorizontalScroll(page);
  });

  test("M9-28 typing writes the draft within seconds, flips the status chip, updates the live example, and Clear all removes the key", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "tr2", (h) => draftOf(h, [link(A)]));
    await openTab(page, "Share");

    await input(page, "Source").fill("hydlnk");
    await input(page, "Medium").fill("link-in-bio");
    await input(page, "Campaign").fill("spring launch");
    await expect(page.getByTestId("utm-example")).toHaveText(
      "https://example.com/page?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring+launch",
    );
    await expect(card(page).getByText("6 / 40")).toBeVisible();
    await expect(card(page).getByText("13 / 40")).toBeVisible();
    const saved = await expectDraft(user.pageId, (d) => d.utm?.campaign === "spring launch");
    expect(saved.utm).toEqual({
      source: "hydlnk",
      medium: "link-in-bio",
      campaign: "spring launch",
    });
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");

    // An emptied field removes its key.
    await input(page, "Medium").fill("");
    await expectDraft(user.pageId, (d) => d.utm !== undefined && !("medium" in d.utm));

    // Clear all removes the object.
    const clear = card(page).getByRole("button", { name: "Clear all" });
    await expect(clear).toBeEnabled();
    await clear.click();
    await expectDraft(user.pageId, (d) => d.utm === undefined);
    await expect(clear).toBeDisabled();
    await expect(page.getByTestId("utm-example")).toHaveText("https://example.com/page");
  });

  test("M9-28 each change is an undo step: Undo and Redo move the defaults", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "tr3", (h) => draftOf(h, [link(A)]));
    await openTab(page, "Share");
    await input(page, "Source").fill("hydlnk");
    await expect(undoButton(page)).toBeEnabled();
    await undoButton(page).click();
    await expect(input(page, "Source")).toHaveValue("");
    await expectDraft(user.pageId, (d) => d.utm === undefined);
    await redoButton(page).click();
    await expect(input(page, "Source")).toHaveValue("hydlnk");
    await expectDraft(user.pageId, (d) => d.utm?.source === "hydlnk");
  });

  test("M9-28 abuse: a & value shows the error while typing and the draft saves anyway; Publish refuses it, names the field and takes focus there", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "tr4", (h) => draftOf(h, [link(A)]));
    await openTab(page, "Share");
    await input(page, "Medium").fill("a&utm_medium=x");
    await expect(card(page).getByText(UTM_PATTERN_MESSAGE)).toBeVisible();
    await expectDraft(user.pageId, (d) => d.utm?.medium === "a&utm_medium=x");

    await publishButton(page).click();
    await expect(card(page).getByText(UTM_PATTERN_MESSAGE)).toBeVisible();
    await expect(input(page, "Medium")).toBeFocused();
    await expect(input(page, "Medium")).toHaveAttribute("aria-invalid", "true");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");
    // A value of <b>x</b> is drawn as characters, no dialog, no markup.
    await input(page, "Medium").fill("<b>x</b>");
    await expect(input(page, "Medium")).toHaveValue("<b>x</b>");
    await expect(card(page).locator("b")).toHaveCount(0);
    await expect(card(page).getByText(UTM_PATTERN_MESSAGE)).toBeVisible();
  });

  test("M9-28 the card's controls are 44px with 16px text, the example wraps, nothing scrolls sideways, and at 1440 it sits in the 720px Share column", async ({
    page,
    context,
  }, info) => {
    await userWithDraft(context, "tr5", (h) => draftOf(h, [link(A)]));
    await openTab(page, "Share");
    await input(page, "Source").fill("a".repeat(40));
    await input(page, "Medium").fill("b".repeat(40));
    await input(page, "Campaign").fill("c".repeat(40));
    const example = page.getByTestId("utm-example");
    expect(await example.evaluate((el) => getComputedStyle(el).overflowWrap)).toBe("anywhere");
    await expectNoHorizontalScroll(page);
    for (const control of [
      input(page, "Source"),
      input(page, "Medium"),
      input(page, "Campaign"),
      card(page).getByRole("button", { name: "Clear all" }),
    ]) {
      expect(await height(control)).toBeGreaterThanOrEqual(44);
    }
    const box = (await card(page).boundingBox())!;
    if (info.project.name === "desktop") expect(box.width).toBeLessThanOrEqual(720);
  });
});

test.describe("M9-28 Link tags on a link", () => {
  test("M9-28 'Page defaults | Custom | None': each 44px, writes and removes the keys, shows the row chip and the example", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "tg1", (h) =>
      draftOf(h, [link(A)], { utm: { source: "hydlnk" } } as never),
    );
    await openEditor(page);
    const panel = await expand(page, A);
    const group = panel.getByTestId("link-tags-field");
    const radio = (name: string) => group.getByRole("radio", { name, exact: true });

    for (const name of ["Page defaults", "Custom", "None"])
      expect(await height(radio(name))).toBeGreaterThanOrEqual(44);
    await expect(radio("Page defaults")).toHaveAttribute("aria-checked", "true");
    // The example is the link's own address with the page default.
    await expect(group.getByTestId("link-utm-example")).toHaveText(
      "https://shop.example/01?utm_source=hydlnk",
    );

    await radio("Custom").click();
    const source = group.locator('[data-field="utm-source"]');
    await expect(source).toHaveAttribute("placeholder", "hydlnk");
    await expect(group.locator('[data-field="utm-medium"]')).toHaveAttribute(
      "placeholder",
      "link-in-bio",
    );
    expect(await fontSize(source)).toBe("16px");
    expect(await height(source)).toBeGreaterThanOrEqual(44);
    await source.fill("newsletter");
    await expect(group.getByTestId("link-utm-example")).toHaveText(
      "https://shop.example/01?utm_source=newsletter",
    );
    await expectDraft(
      user.pageId,
      (d) => JSON.stringify(blockOf(d, A).utm) === JSON.stringify({ source: "newsletter" }),
    );
    if (info.project.name === "desktop")
      await expect(rowOf(page, A).getByTestId("link-tags-chip")).toHaveText("Custom tags");
    else await expect(rowOf(page, A).getByTestId("link-tags-chip")).toBeHidden();

    await radio("None").click();
    await expectDraft(
      user.pageId,
      (d) => JSON.stringify(blockOf(d, A).utm) === JSON.stringify({ off: true }),
    );
    if (info.project.name === "desktop")
      await expect(rowOf(page, A).getByTestId("link-tags-chip")).toHaveText("No tags");
    await expect(group.getByTestId("link-utm-example")).toHaveCount(0);

    await radio("Page defaults").click();
    await expectDraft(user.pageId, (d) => !("utm" in blockOf(d, A)));
    await expect(rowOf(page, A).getByTestId("link-tags-chip")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("M9-28 end to end: set the page defaults, a link to Custom, another to None, Publish, and /r/ answers with the tags; a default changed without Publish changes nothing live", async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180_000);
    const user = await userWithDraft(context, "tg2", (h) =>
      draftOf(h, [link(A), link(B), link(C)]),
    );
    await openTab(page, "Share");
    const card = page.getByTestId("link-tracking-card");
    await card.getByLabel("Source", { exact: true }).fill("hydlnk");
    await card.getByLabel("Medium", { exact: true }).fill("link-in-bio");
    await card.getByLabel("Campaign", { exact: true }).fill("spring");
    await expectDraft(user.pageId, (d) => d.utm?.campaign === "spring");

    await page.goto(url("app", "/editor"));
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    const panelA = await expand(page, A);
    await panelA.getByTestId("link-tags-field").getByRole("radio", { name: "Custom" }).click();
    await panelA
      .getByTestId("link-tags-field")
      .locator('[data-field="utm-source"]')
      .fill("newsletter");
    const panelB = await expand(page, B);
    await panelB.getByTestId("link-tags-field").getByRole("radio", { name: "None" }).click();
    await expectDraft(
      user.pageId,
      (d) =>
        JSON.stringify(blockOf(d, B).utm) === JSON.stringify({ off: true }) &&
        blockOf(d, A).utm !== undefined,
    );

    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });

    const live = {
      host: `${user.handle}.localhost:3000`,
      origin: `http://${user.handle}.localhost:3000`,
      pageId: user.pageId,
    };
    const at = async (id: string) => (await getClick(live as never, id)).location;
    expect(await at(A)).toBe(
      "https://shop.example/01?utm_source=newsletter&utm_medium=link-in-bio&utm_campaign=spring",
    );
    expect(await at(B)).toBe("https://shop.example/02");
    expect(await at(C)).toBe(
      "https://shop.example/03?utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring",
    );
    // The page's markup holds no tag.
    expect((await getPage(live.host)).body).not.toContain("utm_");

    // Change a default and do not publish: the live redirect is as it was.
    await page.goto(url("app", "/share"));
    await page
      .getByTestId("link-tracking-card")
      .getByLabel("Campaign", { exact: true })
      .fill("autumn");
    await expectDraft(user.pageId, (d) => d.utm?.campaign === "autumn");
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes");
    expect(await at(C)).toContain("utm_campaign=spring");
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });
    expect(await at(C)).toContain("utm_campaign=autumn");
    void info;
  });

  test("M9-28 a bad value in a link's own tags: the error shows while typing, the draft saves, Publish names the field", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "tg3", (h) =>
      draftOf(h, [link(A, { utm: { source: "ok" } })]),
    );
    await openEditor(page);
    const panel = await expand(page, A);
    const source = panel.getByTestId("link-tags-field").locator('[data-field="utm-source"]');
    await source.fill("a=b");
    await expect(panel.getByText(UTM_PATTERN_MESSAGE)).toBeVisible();
    await expectDraft(
      user.pageId,
      (d) => (blockOf(d, A).utm as { source: string }).source === "a=b",
    );
    await publishButton(page).click();
    await expect(source).toBeFocused();
    await expect(panel.getByText(UTM_PATTERN_MESSAGE)).toBeVisible();
  });
});

// M9-30 ----------------------------------------------------------------------------------------

test.describe("M9-30 Lock this link", () => {
  const CODE = "Spring2026";

  const lockField = (panel: Locator) => panel.getByTestId("link-lock-field");
  const kind = (panel: Locator) => lockField(panel).getByLabel("Lock this link", { exact: true });
  const codeInput = (panel: Locator) => lockField(panel).locator('[data-field="lock-code"]');
  const lockOf = (draft: DraftDoc) =>
    blockOf(draft, A).lock as { kind: string; salt?: string; hash?: string } | undefined;

  test("M9-30 the group's select, field and buttons are 44px with 16px text; Age check needs nothing else and writes {kind:'age'}; the row says Locked", async ({
    page,
    context,
  }, info) => {
    const user = await userWithDraft(context, "lk1", (h) => draftOf(h, [link(A)]));
    await openEditor(page);
    const panel = await expand(page, A);
    expect(await height(kind(panel))).toBeGreaterThanOrEqual(44);
    expect(await fontSize(kind(panel))).toBe("16px");
    await expect(kind(panel)).toHaveValue("none");

    await kind(panel).selectOption("age");
    await expectDraft(
      user.pageId,
      (d) => JSON.stringify(lockOf(d)) === JSON.stringify({ kind: "age" }),
    );
    await expect(codeInput(panel)).toHaveCount(0);
    if (info.project.name === "desktop")
      await expect(rowOf(page, A).getByTestId("lock-chip")).toHaveText("Locked");
    else await expect(rowOf(page, A).getByTestId("lock-chip")).toBeHidden();

    await kind(panel).selectOption("code");
    await expect(codeInput(panel)).toBeVisible();
    expect(await fontSize(codeInput(panel))).toBe("16px");
    expect(await height(codeInput(panel))).toBeGreaterThanOrEqual(44);
    await expect(codeInput(panel)).toHaveAttribute("placeholder", "Choose a code");
    await expect(lockField(panel).getByText("0 / 32")).toBeVisible();
    expect(await height(lockField(panel).getByTestId("lock-set-code"))).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    await kind(panel).selectOption("none");
    await expectDraft(user.pageId, (d) => lockOf(d) === undefined);
    await expect(rowOf(page, A).getByTestId("lock-chip")).toHaveCount(0);
  });

  test("M9-30 Set code: the plaintext travels in one Server Action request only, the draft holds the salt and hash, and Undo and Redo move the lock without the plaintext", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "lk2", (h) => draftOf(h, [link(A)]));
    const leaks: { method: string; url: string; action: boolean }[] = [];
    page.on("request", (request) => {
      const body = request.postData() ?? "";
      if (body.includes(CODE))
        leaks.push({
          method: request.method(),
          url: request.url(),
          action: "next-action" in request.headers(),
        });
    });
    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages"))
        patches.push(request.postData() ?? "");
    });
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));

    await openEditor(page);
    const panel = await expand(page, A);
    await kind(panel).selectOption("code");
    await codeInput(panel).fill(CODE);
    await lockField(panel).getByTestId("lock-set-code").click();
    await expect(
      lockField(panel).getByText("A code is set. Enter a new one to change it."),
    ).toBeVisible();
    await expect(codeInput(panel)).toHaveValue("");

    const saved = await expectDraft(user.pageId, (d) => (lockOf(d)?.hash?.length ?? 0) === 43);
    expect(lockOf(saved)).toMatchObject({ kind: "code" });
    expect(lockOf(saved)!.salt).toHaveLength(22);
    // The plaintext is in the one Server Action request and nowhere else.
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.action).toBe(true);
    expect(patches.length).toBeGreaterThan(0);
    for (const body of patches) expect(body).not.toContain(CODE);
    expect(messages.join("\n")).not.toContain(CODE);
    expect(await page.content()).not.toContain(CODE);
    await expect(lockField(panel).getByTestId("lock-remove")).toBeVisible();

    // Undo takes the hash away (one step per change) and Redo brings it back, never holding the plaintext.
    await undoButton(page).click();
    await expectDraft(user.pageId, (d) => lockOf(d)?.hash === undefined);
    await redoButton(page).click();
    await expectDraft(user.pageId, (d) => lockOf(d)?.hash?.length === 43);
    expect(await page.content()).not.toContain(CODE);

    await lockField(panel).getByTestId("lock-remove").click();
    await expectDraft(user.pageId, (d) => lockOf(d) === undefined);
    await expect(kind(panel)).toHaveValue("none");
  });

  test("M9-30 a code that breaks the rule shows 'Use 4 to 32 characters with no spaces.' and sends nothing; a failed action says so with Retry", async ({
    page,
    context,
  }) => {
    await userWithDraft(context, "lk3", (h) => draftOf(h, [link(A)]));
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && "next-action" in request.headers())
        sent.push(request.postData() ?? "");
    });
    await openEditor(page);
    const panel = await expand(page, A);
    await kind(panel).selectOption("code");
    for (const bad of ["ab", "has space", "x".repeat(33)]) {
      await codeInput(panel).fill(bad);
      await expect(
        lockField(panel).getByText("Use 4 to 32 characters with no spaces."),
      ).toBeVisible();
      await lockField(panel).getByTestId("lock-set-code").click();
      await expect(
        lockField(panel).getByText("Use 4 to 32 characters with no spaces."),
      ).toBeVisible();
    }
    expect(sent).toEqual([]);

    // The action fails (the request is cut): the sentence and a Retry button.
    await codeInput(panel).fill(CODE);
    await page.route("**/*", (route) => {
      if ("next-action" in route.request().headers()) return route.abort();
      return route.continue();
    });
    await lockField(panel).getByTestId("lock-set-code").click();
    await expect(lockField(panel).getByText("Couldn’t set the code. Try again.")).toBeVisible();
    await expect(lockField(panel).getByRole("button", { name: "Retry" })).toBeVisible();
    await page.unroute("**/*");
    await lockField(panel).getByRole("button", { name: "Retry" }).click();
    await expect(
      lockField(panel).getByText("A code is set. Enter a new one to change it."),
    ).toBeVisible();
  });

  test("M9-30 a code lock with no hash saves and fails at Publish: 'Set a code for this lock.' under the field, with focus", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "lk4", (h) =>
      draftOf(h, [link(A, { lock: { kind: "code" } })]),
    );
    await openEditor(page);
    await expand(page, A);
    await publishButton(page).click();
    const panel = rowOf(page, A).locator('[id^="block-panel-"]');
    await expect(lockField(panel).getByText("Set a code for this lock.")).toBeVisible();
    await expect(codeInput(panel)).toBeFocused();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");
    expect(lockOf(await expectDraft(user.pageId, () => true))).toEqual({ kind: "code" });
  });

  test("M9-30 end to end: set a code in the editor, Publish, and /r/ opens only with that code (any case)", async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180_000);
    const user = await userWithDraft(context, "lk5", (h) =>
      draftOf(h, [link(A, { url: "https://shop.example/vault" })]),
    );
    await openEditor(page);
    const panel = await expand(page, A);
    await kind(panel).selectOption("code");
    await codeInput(panel).fill(CODE);
    await lockField(panel).getByTestId("lock-set-code").click();
    await expect(
      lockField(panel).getByText("A code is set. Enter a new one to change it."),
    ).toBeVisible();
    await expectDraft(user.pageId, (d) => lockOf(d)?.hash?.length === 43);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });

    const live = {
      host: `${user.handle}.localhost:3000`,
      origin: `http://${user.handle}.localhost:3000`,
      pageId: user.pageId,
    };
    expect((await getClick(live as never, A)).status).toBe(200);
    const wrong = await postClick(live as never, A, "code=nope-nope");
    expect(wrong.status).toBe(403);
    for (const code of [CODE, CODE.toLowerCase(), ` ${CODE.toUpperCase()} `]) {
      const ok = await postClick(live as never, A, new URLSearchParams({ code }).toString());
      expect(ok.status, code).toBe(303);
      expect(ok.location).toBe("https://shop.example/vault");
    }
    // The live page marks the link, and its markup holds no destination, salt or hash.
    const html = (await getPage(live.host)).body;
    expect(html).toContain('data-locked="code"');
    expect(html).not.toContain("vault");
    void info;
  });

  test("M9-30 in the editor preview the locked link has the marker and no href", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "the bezel is beside the editor from 760px");
    await userWithDraft(context, "lk6", (h) => draftOf(h, [link(A, { lock: { kind: "age" } })]));
    await openEditor(page);
    const anchor = page.getByTestId("preview-screen").locator(`.pg-link[data-block-id="${A}"]`);
    await expect(anchor).toHaveAttribute("data-locked", "age");
    await expect(anchor).not.toHaveAttribute("href", /.*/);
    await expect(anchor.locator("svg.pg-lock-glyph")).toBeVisible();
  });
});

// M9-32 ----------------------------------------------------------------------------------------

test.describe("M9-32 Redirect mode", () => {
  const card = (page: Page) => page.getByTestId("redirect-card");
  const toggle = (page: Page) =>
    card(page).getByRole("switch", { name: "Send visitors straight to one link" });
  const select = (page: Page) => card(page).getByLabel("Link", { exact: true });

  test("M9-32 Free: the card is visible under the address card with a Pro chip, the controls do nothing, no request is made, and See plans goes to the plans", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(context, "rm1", (h) => draftOf(h, [link(A), link(B)]), {
      plan: "free",
    });
    await openTab(page, "Share");
    const order = await page
      .locator(
        "[data-testid='address-card'], [data-testid='redirect-card'], [data-testid='share-card']",
      )
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(order).toEqual(["address-card", "redirect-card", "share-card"]);
    await expect(card(page).getByTestId("redirect-pro-chip")).toHaveText("Pro");
    await expect(card(page).getByText("Redirect mode is part of Pro.")).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-disabled", "true");
    await expect(select(page)).toBeDisabled();
    await expect(select(page)).toHaveAttribute("aria-disabled", "true");
    await expect(card(page).getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "/settings#plans",
    );

    const patches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") patches.push(request.postData() ?? "");
    });
    await toggle(page).click({ force: true });
    await toggle(page).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    expect(patches.filter((body) => body.includes("redirect"))).toEqual([]);
    expect((await expectDraft(user.pageId, () => true)).redirect).toBeUndefined();
    await expectNoHorizontalScroll(page);
  });

  test("M9-32 Pro: switch on writes the draft, shows the warning and the bezel caption; Publish turns the live redirect on; off removes it again", async ({
    page,
    context,
  }, info) => {
    test.setTimeout(180_000);
    const user = await userWithDraft(context, "rm2", (h) => draftOf(h, [link(A), link(B)]), {
      plan: "pro",
    });
    await openTab(page, "Share");

    // The switch is 44px, a real button with role=switch; the select lists the eligible links by label.
    expect(await height(toggle(page))).toBeGreaterThanOrEqual(44);
    expect(await height(select(page))).toBeGreaterThanOrEqual(44);
    expect(await fontSize(select(page))).toBe("16px");
    await expect(select(page).locator("option")).toHaveText(["Link 01", "Link 02"]);
    await expect(card(page).getByTestId("redirect-warning")).toHaveCount(0);

    await select(page).selectOption(B);
    await expect((await expectDraft(user.pageId, () => true)).redirect).toBeUndefined();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
    await expect(card(page).getByTestId("redirect-warning")).toHaveText(
      "Your page won’t be shown while this is on. Visitors go straight to the link. Turn it off to show your page again.",
    );
    await expect(card(page).getByTestId("redirect-state")).toHaveText(
      "Turned on in your draft. Publish to start.",
    );
    await expectDraft(
      user.pageId,
      (d) => JSON.stringify(d.redirect) === JSON.stringify({ linkId: B }),
    );
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");
    if (info.project.name === "desktop")
      await expect(page.getByTestId("redirect-caption")).toHaveText(
        "Redirect mode is on. Visitors skip this page.",
      );

    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });
    await expect(card(page).getByTestId("redirect-state")).toHaveText(
      "Visitors go straight to Link 02.",
    );
    const host = `${user.handle}.localhost:3000`;
    const live = await getPage(host);
    expect(live.status).toBe(302);
    expect(live.location).toBe(`/r/${user.pageId}/${B}`);

    // The editor's own preview and the owner's draft still show the page.
    if (info.project.name === "desktop")
      await expect(page.getByTestId("preview-screen").locator("[data-page-root]")).toBeVisible();

    // Keyboard: Space toggles it off, which removes the key; the chosen link stays in the select.
    await toggle(page).focus();
    await page.keyboard.press("Space");
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    await expect(select(page)).toHaveValue(B);
    await expectDraft(user.pageId, (d) => d.redirect === undefined);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 30_000,
    });
    expect((await getPage(host)).status).toBe(200);
  });

  test("M9-32 with no eligible link the switch is disabled and the card says to add a link block first", async ({
    page,
    context,
  }) => {
    await userWithDraft(
      context,
      "rm3",
      (h) => draftOf(h, [link(A, { visible: false }), link(B, { lock: { kind: "age" } })]),
      { plan: "pro" },
    );
    await openTab(page, "Share");
    await expect(toggle(page)).toHaveAttribute("aria-disabled", "true");
    await expect(card(page).getByTestId("redirect-no-links")).toContainText(
      "Add a link block first.",
    );
    await expect(card(page).getByRole("link", { name: "Go to the Edit tab" })).toHaveAttribute(
      "href",
      "/editor",
    );
  });

  test("M9-32 a Free account that holds redirect (a downgrade) is told its page is shown normally; Turn off removes the key; a failed Publish names the plan sentence under the switch", async ({
    page,
    context,
  }) => {
    const user = await userWithDraft(
      context,
      "rm4",
      (h) => draftOf(h, [link(A)], { redirect: { linkId: A } } as never),
      { plan: "free" },
    );
    await openTab(page, "Share");
    await expect(card(page).getByTestId("redirect-downgraded")).toHaveText(
      "Your plan no longer includes redirect mode. Your page is shown normally.",
    );
    expect(await height(card(page).getByTestId("redirect-turn-off"))).toBeGreaterThanOrEqual(44);

    await publishButton(page).click();
    await expect(
      card(page).getByText("Redirect mode is part of Pro. Upgrade to use it."),
    ).toBeVisible();
    await expect(toggle(page)).toBeFocused();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");

    await card(page).getByTestId("redirect-turn-off").click();
    await expectDraft(user.pageId, (d) => d.redirect === undefined);
    await expect(card(page).getByTestId("redirect-downgraded")).toHaveCount(0);
  });

  test("M9-32 a target that became hidden, locked or removed says so under the select; a locked one is refused at Publish with its own sentence", async ({
    page,
    context,
  }) => {
    await userWithDraft(
      context,
      "rm5",
      (h) =>
        draftOf(h, [link(A, { lock: { kind: "age" } }), link(B)], {
          redirect: { linkId: A },
        } as never),
      { plan: "pro" },
    );
    await openTab(page, "Share");
    await expect(
      card(page).getByText("This link is no longer available for redirect mode."),
    ).toBeVisible();
    await publishButton(page).click();
    await expect(card(page).getByText("Pick a link that isn’t locked.")).toBeVisible();
    await expect(select(page)).toBeFocused();
    // Pointing it at an eligible link clears both.
    await select(page).selectOption(B);
    await expect(
      card(page).getByText("This link is no longer available for redirect mode."),
    ).toHaveCount(0);
  });

  test("M9-32 the card's switch, select, links and buttons are 44px with 16px text, the warning wraps, and nothing scrolls sideways; at 1440 it sits in the 720px Share column", async ({
    page,
    context,
  }, info) => {
    await userWithDraft(
      context,
      "rm6",
      (h) =>
        draftOf(h, [link(A, { label: "L".repeat(60) }), link(B)], {
          redirect: { linkId: A },
        } as never),
      { plan: "pro" },
    );
    await openTab(page, "Share");
    await expectNoHorizontalScroll(page);
    for (const control of [toggle(page), select(page)])
      expect(await height(control)).toBeGreaterThanOrEqual(44);
    expect(await fontSize(select(page))).toBe("16px");
    await expect(card(page).getByTestId("redirect-warning")).toBeVisible();
    const box = (await card(page).boundingBox())!;
    if (info.project.name === "desktop") expect(box.width).toBeLessThanOrEqual(720);
    else expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});
