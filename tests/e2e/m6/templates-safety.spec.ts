import { expect, test, type Request } from "@playwright/test";
import { cleanupUsers, desktopOnly, makeUser } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { accessToken } from "../m2/editor-helpers";
import { emptyDraft, newBlockId, type Block, type DraftDoc } from "@/lib/document";
import { applyTemplate, templateById } from "@/lib/templates";
import { insertPage } from "../fixtures/data";
import { SYSTEM_IDS } from "./themes-helpers";
import {
  applyTemplateChoice,
  blocksHeading,
  describeBlocks,
  describeTemplate,
  dialogOf,
  emptyPageUser,
  expectDraft,
  openDialog,
  openEditor,
  pageRow,
  publishButton,
  saveIndicator,
  setDraft,
  statusChip,
  templateOf,
} from "./templates-helpers";

/**
 * M6-40, abuse and safety: applying a template makes one kind of write only (the draft, under the
 * user's own session), RLS still decides who may write a draft, the 50-block rule is enforced where
 * it always was (Publish) and an apply can never push a page past it. Each test makes its own user.
 * The same shapes are proven below the UI in tests/unit/m6-templates-*.test.ts.
 */

test.afterAll(cleanupUsers);

const dividers = (count: number): Block[] =>
  Array.from({ length: count }, () => ({ id: newBlockId(), type: "divider", visible: true }));

const draftWithBlocks = (handle: string, blocks: Block[]): DraftDoc => ({
  ...emptyDraft(handle),
  blocks,
});

test.describe("M6-40 what an apply writes", () => {
  test("M6-40 the network shows one kind of write, the draft PATCH under the user's session: nothing to themes, nothing to Storage, no server action", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough for the network log");
    const user = await emptyPageUser(context, "tpl-nw");
    await openEditor(page);

    const log: { method: string; url: string; action: boolean }[] = [];
    page.on("request", (request: Request) =>
      log.push({
        method: request.method(),
        url: request.url(),
        action: request.headers()["next-action"] !== undefined,
      }),
    );
    await openDialog(page);
    await applyTemplateChoice(page, "Podcaster");
    await expect(blocksHeading(page, 8)).toBeVisible();
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 3_000 });
    await page.waitForTimeout(1_000);

    const writes = log.filter((entry) => !["GET", "HEAD", "OPTIONS"].includes(entry.method));
    expect(writes.map((entry) => entry.method)).toEqual(["PATCH"]);
    expect(writes[0]!.url).toContain("/rest/v1/pages");
    expect(writes[0]!.url).toContain(`id=eq.${user.pageId}`);
    expect(log.filter((entry) => entry.url.includes("/rest/v1/themes"))).toEqual([]);
    expect(log.filter((entry) => entry.url.includes("/storage/v1/"))).toEqual([]);
    expect(log.filter((entry) => entry.action)).toEqual([]);
    // Applied: the template's blocks, theme and bio, in the draft the user's session wrote.
    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 8);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(templateOf("Podcaster")));
    expect(stored.theme).toEqual({ ref: SYSTEM_IDS.Smoke, overrides: {} });
  });
});

test.describe("M6-40 direct-API abuse", () => {
  test("M6-40 another user's page is not changed by a template-shaped draft, and a 51-block draft of your own is accepted by the database and refused at Publish", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "API and the publish gate: one viewport is enough");
    const victim = await makeUser("tpl-vic");
    const victimPage = await insertPage(victim.id, `zq-tpl-vic-${Date.now().toString(36)}`, {});
    const own = await emptyPageUser(context, "tpl-att");
    const token = await accessToken(context);

    // A template-shaped draft aimed at someone else's page: RLS filters the row, nothing changes.
    const victimBefore = await pageRow(victimPage);
    const shaped = applyTemplate(victimBefore.draft, templateById("musician")!);
    const hit = await restAs(token, `/pages?id=eq.${victimPage}`, {
      method: "PATCH",
      body: { draft: shaped },
    });
    expect(hit.status).toBeLessThan(500);
    expect(hit.body).toEqual([]);
    expect((await pageRow(victimPage)).draft).toEqual(victimBefore.draft);

    // The same on the user's own page works (RLS lets a draft take anything it can hold) ...
    const fifty1 = draftWithBlocks(own.handle, dividers(51));
    const accepted = await restAs(token, `/pages?id=eq.${own.pageId}`, {
      method: "PATCH",
      body: { draft: fifty1 },
    });
    expect(accepted.status).toBe(200);
    expect((await pageRow(own.pageId)).draft.blocks).toHaveLength(51);

    // ... and Publish refuses it, with nothing published.
    await openEditor(page);
    await publishButton(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "Fix your page before publishing." });
    await expect(alert).toContainText("Use 50 blocks or fewer.");
    const refused = await pageRow(own.pageId);
    expect(refused.published).toBeNull();
    expect(refused.published_at).toBeNull();
    await expect(statusChip(page)).toHaveText("Not published");

    // A template replaces blocks, it never adds: the 51 become the template's 6.
    await openDialog(page);
    await applyTemplateChoice(page, "Musician");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(blocksHeading(page, 6)).toBeVisible();
    const stored = await expectDraft(own.pageId, (draft) => draft.blocks.length === 6);
    expect(stored.blocks.length).toBeLessThanOrEqual(50);
  });

  test("M6-40 an apply on a full page of 50 blocks leaves exactly the template's blocks, never more than 50", async ({
    page,
    context,
  }) => {
    const user = await emptyPageUser(context, "tpl-50");
    await setDraft(user.pageId, draftWithBlocks(user.handle, dividers(50)));
    await openEditor(page);
    await expect(blocksHeading(page, 50)).toBeVisible();
    // The chips are off at the limit, and the template button still works.
    await expect(page.getByText("You’ve reached the 50-block limit.")).toBeVisible();
    await openDialog(page);
    await applyTemplateChoice(page, "Shop");
    await expect(blocksHeading(page, 7)).toBeVisible();
    const stored = await expectDraft(user.pageId, (draft) => draft.blocks.length === 7);
    expect(describeBlocks(stored.blocks)).toEqual(describeTemplate(templateOf("Shop")));
    await expect(page.getByText("You’ve reached the 50-block limit.")).toHaveCount(0);
  });
});
