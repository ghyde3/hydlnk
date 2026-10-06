import { expect, test, type Request } from "@playwright/test";
import { cleanupUsers, desktopOnly, phoneOnly } from "../fixtures/data";
import { publishableKey } from "../fixtures/auth";
import { rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { pageRow, seededUser, statusChip } from "../m2/editor-helpers";
import {
  computed,
  expectOverrides,
  openDesign,
  previewRoot,
  reloadDesign,
  saveStatus,
  showPreview,
  showTokens,
} from "./design-helpers";

/**
 * M3-07: design edits autosave to the draft (page-level overrides) through the editor's autosave.
 * Every test makes its own user with a copy of mara's published page.
 */

test.afterAll(cleanupUsers);

const isDraftPatch = (request: Request) =>
  request.method() === "PATCH" && request.url().includes("/rest/v1/pages");

const radius = (page: import("@playwright/test").Page, value: number) =>
  page
    .getByRole("group", { name: "Corner radius" })
    .getByRole("button", { name: `${value}px`, exact: true });

test.describe("M3-07 design autosave", () => {
  test("M3-07 choosing radius 20 saves to the draft overrides; published stays; reload keeps it; the editor shows unpublished changes", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "da1");
    await openDesign(page);
    const before = await pageRow(user.pageId);
    expect(before.draft.theme.overrides).toEqual({});

    await showTokens(page);
    await radius(page, 20).click();
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 3_000 });
    await expect(saveStatus(page)).toHaveAttribute("aria-live", "polite");

    const overrides = await expectOverrides(user.pageId, (o) => o.radius === 20);
    expect(overrides).toEqual({ radius: 20 });
    const after = await pageRow(user.pageId);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toBe(before.published_at);
    expect(after.draft.rev).toBe(before.draft.rev + 1);

    // Reload: the control, the preview and the header remember it; the live page does not.
    await reloadDesign(page);
    await expect(radius(page, 20)).toHaveAttribute("aria-pressed", "true");
    // The chip (M7-05) says the page has changes the live page does not.
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    await showPreview(page);
    expect(await computed(previewRoot(page), "--t-radius")).toBe("20px");
    const live = await rawRequest(`${user.handle}.localhost:3000`, "/");
    expect(live.status).toBe(200);
    expect(live.body).toContain("--t-radius:12px");
    expect(live.body).not.toContain("--t-radius:20px");

    // The editor header shows the unpublished-changes chip after the edit.
    await page.goto(url("app", "/editor"));
    await expect(statusChip(page)).toHaveText("Unpublished changes");
  });

  test("M3-07 the save is a PATCH of the draft column only, with the user's session and the publishable key", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "da2");
    await openDesign(page);
    const sent = page.waitForRequest(isDraftPatch, { timeout: 8_000 });
    await showTokens(page);
    await radius(page, 4).click();
    const request = await sent;

    expect(request.url()).toContain(`/rest/v1/pages?id=eq.${user.pageId}`);
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["draft"]);
    const headers = request.headers();
    expect(headers.apikey).toBe(publishableKey());
    // The bearer token is the signed-in user's JWT (role authenticated, their own id), never the
    // secret key.
    const token = (headers.authorization ?? "").replace(/^Bearer /, "");
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
      role?: string;
      sub?: string;
    };
    expect(claims.role).toBe("authenticated");
    expect(claims.sub).toBe(user.userId);
    await expect(saveStatus(page)).toHaveText("Saved");
  });

  test("M3-07 offline: Not saved with the retry message, the value stays, back online it saves", async ({
    page,
    context,
  }) => {
    const user = await seededUser(context, "da3");
    await openDesign(page);
    await showTokens(page);
    await context.setOffline(true);
    await radius(page, 0).click();
    await expect(saveStatus(page)).toHaveText("Not saved", { timeout: 15_000 });
    await expect(
      page.getByText("Couldn’t save. Your changes stay here and will retry."),
    ).toBeVisible();
    await expect(radius(page, 0)).toHaveAttribute("aria-pressed", "true");
    expect((await pageRow(user.pageId)).draft.theme.overrides).toEqual({});

    await context.setOffline(false);
    await expect(saveStatus(page)).toHaveText("Saved", { timeout: 20_000 });
    await expect(page.getByText("Couldn’t save.")).toHaveCount(0);
    await expectOverrides(user.pageId, (o) => o.radius === 0);
  });

  test("M3-07 desktop: the status sits in the workspace toolbar next to Publish, no horizontal scroll", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "desktop layout");
    await seededUser(context, "da4");
    await openDesign(page);
    await radius(page, 20).click();
    const status = saveStatus(page);
    await expect(status).toHaveText("Saved");
    // M7-05: the one save indicator is in the pinned toolbar, on every tab, left of Publish.
    await expect(status).toHaveCount(1);
    const toolbar = page.getByTestId("workspace-toolbar");
    const [s, publish, bar] = await Promise.all([
      status.boundingBox(),
      page.getByRole("button", { name: "Publish", exact: true }).boundingBox(),
      toolbar.boundingBox(),
    ]);
    expect(s!.y).toBeGreaterThanOrEqual(bar!.y);
    expect(s!.y + s!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
    expect(s!.x).toBeLessThan(publish!.x);
    await expectNoHorizontalScroll(page);
  });

  test("M3-07 phone: the status is visible above the tab bar, no horizontal scroll, 44px controls", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "phone layout");
    await seededUser(context, "da5");
    await openDesign(page);
    await showTokens(page);
    await radius(page, 20).click();
    const status = saveStatus(page);
    await expect(status).toHaveText("Saved");
    await expect(status).toBeVisible();
    const [s, bar] = await Promise.all([
      status.boundingBox(),
      page.getByRole("navigation", { name: "App sections" }).boundingBox(),
    ]);
    // Inside the viewport (whatever the scroll position) and clear of the tab bar.
    expect(s!.y + s!.height).toBeLessThanOrEqual(bar!.y);
    expect(s!.y).toBeGreaterThanOrEqual(0);
    expect(s!.x).toBeGreaterThanOrEqual(0);
    expect(s!.x + s!.width).toBeLessThanOrEqual(390);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "header, [data-design-section='color'], [data-font-picker]");
  });
});
