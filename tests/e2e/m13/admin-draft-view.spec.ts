import { expect, test } from "@playwright/test";
import { emptyDraft, emptySubPageDraft } from "@/lib/document";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly } from "../fixtures/data";
import { NEVER_STORED, appRaw } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { signInAsAdmin, signInAsUser } from "../m5/admin-helpers";

/**
 * M13-11: an admin's read-only view of a site's draft at /admin-draft/{pageId}, under the share
 * preview's headers, with one view_draft audit row per opening and nothing written to the draft. The
 * loader and the logging are in tests/unit/admin-account-queries.test.ts; the headers in
 * tests/unit/admin-draft-proxy.test.ts.
 */

test.describe.configure({ timeout: 120_000 });
test.afterAll(cleanupUsers);

const SECRET_NAME = "Unpublished Zq Name";
const SUB_TITLE = "Zq Sub Page";

async function seedOwner(browser: import("@playwright/test").Browser) {
  const owner = await signInAsUser(await browser.newContext(), "m13dv", { plan: "pro" });
  const db = adminClient();
  const draft = emptyDraft(owner.handle!);
  draft.profile.name = SECRET_NAME;
  draft.blocks = [
    {
      id: "lnk-zq000001",
      type: "link",
      visible: true,
      label: "Book",
      url: "https://example.com/book",
    },
  ] as never;
  const saved = await db
    .from("pages")
    .update({ draft: draft as never, published: null, published_at: null })
    .eq("id", owner.pageId!);
  expect(saved.error).toBeNull();
  const sub = await db
    .from("site_pages")
    .insert({ page_id: owner.pageId!, draft: emptySubPageDraft("items", SUB_TITLE) as never });
  expect(sub.error).toBeNull();
  return owner;
}

const viewRows = async (accountId: string) => {
  const { data, error } = await adminClient()
    .from("admin_audit")
    .select("id, admin_id, detail")
    .eq("account_id", accountId)
    .eq("action", "view_draft")
    .order("id");
  if (error) throw new Error(error.message);
  return data ?? [];
};

test.describe("M13-11 admin draft view", () => {
  test("M13-11 signed out goes to sign-in; a non-admin gets the 404 with none of the draft, and nothing is logged", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "no layout involved");
    const owner = await seedOwner(browser);
    try {
      const raw = await appRaw(`/admin-draft/${owner.pageId}`);
      expect(raw.status).toBe(307);

      await signInAsUser(context, "m13dn");
      const response = await page.goto(url("app", `/admin-draft/${owner.pageId}`));
      expect(response?.status()).toBe(404);
      await expect(page.locator("body")).toContainText("That page doesn’t exist.");
      expect(await page.locator("body").innerText()).not.toContain(SECRET_NAME);
      expect(await viewRows(owner.userId!)).toHaveLength(0);
    } finally {
      await adminClient().from("admin_audit").delete().eq("account_id", owner.userId);
    }
  });

  test("M13-11 from the account page: the draft under the share headers, one audit row per opening, links inert, nothing written to the draft", async ({
    page,
    context,
    browser,
  }) => {
    const owner = await seedOwner(browser);
    const db = adminClient();
    const admin = await signInAsAdmin(context, "m13dva");
    try {
      const before = await db
        .from("pages")
        .select("draft, updated_at, published")
        .eq("id", owner.pageId!)
        .single();
      const subBefore = await db
        .from("site_pages")
        .select("draft, updated_at")
        .eq("page_id", owner.pageId!);

      await page.goto(url("app", `/admin/accounts/${owner.userId}`));
      // Opening the account page (and hovering the button) logs nothing.
      await page.getByRole("link", { name: `See draft of ${owner.handle}` }).hover();
      expect(await viewRows(owner.userId!)).toHaveLength(0);

      const [response] = await Promise.all([
        page.waitForResponse((r) => new URL(r.url()).pathname === `/admin-draft/${owner.pageId}`),
        page.getByRole("link", { name: `See draft of ${owner.handle}` }).click(),
      ]);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      // `next dev` rewrites the header of a rendered page (as for the share preview); a production build keeps the exact value.
      expect(headers["cache-control"]).toMatch(NEVER_STORED);
      if (process.env.E2E_PROD_BUILD === "1")
        expect(headers["cache-control"]).toBe("private, no-store");
      expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["content-security-policy"]).toMatch(
        /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
      );
      expect(headers["content-security-policy"]).toContain("form-action 'none'");

      await expect(page.locator("[data-page-root]")).toContainText(SECRET_NAME);
      await expect(page.locator("[data-admin-draft-bar]")).toContainText("Read only");
      await expect(page.locator("[data-admin-draft-bar]")).toContainText("logged");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

      // Exactly one row for this opening: the admin, the owner's account, the page, Home.
      let rows = await viewRows(owner.userId!);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.admin_id).toBe(admin.userId);
      expect(rows[0]!.detail).toEqual({ page_id: owner.pageId, path: null });

      // A link of the draft goes nowhere (no navigation, no click tracking). Wait for the frame's
      // click guard to be hydrated first: a dev server can paint before its script is attached.
      await expect
        .poll(() =>
          page
            .locator("[data-preview-frame]")
            .evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps"))),
        )
        .toBe(true);
      const link = page.locator("[data-page-root] a", { hasText: "Book" }).first();
      await link.click();
      await expect(page).toHaveURL(url("app", `/admin-draft/${owner.pageId}`));
      expect(await viewRows(owner.userId!)).toHaveLength(1);

      // The switcher opens a page of the site: another opening, with its path.
      await page
        .getByRole("navigation", { name: "Pages of this draft" })
        .getByRole("link", { name: SUB_TITLE })
        .click();
      await expect(page).toHaveURL(url("app", `/admin-draft/${owner.pageId}/items`));
      await expect(page.locator("[data-page-root]")).toContainText(SUB_TITLE);
      rows = await viewRows(owner.userId!);
      expect(rows).toHaveLength(2);
      expect(rows[1]!.detail).toEqual({ page_id: owner.pageId, path: "items" });

      // A reload is another opening.
      await page.reload();
      expect(await viewRows(owner.userId!)).toHaveLength(3);

      // Nothing was written to the draft, the sub-page or the published copy.
      const after = await db
        .from("pages")
        .select("draft, updated_at, published")
        .eq("id", owner.pageId!)
        .single();
      expect(after.data).toEqual(before.data);
      const subAfter = await db
        .from("site_pages")
        .select("draft, updated_at")
        .eq("page_id", owner.pageId!);
      expect(subAfter.data).toEqual(subBefore.data);

      await expect(page.getByRole("link", { name: "Back to account" })).toHaveAttribute(
        "href",
        `/admin/accounts/${owner.userId}`,
      );
      await expect(page.getByRole("link", { name: "Back to account" })).toHaveCSS(
        "min-height",
        "44px",
      );
      await expectNoHorizontalScroll(page);
      await expectTapTargets(page, "[data-admin-draft-bar]");
    } finally {
      await db.from("admin_audit").delete().eq("account_id", owner.userId);
    }
  });

  test("M13-11 a page that does not exist, or a path that is not one, is the 404 and logs nothing", async ({
    page,
    context,
    browser,
  }, info) => {
    test.skip(!desktopOnly(info), "no layout involved");
    const owner = await seedOwner(browser);
    await signInAsAdmin(context, "m13dvb");
    try {
      for (const path of [
        "/admin-draft/00000000-0000-4000-8000-00000000dead",
        "/admin-draft/not-an-id",
        `/admin-draft/${owner.pageId}/no-such-page`,
        `/admin-draft/${owner.pageId}/a/b`,
      ]) {
        const response = await page.goto(url("app", path));
        expect(response?.status(), path).toBe(404);
      }
      expect(await viewRows(owner.userId!)).toHaveLength(0);
    } finally {
      await adminClient().from("admin_audit").delete().eq("account_id", owner.userId);
    }
  });
});
