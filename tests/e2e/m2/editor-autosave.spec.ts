import { expect, test, type Request } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient, signInAs } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, phoneOnly } from "../fixtures/data";
import { rawRequest, restAs } from "../fixtures/http";
import { jsonbTextBytes } from "@/lib/editor/size";
import { LIMITS, newBlockId } from "@/lib/document";
import {
  accessToken,
  emptyUser,
  expectDraft,
  mark,
  openEditor,
  pageRow,
  reloadEditor,
  saveIndicator,
  seededUser,
} from "./editor-helpers";

/**
 * M2-04: autosave with the stale-tab guard, and the database integrity check on drafts.
 * (The CHECK itself is also covered by supabase/tests/database/080-draft-integrity.test.sql.)
 */

test.afterAll(cleanupUsers);

const isDraftPatch = (request: Request) =>
  request.method() === "PATCH" && request.url().includes("/rest/v1/pages");

const NAME = (page: import("@playwright/test").Page) =>
  page.getByLabel("Display name", { exact: true });

test.describe("M2-04 autosave", () => {
  test("M2-04 ten characters typed in under 500 ms give one PATCH about 800 ms later, draft only, rev + 1", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "as1");
    await openEditor(page);
    const before = await pageRow(user.pageId);

    const patches: { at: number; request: Request }[] = [];
    page.on("request", (request) => {
      if (isDraftPatch(request)) patches.push({ at: Date.now(), request });
    });

    await NAME(page).click();
    await NAME(page).press("End");
    await NAME(page).pressSequentially("0123456789", { delay: 25 });
    const lastKey = Date.now();
    await expect(saveIndicator(page)).toHaveText("Saved");
    await page.waitForTimeout(1500);

    expect(patches).toHaveLength(1);
    const { request, at } = patches[0]!;
    expect(request.url()).toContain(`/rest/v1/pages?id=eq.${user.pageId}`);
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["draft"]);
    const sent = body.draft as { rev: number; profile: { name: string } };
    expect(sent.rev).toBe(before.draft.rev + 1);
    expect(sent.profile.name).toBe(`${user.handle}0123456789`);
    // About 800 ms after the last keystroke.
    expect(at - lastKey).toBeGreaterThan(500);
    expect(at - lastKey).toBeLessThan(1600);

    const after = await pageRow(user.pageId);
    expect(after.draft.rev).toBe(before.draft.rev + 1);
    expect(after.draft.profile.name).toBe(`${user.handle}0123456789`);
  });

  test("M2-04 the indicator reads Saving..., Saved; the edit survives a reload; published is untouched", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "as2");
    await openEditor(page);
    const before = await pageRow(user.pageId);
    const liveBefore = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(liveBefore.status).toBe(200);

    // Hold the PATCH so the in-flight state can be observed.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/rest/v1/pages?*", async (route) => {
      if (route.request().method() === "PATCH") await gate;
      await route.continue();
    });

    const text = mark();
    await expect(saveIndicator(page)).toHaveText("");
    await NAME(page).fill(text);
    await expect(saveIndicator(page)).toHaveText("Saving...");
    await page.waitForTimeout(1200); // past the debounce: the request is in flight
    await expect(saveIndicator(page)).toHaveText("Saving...");
    release();
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expect(saveIndicator(page)).toHaveAttribute("aria-live", "polite");

    await reloadEditor(page);
    await expect(NAME(page)).toHaveValue(text);

    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    const liveAfter = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(liveAfter.body).not.toContain(text);
    expect(liveAfter.status).toBe(200);
    // The public page still shows the published document (the old bio), not the edit.
    expect(liveAfter.body).toContain("Portrait &amp; studio photographer");
  });

  test("M2-04 the indicator is mono 12px", async ({ page, context }) => {
    await seededUser(context, "as3");
    await openEditor(page);
    const style = await saveIndicator(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, family: s.fontFamily };
    });
    expect(style.size).toBe("12px");
    expect(style.family).toMatch(/Geist.?Mono/);
  });

  test("M2-04 a hidden tab flushes at once, without the debounce", async ({ page, context }) => {
    const user = await seededUser(context, "as4");
    await openEditor(page);
    const text = mark();
    const sent = page.waitForRequest(isDraftPatch, { timeout: 5000 });
    const started = Date.now();
    await NAME(page).fill(text);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sent;
    expect(Date.now() - started).toBeLessThan(700);
    await expectDraft(user.pageId, (d) => d.profile.name === text);
  });

  test("M2-04 beforeunload prompts only while an edit is unsaved", async ({ page, context }) => {
    await seededUser(context, "as5");
    await openEditor(page);

    // Clean: closing runs beforeunload and nothing is asked.
    const clean = await context.newPage();
    await clean.goto(url("app", "/editor"));
    await expect(NAME(clean)).toBeVisible();
    let dialogs = 0;
    clean.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await clean.close({ runBeforeUnload: true });
    expect(dialogs).toBe(0);

    // Pending: the browser asks (it needs a real gesture on the page first).
    await NAME(page).click();
    await page.keyboard.type("x");
    // The handler is added once the edit is pending (a render after the keystroke), so wait for
    // that before closing: closing in the same breath can win the race and ask nothing.
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", /^(pending|saving)$/);
    const dialog = page.waitForEvent("dialog", { timeout: 5000 });
    void page.close({ runBeforeUnload: true });
    const shown = await dialog;
    expect(shown.type()).toBe("beforeunload");
    await shown.dismiss();
    // Staying on the page, the edit saves and the prompt is gone again.
    await expect(saveIndicator(page)).toHaveText("Saved");
    let after = 0;
    page.on("dialog", (d) => {
      after += 1;
      void d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    expect(after).toBe(0);
  });

  test("M2-04 leaving the screen while a write is in flight still stores the newest edit", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "as9");
    await openEditor(page);
    // Hold the first PATCH so a second edit lands while it is in flight.
    await page.route("**/rest/v1/pages**", async (route) => {
      if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const text = mark();
    await NAME(page).fill(`${text}a`);
    await expect(saveIndicator(page)).toHaveAttribute("data-save-status", "saving");
    await NAME(page).fill(`${text}ab`);
    // A client-side navigation out of the workspace unmounts it, which flushes what is pending (the
    // Design tab keeps it: the draft and its queue belong to the workspace, M7-02).
    await page
      .getByRole("link", { name: /^(Analytics|Stats)$/ })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(url("app", "/analytics"));
    await expectDraft(user.pageId, (d) => d.profile.name === `${text}ab`);
  });

  test("M2-04 offline: Not saved with the retry message, then saved once back online", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "as6");
    await openEditor(page);
    await context.setOffline(true);
    const text = mark();
    await NAME(page).fill(text);
    await expect(saveIndicator(page)).toHaveText("Not saved", { timeout: 15_000 });
    await expect(
      page.getByText("Couldn’t save. Your changes stay here and will retry."),
    ).toBeVisible();
    await page.waitForTimeout(2500); // retries with backoff; still failing, still shown
    await expect(saveIndicator(page)).toHaveText("Not saved");
    expect((await pageRow(user.pageId)).draft.profile.name).not.toBe(text);

    await context.setOffline(false);
    await expect(saveIndicator(page)).toHaveText("Saved", { timeout: 20_000 });
    await expect(page.getByText("Couldn’t save.")).toHaveCount(0);
    await expectDraft(user.pageId, (d) => d.profile.name === text);
  });

  test("M2-04 a draft over 256 KB is not sent and the indicator says so", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "big");
    // A valid draft just under the limit: social blocks full of long (but legal) URLs.
    const social = () => ({
      id: newBlockId(),
      type: "social",
      visible: true,
      icons: Array.from({ length: 8 }, () => ({
        id: newBlockId(),
        platform: "website",
        url: "https://example.com/" + "a".repeat(4060),
      })),
    });
    const doc = {
      version: 1,
      rev: 0,
      profile: { name: user.handle, bio: "", photo: null },
      theme: { ref: null, overrides: {} },
      blocks: [social(), social(), social(), social(), social(), social(), social(), social()],
    };
    // Trim the last URL until the stored form is within 20 bytes of the limit.
    const last = (doc.blocks[7] as { icons: { url: string }[] }).icons[7]!;
    const gap = LIMITS.draftBytes - 20 - jsonbTextBytes(doc);
    expect(gap).toBeLessThan(0); // the blocks as built are over the limit; trim to just under it
    last.url = last.url.slice(0, last.url.length + gap);
    expect(jsonbTextBytes(doc)).toBeLessThanOrEqual(LIMITS.draftBytes - 20);
    await adminClient().from("pages").update({ draft: doc }).eq("id", user.pageId).throwOnError();

    await openEditor(page);
    let patches = 0;
    page.on("request", (request) => {
      if (isDraftPatch(request)) patches += 1;
    });
    // One divider more pushes the stored form past 256 KB.
    await page.getByRole("button", { name: "Divider" }).click();
    // The indicator itself reads the message (M2-04 step 5).
    await expect(saveIndicator(page)).toHaveText(
      "This page is too large to save. Remove some content.",
    );
    await page.waitForTimeout(2000);
    expect(patches).toBe(0);
    expect((await pageRow(user.pageId)).draft.blocks).toHaveLength(8);
  });

  test("M2-04 stale tab guard: the second tab's save is refused, the database keeps the first tab's edit", async ({
    page,
    context,
    browser,
  }) => {
    const user = await seededUser(context, "stale");
    await openEditor(page); // tab A
    const contextB = await browser.newContext(
      page.viewportSize() ? { viewport: page.viewportSize()! } : {},
    );
    try {
      await signInAs(contextB, user.email);
      const pageB = await contextB.newPage();
      await openEditor(pageB); // tab B, loaded before A saves
      const oldBio = await pageB.getByLabel("Bio", { exact: true }).inputValue();

      const nameA = mark();
      await NAME(page).fill(nameA);
      await expect(saveIndicator(page)).toHaveText("Saved");

      const bioB = `${mark()} bio`;
      await pageB.getByLabel("Bio", { exact: true }).fill(bioB);
      await expect(
        pageB.getByText("This page changed in another tab. Reload to keep editing."),
      ).toBeVisible();
      await expect(saveIndicator(pageB)).toHaveText("Not saved");
      const reload = pageB.getByRole("button", { name: "Reload" });
      await expect(reload).toBeVisible();

      const stored = await pageRow(user.pageId);
      expect(stored.draft.profile.name).toBe(nameA);
      expect(stored.draft.profile.bio).toBe(oldBio);

      // Further edits in B stay refused.
      await pageB.getByLabel("Bio", { exact: true }).fill(`${bioB} more`);
      await pageB.waitForTimeout(1500);
      expect((await pageRow(user.pageId)).draft.profile.bio).toBe(oldBio);

      await reload.click();
      await expect(NAME(pageB)).toHaveValue(nameA);
      await expect(pageB.getByLabel("Bio", { exact: true })).toHaveValue(oldBio);
      await expect(pageB.getByText("This page changed in another tab.")).toHaveCount(0);
    } finally {
      await contextB.close();
    }
  });

  test("M2-04 a corrupted draft with no rev saves on the first edit (no false stale-tab error)", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "norev", { draft: {} });
    await openEditor(page);
    await NAME(page).fill("Fresh name");
    await expect(saveIndicator(page)).toHaveText("Saved");
    await NAME(page).fill("Fresh name two");
    await expect(saveIndicator(page)).toHaveText("Saved");
    const draft = await expectDraft(user.pageId, (d) => d.profile.name === "Fresh name two");
    expect(draft.rev).toBe(2);
  });

  test("M2-04 leaving the screen flushes a pending edit", async ({ page, context }) => {
    const user = await seededUser(context, "leave");
    await openEditor(page);
    const text = mark();
    await NAME(page).fill(text);
    // A client-side navigation out of the workspace (the Design tab is part of it, M7-02) unmounts
    // it right away.
    const nav = page.locator("nav a[href='/analytics']:visible");
    await nav.click();
    await expect(page).toHaveURL(url("app", "/analytics"));
    await expectDraft(user.pageId, (d) => d.profile.name === text);
  });
});

test.describe("M2-04 database integrity, as the owner with the publishable key", () => {
  test('M2-04 [], "x" and a 300 KB object are refused (400); 200 KB is accepted; another tenant\'s page matches nothing', async ({
    context,
  }) => {
    const user = await seededUser(context, "api");
    const other = await makeUser("api2");
    const otherPage = await adminClient()
      .from("pages")
      .insert({
        owner_id: other.id,
        handle: `zq-api2-${Math.random().toString(36).slice(2, 7)}`,
        draft: { marker: "theirs" },
      })
      .select("id")
      .single();
    expect(otherPage.error).toBeNull();
    const token = await accessToken(context);
    const patch = (id: string, draft: unknown) =>
      restAs(token, `/pages?id=eq.${id}`, { method: "PATCH", body: { draft } });
    const original = (await pageRow(user.pageId)).draft;

    for (const bad of [[], "x", { blob: "x".repeat(300_000) }]) {
      const res = await patch(user.pageId, bad);
      expect(res.status, JSON.stringify(res.body).slice(0, 120)).toBe(400);
      expect(res.body).toMatchObject({ code: "23514" });
    }
    expect((await pageRow(user.pageId)).draft).toEqual(original);

    const ok = await patch(user.pageId, { ...original, filler: "x".repeat(200_000) });
    expect(ok.status).toBe(200);
    expect((ok.body as unknown[]).length).toBe(1);

    const foreign = await patch(otherPage.data!.id as string, { marker: "mine now" });
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual([]);
    const theirs = await adminClient()
      .from("pages")
      .select("draft")
      .eq("id", otherPage.data!.id)
      .single();
    expect(theirs.data!.draft).toEqual({ marker: "theirs" });

    // Put the draft back to something the editor loads.
    await adminClient().from("pages").update({ draft: original }).eq("id", user.pageId);
  });
});

test.describe("M2-04 layout", () => {
  // M7-05 supersedes the header placements of these two tests: the status chip is in the pinned
  // toolbar row, the save indicator is mono text in the toolbar from 760px and a small chip fixed
  // above the tab bar (never under the mini phone) below it.
  test("M2-04 phone: the chip is in the pinned row, the indicator chip ends before the mini phone; 44px controls; no sideways scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "lay");
    await openEditor(page);
    await NAME(page).fill(mark());
    await expect(saveIndicator(page)).toHaveText("Saved");
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page);
    // Below 760px the toolbar is `display: contents`; its pinned row is the box.
    const row = (await page.getByTestId("workspace-toolbar-row").boundingBox())!;
    const chip = (await page.locator("[data-publish-status]").boundingBox())!;
    expect(chip.x).toBeGreaterThanOrEqual(row.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(row.x + row.width);
    expect(chip.y).toBeGreaterThanOrEqual(row.y);
    expect(chip.y + chip.height).toBeLessThanOrEqual(row.y + row.height);
    const indicator = (await saveIndicator(page).boundingBox())!;
    expect(indicator.x).toBeGreaterThanOrEqual(0);
    expect(indicator.x + indicator.width).toBeLessThanOrEqual(390 - 72); // ends before the mini phone's column
    expect(indicator.y).toBeGreaterThan(row.y + row.height);
  });

  test("M2-04 desktop: the chip and the indicator sit on the toolbar row, right of the page name", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "lay");
    await openEditor(page);
    await NAME(page).fill(mark());
    await expect(saveIndicator(page)).toHaveText("Saved");
    const bar = (await page.getByTestId("workspace-toolbar").boundingBox())!;
    const title = (await page.locator("[data-toolbar-name] h1").boundingBox())!;
    const chip = (await page.locator("[data-publish-status]").boundingBox())!;
    const indicator = (await saveIndicator(page).boundingBox())!;
    expect(chip.x).toBeGreaterThan(title.x + title.width);
    expect(indicator.x).toBeGreaterThanOrEqual(chip.x + chip.width - 1);
    expect(Math.abs(chip.y + chip.height / 2 - (indicator.y + indicator.height / 2))).toBeLessThan(
      8,
    );
    expect(indicator.x + indicator.width).toBeLessThanOrEqual(bar.x + bar.width);
    expect(indicator.y).toBeGreaterThanOrEqual(bar.y);
    expect(indicator.y + indicator.height).toBeLessThanOrEqual(bar.y + bar.height);
  });
});
