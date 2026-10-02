import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, phoneOnly } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { expectNoHorizontalScroll } from "../helpers";
import { uploadImage } from "../m2/blocks-helpers";
import { accessToken, pageRow } from "../m2/editor-helpers";
import { resolveTokens, tokenSetSchema, type TokenSet } from "@/lib/theme";
import {
  NOIR,
  liveHtml,
  openEditorPage,
  publishFromEditor,
  seedTheme,
  setTheme,
  statusChip,
  themeUser,
} from "./themes-helpers";
import { DESIGN_URL, waitForDesignHydrated } from "./design-helpers";

// The token schema only accepts a background image on this project's Storage origin.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= supabaseUrl();

/**
 * M3-05: Publish validates the design tokens and the theme's owner. Every case writes a hostile
 * draft the way curl would (publishable key, the user's own JWT: RLS lets a draft take anything),
 * then clicks Publish in the editor. The gate (src/lib/publish/core.ts) must refuse with a message
 * that names the field and the fix, leave `pages.published` and `published_at` alone, and never
 * resolve another user's saved theme. The same rules are proven below the UI in
 * tests/unit/themes-publish.test.ts.
 */

test.afterAll(cleanupUsers);

const publishButton = (page: Page) =>
  page.locator("main > header").getByRole("button", { name: "Publish", exact: true });
const alertOf = (page: Page) => page.getByRole("alert").filter({ hasText: /before publishing/ });

const mediaUrlOf = (path: string) => `${supabaseUrl()}/storage/v1/object/public/page-media/${path}`;

/** PATCH the stored draft through PostgREST with the user's JWT and the publishable key. */
async function patchDraft(
  context: BrowserContext,
  pageId: string,
  change: (draft: Record<string, unknown>) => Record<string, unknown>,
) {
  const row = await pageRow(pageId);
  const draft = change(JSON.parse(JSON.stringify(row.draft)) as Record<string, unknown>);
  const result = await restAs(await accessToken(context), `/pages?id=eq.${pageId}`, {
    method: "PATCH",
    body: { draft },
  });
  expect(result.status, "RLS accepts a draft write").toBeLessThan(300);
  expect(Array.isArray(result.body) && result.body.length === 1).toBe(true);
}

const withOverrides =
  (overrides: Record<string, unknown>, ref?: string | null) =>
  (draft: Record<string, unknown>): Record<string, unknown> => {
    const theme = draft.theme as { ref: string | null };
    return { ...draft, theme: { ref: ref === undefined ? theme.ref : ref, overrides } };
  };

/** A page's stored publish state, to prove a refused Publish changed nothing. */
async function publishState(pageId: string) {
  const row = await pageRow(pageId);
  return { published: JSON.stringify(row.published), publishedAt: row.published_at };
}

async function clickPublish(page: Page) {
  await openEditorPage(page);
  await publishButton(page).click();
}

test.describe("M3-05 publish validates tokens", () => {
  test("M3-05 a valid theme and overrides publish the complete resolved token set", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "one viewport is enough for the data check");
    const user = await themeUser(context, "p05a", "pro");
    await setTheme(user.pageId, NOIR, { accent: "#C46A4F", radius: 20 });
    await publishFromEditor(page);

    const stored = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    const noir = await adminClient().from("themes").select("tokens").eq("id", NOIR).single();
    const expected = resolveTokens(tokenSetSchema.partial().parse(noir.data!.tokens), {
      accent: "#C46A4F",
      radius: 20,
    });
    expect(Object.keys(stored.tokens)).toHaveLength(23);
    expect(stored.tokens).toEqual(expected);
  });

  const HOSTILE: { name: string; overrides: Record<string, unknown>; message: RegExp }[] = [
    {
      name: "bg 'red;}'",
      overrides: { bg: "red;}" },
      message: /Publish stopped: bg isn’t a valid colour\. Reset it in Design\./,
    },
    {
      name: "fontHeading 'Evil;}'",
      overrides: { fontHeading: "Evil;}" },
      message: /Publish stopped: fontHeading isn’t an available font\. Reset it in Design\./,
    },
    {
      name: "bgImage on another host",
      overrides: { bgImage: "https://evil.example/x.png" },
      message: /Publish stopped: bgImage isn’t one of your uploaded images\./,
    },
  ];

  for (const { name, overrides, message } of HOSTILE) {
    test(`M3-05 ${name} is accepted as a draft write but Publish refuses, names the field and changes nothing`, async ({
      page,
      context,
    }, info) => {
      test.skip(!desktopOnly(info), "security flow: one viewport, the layout is checked below");
      const user = await themeUser(context, "p05b", "pro");
      await setTheme(user.pageId, NOIR, {});
      await publishFromEditor(page);
      const before = await publishState(user.pageId);
      const liveBefore = await liveHtml(user.handle);

      await patchDraft(context, user.pageId, withOverrides(overrides));
      await clickPublish(page);

      const alert = alertOf(page);
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(message);
      expect(await publishState(user.pageId)).toEqual(before);
      expect(await liveHtml(user.handle)).toBe(liveBefore);
    });
  }

  test("M3-05 a background image in another user's folder, or one that does not exist, fails Publish; the owner's own upload publishes", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "security flow: one viewport");
    const user = await themeUser(context, "p05c", "pro");
    const other = await makeUser("p05o", { plan: "pro" });
    await setTheme(user.pageId, NOIR, {});
    await publishFromEditor(page);
    const before = await publishState(user.pageId);
    const liveBefore = await liveHtml(user.handle);

    // B's real upload.
    const theirs = await uploadImage(other.id, 8, 8);
    await patchDraft(context, user.pageId, withOverrides({ bgImage: mediaUrlOf(theirs.path) }));
    await clickPublish(page);
    await expect(alertOf(page)).toContainText(
      /Publish stopped: bgImage isn’t one of your uploaded images/,
    );
    expect(await publishState(user.pageId)).toEqual(before);

    // Her own folder, no such object.
    const missing = `${user.userId}/${"a".repeat(8)}-${"b".repeat(8)}.png`;
    await patchDraft(context, user.pageId, withOverrides({ bgImage: mediaUrlOf(missing) }));
    await clickPublish(page);
    await expect(alertOf(page)).toContainText(
      /Publish stopped: the background image is no longer available/,
    );
    expect(await publishState(user.pageId)).toEqual(before);
    expect(await liveHtml(user.handle)).toBe(liveBefore);

    // Positive control: her own object.
    const mine = await uploadImage(user.userId, 8, 8);
    await patchDraft(context, user.pageId, withOverrides({ bgImage: mediaUrlOf(mine.path) }));
    await clickPublish(page);
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    const published = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    expect(published.tokens.bgImage).toBe(mediaUrlOf(mine.path));
  });
});

test.describe("M3-05 a theme the page owner cannot read is never resolved", () => {
  test("M3-05 user B's private theme: RLS hides it, the Design screen shows the default, Publish and the live page never use it", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "security flow: one viewport");
    const user = await themeUser(context, "p05d", "pro");
    const other = await makeUser("p05p", { plan: "pro" });
    const theirs = await seedTheme(other.id, "B private", { accent: "#FF00AA" });
    await setTheme(user.pageId, NOIR, { radius: 20 });
    const token = await accessToken(context);

    // Read-own RLS: A's JWT cannot see B's theme.
    const read = await restAs(token, `/themes?id=eq.${theirs.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual([]);

    // A draft may still name it (RLS allows draft writes) ...
    await patchDraft(context, user.pageId, withOverrides({ radius: 20 }, theirs.id));
    // ... and /design shows the system default, never B's name or colours.
    await page.goto(DESIGN_URL);
    await waitForDesignHydrated(page);
    await expect(page.locator("main > header p").first()).toHaveText("Theme · Default");
    await expect(page.locator("body")).not.toContainText("B private");
    expect(await page.content()).not.toMatch(/#FF00AA/i);

    // Publish resolves the system default plus A's own overrides.
    await clickPublish(page);
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    const published = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    expect(published.tokens).toEqual(resolveTokens(null, { radius: 20 }));
    expect(JSON.stringify(published)).not.toMatch(/#FF00AA/i);
    const html = await liveHtml(user.handle);
    expect(html).not.toContain("B private");
    expect(html).not.toMatch(/#FF00AA/i);

    // Positive control: her own saved theme resolves and publishes.
    const mine = await seedTheme(user.userId, "A own", { accent: "#12AB34" });
    await patchDraft(context, user.pageId, withOverrides({}, mine.id));
    await clickPublish(page);
    await expect(statusChip(page)).toHaveText("Published", { timeout: 20_000 });
    const after = (await pageRow(user.pageId)).published as { tokens: TokenSet };
    expect(after.tokens.accent).toBe("#12AB34");
    expect(await liveHtml(user.handle)).toContain("--t-accent:#12AB34");
  });
});

test.describe("M3-05 the Publish message", () => {
  async function failingPublish(page: Page, context: BrowserContext, label: string) {
    const user = await themeUser(context, label, "pro");
    await setTheme(user.pageId, NOIR, {});
    await patchDraft(context, user.pageId, withOverrides({ bg: "red;}" }));
    await clickPublish(page);
    const alert = alertOf(page);
    await expect(alert).toContainText(
      "Publish stopped: bg isn’t a valid colour. Reset it in Design.",
    );
    return alert;
  }

  test("M3-05 the message is readable, inside the viewport, causes no horizontal scroll and sits in the block column above the profile", async ({
    page,
    context,
  }, info) => {
    const alert = await failingPublish(page, context, "p05e");
    const box = (await alert.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.width).toBeGreaterThan(200);
    await expectNoHorizontalScroll(page);

    // On screen without scrolling to it, in the block column's header area (above the profile).
    expect(box.y).toBeGreaterThanOrEqual(0);
    const profile = page.getByLabel("Display name", { exact: true });
    expect(box.y).toBeLessThan((await profile.boundingBox())!.y);
    if (phoneOnly(info)) expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });

  test("M3-05 the message has a Dismiss of at least 44px that clears it", async ({
    page,
    context,
  }) => {
    const alert = await failingPublish(page, context, "p05f");
    const dismiss = alert.getByRole("button", { name: "Dismiss" });
    await expect(dismiss).toHaveCount(1);
    expect((await dismiss.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dismiss.click();
    await expect(alert).toHaveCount(0);
  });
});
