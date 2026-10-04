import { expect, test, type Page } from "@playwright/test";
import {
  draftDocSchema,
  emptyDraft,
  publishedDocSchema,
  type Block,
  type DraftDoc,
} from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, TOKEN_KEYS, type TokenSet } from "@/lib/theme";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import {
  accessToken,
  emptyUser,
  openEditor,
  pageRow,
  setDraft,
  statusChip,
} from "./editor-helpers";
import { tenantGet } from "./publish-helpers";

/**
 * M2-23 (the publish gate, through the editor's Publish button) and M2-25 (Publish freezes the
 * resolved tokens). The gate's rules are also tested directly, against the database, in
 * tests/unit/publish-core.test.ts; here the real Server Action runs.
 */

// Publish runs a Server Action on a dev server other suites share: allow it time.
test.describe.configure({ timeout: 120_000 });

test.afterAll(cleanupUsers);

const publishButton = (page: Page) => page.getByRole("button", { name: /^Publish/ });

const link = (id: string, label: string, href = "https://example.com/x"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url: href,
});

function draftFor(
  handle: string,
  patch: Partial<DraftDoc> = {},
  blocks: Block[] = [link("lnk-gate-0001", "Book now")],
): DraftDoc {
  const draft = emptyDraft(handle);
  draft.profile.name = "Zq Gate";
  draft.profile.bio = "Gate bio";
  draft.blocks = blocks;
  return { ...draft, ...patch };
}

const decode = (html: string) =>
  html
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

async function livePage(handle: string) {
  const res = await tenantGet(handle);
  return { ...res, html: decode(res.text) };
}

test.describe("M2-23 publish gate (through the editor)", () => {
  test("M2-23 typing ' X' into Bio and clicking Publish at once publishes the final text", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pg", { draft: draftFor("placeholder") });
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);

    const bio = page.getByLabel("Bio", { exact: true });
    await bio.click();
    await bio.press("End");
    await bio.pressSequentially(" X", { delay: 0 });
    // Within 100 ms: no waiting for the autosave indicator.
    await publishButton(page).click();

    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const live = await livePage(user.handle);
    expect(live.status).toBe(200);
    expect(live.html).toContain("Gate bio X");
    const row = await pageRow(user.pageId);
    expect(row.draft.profile.bio).toBe("Gate bio X");
    expect(publishedDocSchema.parse(row.published).profile.bio).toBe("Gate bio X");
  });

  test("M2-23 Publishing... is shown and the button is disabled while it runs; a double click sends one request", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pd");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);

    const actions: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.headers()["next-action"])
        actions.push(request.url());
    });
    // Slow the action down so the busy state is observable.
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        await new Promise((r) => setTimeout(r, 600));
      }
      await route.continue();
    });

    const button = publishButton(page);
    await button.dblclick();
    await expect(button).toHaveText("Publishing...");
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Publish", { timeout: 20_000 });
    expect(actions).toHaveLength(1);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published");
  });

  test("M2-23 success: a 'Published.' toast with a 'View live page' link, and the chip reads Published", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pt");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "not-published");
    await publishButton(page).click();

    const toast = page.getByRole("status").filter({ hasText: "Published." });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast.getByRole("link", { name: "View live page" })).toHaveAttribute(
      "href",
      url(user.handle).replace(/\/$/, ""),
    );
    await expect(statusChip(page)).toHaveText("Published");
  });

  test("M2-23 a page with a bad URL is refused: the block is named, the live page is unchanged", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pv");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const before = await pageRow(user.pageId);

    // A client writes a javascript: URL straight into the draft with the publishable key.
    const token = await accessToken(context);
    const write = await fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        draft: draftFor(user.handle, { rev: 99 }, [
          link("lnk-gate-0001", "Click me", "javascript:alert(1)"),
        ]),
      }),
    });
    expect(write.status).toBeLessThan(300);

    await page.reload();
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await publishButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /before publishing/ })).toBeVisible({
      timeout: 20_000,
    });
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    const live = await livePage(user.handle);
    expect(live.html).not.toContain("javascript:alert");
  });

  test("M2-23 escaping: a display name of <script>alert(1)</script> publishes and renders as text", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pe");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.getByLabel("Display name", { exact: true }).fill("<script>alert(1)</script>");
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });

    const raw = await tenantGet(user.handle);
    expect(raw.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(raw.text).not.toMatch(/<script>alert\(1\)<\/script>/);
    const live = await context.newPage();
    live.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await live.goto(url(user.handle));
    await expect(live.getByRole("heading", { level: 1 })).toHaveText("<script>alert(1)</script>");
    await live.waitForTimeout(300);
    expect(dialogs).toEqual([]);
  });

  test("M2-23 success writes the publish form: hidden blocks removed, unknown draft keys stripped", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pw");
    const draft = draftFor(user.handle, {}, [
      link("lnk-shown-0001", "Shown"),
      {
        id: "lnk-hidden-001",
        type: "link",
        visible: false,
        label: "Hidden label",
        url: "https://example.com/hidden",
      },
    ]);
    await setDraft(user.pageId, draft);
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });

    const row = await pageRow(user.pageId);
    const published = publishedDocSchema.parse(row.published);
    expect(published.blocks.map((b) => b.id)).toEqual(["lnk-shown-0001"]);
    expect(JSON.stringify(row.published)).not.toContain("Hidden label");
    expect(row.published_at).not.toBeNull();
    expect((await livePage(user.handle)).html).not.toContain("Hidden label");
  });

  test("M2-23 direct-API abuse: a client cannot write published or published_at", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "pa");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const before = await pageRow(user.pageId);
    const token = await accessToken(context);

    const patch = (body: unknown) =>
      fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${user.pageId}`, {
        method: "PATCH",
        headers: {
          apikey: publishableKey(),
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      });
    const evil = {
      ...(before.published as object),
      profile: { name: "EVIL-PUBLISHED", bio: "", photo: null },
    };
    for (const body of [
      { published: evil },
      { published_at: "2026-01-01T00:00:00Z" },
      { published: evil, published_at: "2026-01-01T00:00:00Z" },
      // Writing published.tokens directly is a write to `published`: rejected the same way.
      {
        published: {
          ...(before.published as object),
          tokens: { ...SYSTEM_DEFAULT_TOKENS, bg: "#FF0000" },
        },
      },
    ]) {
      const res = await patch(body);
      expect([401, 403], JSON.stringify(Object.keys(body))).toContain(res.status);
    }
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    expect((await livePage(user.handle)).html).not.toContain("EVIL-PUBLISHED");
  });

  test("M2-23 phone: the Publish button and every control are 44px, no sideways scroll", async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!isMobile, "390px layout");
    const user = await emptyUser(context, "pm");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    const box = (await publishButton(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });

  test("M2-23 phone: the Published. toast does not overlap the bottom tab bar", async ({
    page,
    context,
    isMobile,
  }) => {
    test.skip(!isMobile, "390px layout");
    const user = await emptyUser(context, "pn");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    await publishButton(page).click();
    const toast = page.getByRole("status").filter({ hasText: "Published." });
    await expect(toast).toBeVisible({ timeout: 20_000 });
    const toastBox = (await toast.boundingBox())!;
    const tabBar = page.getByRole("navigation").last();
    const tabBox = await tabBar.boundingBox();
    if (tabBox) {
      expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(tabBox.y + 1);
    }
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "main");
  });

  test("M2-23 desktop: the Publish button is right-aligned in the toolbar, after the Preview menu", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "1440px layout");
    const user = await emptyUser(context, "pk");
    await setDraft(user.pageId, draftFor(user.handle));
    await openEditor(page);
    const header = (await page.getByTestId("workspace-toolbar").boundingBox())!;
    const preview = (await page
      .getByRole("button", { name: "Preview", exact: true })
      .boundingBox())!;
    const publish = (await publishButton(page).boundingBox())!;
    expect(publish.x).toBeGreaterThan(preview.x + preview.width - 1);
    // The right end of the button is the right end of the toolbar's content box (32px padding).
    expect(header.x + header.width - (publish.x + publish.width)).toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------------------------
// M2-25
// ---------------------------------------------------------------------------------------------

const cssVars = async (handle: string) => {
  const { text } = await tenantGet(handle);
  // The root's own style attribute, in the body: the page's inline <style> in the head names data-page-root too.
  const style = /data-page-root[^>]*style="([^"]*)"/.exec(text.slice(text.indexOf("<body>")))?.[1] ?? "";
  return Object.fromEntries(
    decode(style)
      .split(";")
      .filter(Boolean)
      .map((entry) => {
        const i = entry.indexOf(":");
        return [entry.slice(0, i).trim(), entry.slice(i + 1).trim()];
      }),
  );
};

test.describe("M2-25 Publish freezes resolved tokens into the live page", () => {
  const FIXTURE: TokenSet = {
    ...SYSTEM_DEFAULT_TOKENS,
    bg: "#101820",
    text: "#F2F2F2",
    textMuted: "#B8C0C8",
    accent: "#00A3A3",
    buttonBg: "#00A3A3",
    radius: 20,
  };

  test("M2-25 freeze, then theme edits and deletion leave the live page alone until the next Publish", async ({
    page,
    context,
  }) => {
    const user = await emptyUser(context, "fz");
    const admin = adminClient();
    const theme = await admin
      .from("themes")
      .insert({ owner_id: user.id, name: "Freeze fixture", tokens: FIXTURE })
      .select("id")
      .single();
    expect(theme.error).toBeNull();
    const themeId = theme.data!.id as string;

    await setDraft(
      user.pageId,
      draftFor(user.handle, { theme: { ref: themeId, overrides: { accent: "#C46A4F" } } }, [
        { ...link("lnk-pill-00001", "Pill"), overrides: { buttonStyle: "pill" } } as Block,
        link("lnk-plain-0001", "Plain"),
      ]),
    );
    await openEditor(page);
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });

    // 1. The stored copy holds every token, resolved: default, then theme, then page overrides.
    const row = await pageRow(user.pageId);
    const published = publishedDocSchema.parse(row.published);
    for (const key of TOKEN_KEYS) expect(published.tokens[key], key).not.toBeUndefined();
    expect(published.tokens.bg).toBe("#101820");
    expect(published.tokens.accent).toBe("#C46A4F");
    expect(published.tokens.radius).toBe(20);
    const pill = published.blocks.find((b) => b.id === "lnk-pill-00001");
    expect(pill?.type === "link" && pill.overrides?.buttonStyle).toBe("pill");
    expect(draftDocSchema.parse(row.draft).theme.ref).toBe(themeId);

    // 2. The live page serves the frozen values.
    const frozen = await cssVars(user.handle);
    expect(frozen["--t-bg"]).toBe("#101820");
    expect(frozen["--t-accent"]).toBe("#C46A4F");

    // 3. The theme row changes: the live page serves identical CSS variables.
    const edit = await admin
      .from("themes")
      .update({ tokens: { ...FIXTURE, bg: "#FFFFFF", accent: "#FF0000" } })
      .eq("id", themeId);
    expect(edit.error).toBeNull();
    expect(await cssVars(user.handle)).toEqual(frozen);

    // 4. The editor resolves the new theme and the chip shows Unpublished changes.
    await page.reload();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "unpublished-changes", {
      timeout: 20_000,
    });

    // 5. Publish again: the live page shows the new theme values.
    await publishButton(page).click();
    await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
      timeout: 20_000,
    });
    const next = await cssVars(user.handle);
    expect(next["--t-bg"]).toBe("#FFFFFF");
    expect(next["--t-accent"]).toBe("#C46A4F"); // the page override still wins
    expect(next).not.toEqual(frozen);

    // Deleting the row after that changes nothing live either.
    expect((await admin.from("themes").delete().eq("id", themeId)).error).toBeNull();
    expect(await cssVars(user.handle)).toEqual(next);
  });

  test("M2-25 direct-API abuse: published.tokens cannot be written, and a theme write never reaches a live page", async ({
    context,
  }) => {
    const user = await emptyUser(context, "fa");
    const admin = adminClient();
    const theme = await admin
      .from("themes")
      .insert({ owner_id: user.id, name: "Abuse fixture", tokens: FIXTURE })
      .select("id")
      .single();
    expect(theme.error).toBeNull();
    const token = await accessToken(context);
    const base = {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Prefer: "return=representation",
    };

    // The user's own theme can be edited through RLS; the page that uses it is not touched.
    await setDraft(
      user.pageId,
      draftFor(user.handle, { theme: { ref: theme.data!.id as string, overrides: {} } }),
    );
    await admin
      .from("pages")
      .update({
        published: publishedFrom(FIXTURE),
        published_at: new Date().toISOString(),
      })
      .eq("id", user.pageId);
    const frozenRow = await pageRow(user.pageId);
    const edit = await fetch(`${supabaseUrl()}/rest/v1/themes?id=eq.${theme.data!.id}`, {
      method: "PATCH",
      headers: base,
      body: JSON.stringify({ tokens: { ...FIXTURE, bg: "#00FF00" } }),
    });
    expect(edit.status).toBe(200);
    const afterEdit = await pageRow(user.pageId);
    expect(afterEdit.published).toEqual(frozenRow.published);
    expect(afterEdit.published_at).toBe(frozenRow.published_at);
    expect((await cssVars(user.handle))["--t-bg"]).toBe("#101820");

    const write = await fetch(`${supabaseUrl()}/rest/v1/pages?id=eq.${user.pageId}`, {
      method: "PATCH",
      headers: base,
      body: JSON.stringify({
        published: publishedFrom({ ...FIXTURE, bg: "#FF00FF" }),
      }),
    });
    expect([401, 403]).toContain(write.status);
    expect((await cssVars(user.handle))["--t-bg"]).toBe("#101820");
  });
});

function publishedFrom(tokens: TokenSet) {
  return {
    version: 1,
    profile: { name: "Zq Abuse", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    tokens,
    blocks: [
      {
        id: "lnk-abuse-0001",
        type: "link",
        visible: true,
        label: "Hi",
        url: "https://example.com",
      },
    ],
  } as unknown;
}
