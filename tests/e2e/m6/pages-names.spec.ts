import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import {
  accessTokenFor,
  cleanupUsers,
  desktopOnly,
  insertPage,
  makeUser,
  signedInUser,
} from "../fixtures/data";
import { FAULT_COOKIE_IGNORED, rawRequest } from "../fixtures/http";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { openEditor, pageRow, statusChip } from "../m2/editor-helpers";
import { rawBytes } from "./pages-helpers";

/**
 * M6-13 (the database side: grants, check, abuse through PostgREST, the name stays out of every
 * public place) and M6-14 (renaming in the editor, and where names show). Every spec makes its own
 * users, so nothing touches mara. The raw-API specs run once (desktop project).
 */

test.afterAll(cleanupUsers);

const header = (page: Page) => page.getByTestId("workspace-toolbar");
const h1 = (page: Page) => header(page).getByRole("heading", { level: 1 });
const pencil = (page: Page) => header(page).getByRole("button", { name: "Rename page" });
const nameField = (page: Page) => header(page).getByLabel("Page name");

const patchUrl = (pageId: string) => `${supabaseUrl()}/rest/v1/pages?id=eq.${pageId}`;

async function patchName(token: string, pageId: string, body: Record<string, unknown>) {
  const res = await fetch(patchUrl(pageId), {
    method: "PATCH",
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, json, text };
}

const nameOf = async (pageId: string) => {
  const { data } = await adminClient().from("pages").select("name").eq("id", pageId).single();
  return data!.name as string;
};

/** The page's whole stored document, to prove a rename leaves it alone. */
const documentsOf = async (pageId: string) => {
  const { data } = await adminClient()
    .from("pages")
    .select("draft, published, published_at, handle, owner_id")
    .eq("id", pageId)
    .single();
  return JSON.stringify(data);
};

async function createPage(
  context: BrowserContext,
  handle: string,
  extra: Record<string, unknown> = {},
) {
  const res = await context.request.post(url("app", "/api/pages"), {
    data: { handle, ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { pageId: string }).pageId;
}

test.describe("M6-13 the database side", () => {
  test("M6-13 the owner renames through PostgREST; another user's page matches no row; the check refuses the rest; the document never moves", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw API, no UI");
    const mara = await signedInUser(context, { label: "nm1" });
    const jonas = await makeUser("nm2");
    const maraToken = await accessTokenFor(mara.email);
    const jonasToken = await accessTokenFor(jonas.email);
    const before = await documentsOf(mara.pageId);

    const ok = await patchName(maraToken, mara.pageId, { name: "Summer tour" });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual([{ ...(ok.json as object[])[0] }]);
    expect(await nameOf(mara.pageId)).toBe("Summer tour");

    // Another account: no row matches, nothing changes.
    const foreign = await patchName(jonasToken, mara.pageId, { name: "Hijacked" });
    expect(foreign.status).toBe(200);
    expect(foreign.json).toEqual([]);
    expect(await nameOf(mara.pageId)).toBe("Summer tour");

    // The check: length, blank, control characters, bidi.
    for (const [label, name] of [
      ["61 characters", "x".repeat(61)],
      ["empty", ""],
      ["spaces", "   "],
      ["a newline", "a\nb"],
      ["a bell", "a\u0007b"],
      ["a right-to-left override", "a‮b"],
      ["a bidi isolate", "a⁦b"],
      ["a leading space", " a"],
    ] as const) {
      const res = await patchName(maraToken, mara.pageId, { name });
      expect(res.status, label).toBe(400);
      expect((res.json as { code?: string }).code, label).toBe("23514");
    }
    expect(await nameOf(mara.pageId)).toBe("Summer tour");

    // Plain text is accepted: 60 characters, an emoji name, markup.
    for (const name of ["x".repeat(60), "😀".repeat(60), "<script>alert(1)</script>"]) {
      expect((await patchName(maraToken, mara.pageId, { name })).status).toBe(200);
      expect(await nameOf(mara.pageId)).toBe(name);
    }
    await patchName(maraToken, mara.pageId, { name: "Summer tour" });

    // A name together with a column that is not the user's to write is refused for the column.
    for (const extra of [
      { handle: "newhandle" },
      { published: { version: 1 } },
      { published_at: new Date().toISOString() },
      { owner_id: jonas.id },
      { id: "00000000-0000-4000-8000-000000000999" },
    ]) {
      const res = await patchName(maraToken, mara.pageId, { name: "Hi", ...extra });
      expect([401, 403], JSON.stringify(extra)).toContain(res.status);
    }
    expect(await nameOf(mara.pageId)).toBe("Summer tour");
    expect(await documentsOf(mara.pageId)).toBe(before);
  });

  test("M6-13 a suspended owner's rename changes nothing and works again after the unsuspend", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw API, no UI");
    const owner = await signedInUser(context, { label: "nm3" });
    const token = await accessTokenFor(owner.email);
    const admin = adminClient();
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", owner.userId);
    const refused = await patchName(token, owner.pageId, { name: "While suspended" });
    expect(refused.json).toEqual([]);
    expect(await nameOf(owner.pageId)).toBe("Main page");
    await admin.from("accounts").update({ suspended_at: null }).eq("id", owner.userId);
    expect((await patchName(token, owner.pageId, { name: "Back again" })).status).toBe(200);
    expect(await nameOf(owner.pageId)).toBe("Back again");
  });

  test("M6-13 the name is private: it is not in the published document, the tenant page, its image or the document's status", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw API, no UI");
    const owner = await signedInUser(context, { label: "nm4" });
    const token = await accessTokenFor(owner.email);
    const host = `${owner.handle}.localhost:3000`;
    // Next puts a different request id into every page, so the markup is compared without it.
    const stable = (html: string) => html.replace(/self\.__next_r="[^"]*"/g, "");
    const pageBefore = stable((await rawRequest(host, "/")).body);
    const ogBefore = await rawBytes(host, "/og");
    expect(ogBefore.status).toBe(200);
    const rowBefore = await pageRow(owner.pageId);

    const secret = "Zq private working title";
    expect((await patchName(token, owner.pageId, { name: secret })).status).toBe(200);

    const pageAfter = stable((await rawRequest(host, "/")).body);
    expect(pageAfter).toBe(pageBefore);
    expect(pageAfter).not.toContain(secret);
    const ogAfter = await rawBytes(host, "/og");
    expect(ogAfter.status).toBe(200);
    expect(ogAfter.bytes.equals(ogBefore.bytes)).toBe(true);

    const rowAfter = await pageRow(owner.pageId);
    expect(rowAfter.draft).toEqual(rowBefore.draft);
    expect(JSON.stringify(rowAfter.published)).not.toContain(secret);
    expect(JSON.stringify(rowAfter.draft)).not.toContain(secret);
    expect((rowAfter.draft as { rev: number }).rev).toBe((rowBefore.draft as { rev: number }).rev);
  });

  test("M6-13 a created page is named by the server: Main page first, then Page 2 and Page 3; a name in the body is ignored", async ({
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "raw API, no UI");
    const owner = await signedInUser(context, { label: "nm5", plan: "pro" });
    expect(await nameOf(owner.pageId)).toBe("Main page");
    const second = await createPage(context, `zq-nm5b-${Math.random().toString(36).slice(2, 7)}`, {
      name: "Evil name",
    });
    const third = await createPage(context, `zq-nm5c-${Math.random().toString(36).slice(2, 7)}`, {
      name: "Another",
    });
    expect(await nameOf(second)).toBe("Page 2");
    expect(await nameOf(third)).toBe("Page 3");
    expect(await nameOf(owner.pageId)).toBe("Main page");
  });
});

test.describe("M6-14 the editor header", () => {
  test("M6-14 the h1 is the page's name, the breadcrumb is only the address, and the pencil is a 44px button", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "hd" });
    await openEditor(page);
    await expect(header(page).locator("p")).toHaveText(`${owner.handle}.hydlnk.com`);
    await expect(h1(page)).toHaveText("Main page");
    const box = (await pencil(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(pencil(page)).toHaveAttribute("aria-label", "Rename page");
    // The pencil follows the title.
    const title = (await h1(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
    await expect(header(page).locator("p")).toHaveCount(1);
  });

  test("M6-14 rename: the field is labeled and selected, Enter saves with a PATCH of only {name}, and the new name survives a reload; nothing autosaves or changes the status", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "rn" });
    const rowBefore = await pageRow(owner.pageId);
    await openEditor(page);
    const chip = await statusChip(page).getAttribute("data-publish-status");
    const patches: { url: string; body: string; headers: Record<string, string> }[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) {
        patches.push({
          url: request.url(),
          body: request.postData() ?? "",
          headers: request.headers(),
        });
      }
    });

    await pencil(page).click();
    const field = nameField(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Main page");
    expect(
      await page.evaluate(
        () => window.getSelection()?.toString() || document.activeElement?.tagName,
      ),
    ).toBeTruthy();
    expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(header(page).getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(header(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();

    await field.fill("Summer tour");
    await field.press("Enter");
    await expect(h1(page)).toHaveText("Summer tour");
    await expect(nameField(page)).toHaveCount(0);
    await expect(pencil(page)).toBeFocused();

    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain(`/rest/v1/pages?id=eq.${owner.pageId}`);
    expect(JSON.parse(patches[0]!.body)).toEqual({ name: "Summer tour" });
    expect(patches[0]!.headers.apikey).toBe(publishableKey());
    expect(patches[0]!.headers.authorization).toMatch(/^Bearer /);
    expect(await nameOf(owner.pageId)).toBe("Summer tour");

    // The document, its rev and the status chip did not move.
    await page.waitForTimeout(1200);
    expect(patches).toHaveLength(1);
    expect((await pageRow(owner.pageId)).draft).toEqual(rowBefore.draft);
    expect(await statusChip(page).getAttribute("data-publish-status")).toBe(chip);

    await page.reload();
    await expect(h1(page)).toHaveText("Summer tour");
  });

  test("M6-14 Escape and Cancel restore the title and return focus to the pencil; Save is a button too", async ({
    page,
    context,
  }) => {
    await signedInUser(context, { label: "esc" });
    await openEditor(page);
    await pencil(page).click();
    await nameField(page).fill("Never saved");
    await page.keyboard.press("Escape");
    await expect(h1(page)).toHaveText("Main page");
    await expect(pencil(page)).toBeFocused();

    await pencil(page).click();
    await nameField(page).fill("Never saved either");
    await header(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(h1(page)).toHaveText("Main page");
    await expect(pencil(page)).toBeFocused();

    await pencil(page).click();
    await nameField(page).fill("Saved by button");
    await header(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect(h1(page)).toHaveText("Saved by button");
  });

  test("M6-14 a blank name says 'Add a name.' and sends nothing; a 70 character paste keeps 60; markup shows as plain text", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "val" });
    await openEditor(page);
    let patches = 0;
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes("/rest/v1/pages")) patches++;
    });

    await pencil(page).click();
    await nameField(page).fill("   ");
    await nameField(page).press("Enter");
    await expect(header(page).getByText("Add a name.")).toBeVisible();
    expect(patches).toBe(0);
    await expect(nameField(page)).toBeVisible();

    await nameField(page).fill("x".repeat(70));
    expect((await nameField(page).inputValue()).length).toBe(60);
    await nameField(page).fill("😀".repeat(70));
    expect(Array.from(await nameField(page).inputValue()).length).toBe(60);

    await nameField(page).fill("<b>x</b>");
    await nameField(page).press("Enter");
    await expect(h1(page)).toHaveText("<b>x</b>");
    await expect(h1(page).locator("b")).toHaveCount(0);
    expect(await nameOf(owner.pageId)).toBe("<b>x</b>");
  });

  test("M6-14 failures keep the field open with the typed name: a dropped network, a 5xx, a 401, and a request that changes no row", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "fl" });
    const other = await makeUser("fl2");
    const otherPage = await insertPage(
      other.id,
      `zq-fl2-${Math.random().toString(36).slice(2, 7)}`,
    );
    await openEditor(page);

    let mode: "abort" | "500" | "401" | "foreign" | "pass" = "abort";
    await page.route("**/rest/v1/pages?id=eq.*", async (route) => {
      const request = route.request();
      if (request.method() !== "PATCH") return route.continue();
      if (mode === "abort") return route.abort("failed");
      if (mode === "500") return route.fulfill({ status: 500, body: "{}" });
      if (mode === "401") {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"message":"JWT expired"}',
        });
      }
      if (mode === "foreign") {
        // The same request, replayed with another user's page id: the database matches no row.
        return route.continue({ url: request.url().replace(owner.pageId, otherPage) });
      }
      return route.continue();
    });

    await pencil(page).click();
    await nameField(page).fill("Typed name");
    const save = header(page).getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(header(page).getByText("Couldn’t rename the page. Try again.")).toBeVisible();
    await expect(nameField(page)).toHaveValue("Typed name");

    mode = "500";
    await save.click();
    await expect(header(page).getByText("Couldn’t rename the page. Try again.")).toBeVisible();
    await expect(nameField(page)).toHaveValue("Typed name");

    mode = "401";
    await save.click();
    await expect(
      header(page).getByText("You’re signed out. Sign in again, then try again."),
    ).toBeVisible();
    await expect(nameField(page)).toHaveValue("Typed name");

    mode = "foreign";
    await save.click();
    await expect(header(page).getByText("Couldn’t rename the page. Try again.")).toBeVisible();
    expect(await nameOf(otherPage)).toBe("Main page");
    expect(await nameOf(owner.pageId)).toBe("Main page");

    mode = "pass";
    await save.click();
    await expect(h1(page)).toHaveText("Typed name");
    expect(await nameOf(owner.pageId)).toBe("Typed name");
  });

  test("M6-14 a suspended owner sees the pencil disabled with the reason", async ({
    page,
    context,
  }) => {
    const owner = await signedInUser(context, { label: "sp" });
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", owner.userId);
    await openEditor(page);
    await expect(pencil(page)).toBeDisabled();
    await expect(pencil(page)).toHaveAttribute("title", "Your account is suspended.");
  });

  test("M6-14 two tabs renaming the same page: the last write wins and neither shows an error", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same code path at both widths");
    const owner = await signedInUser(context, { label: "tw" });
    await openEditor(page);
    const second = await context.newPage();
    await openEditor(second);

    await pencil(page).click();
    await nameField(page).fill("First tab");
    await nameField(page).press("Enter");
    await expect(h1(page)).toHaveText("First tab");

    await pencil(second).click();
    await nameField(second).fill("Second tab");
    await nameField(second).press("Enter");
    await expect(h1(second)).toHaveText("Second tab");
    await expect(header(page).getByRole("alert")).toHaveCount(0);
    await expect(header(second).getByRole("alert")).toHaveCount(0);
    expect(await nameOf(owner.pageId)).toBe("Second tab");
    await second.close();
  });

  test("M6-14 the browser's own Ctrl+Z works inside the field", async ({ page, context }, info) => {
    test.skip(!desktopOnly(info), "keyboard shortcut");
    await signedInUser(context, { label: "uz" });
    await openEditor(page);
    await pencil(page).click();
    await nameField(page).fill("Hello");
    await nameField(page).press("Control+a");
    await nameField(page).pressSequentially("World");
    await nameField(page).press("Control+z");
    expect(await nameField(page).inputValue()).not.toBe("World");
  });
});

test.describe("M6-14 where names show", () => {
  test("M6-14 the switcher, Settings and the Serves choices show the name with the address; two pages may share a name; choosing a page changes the h1", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same data path at both widths");
    const owner = await signedInUser(context, { label: "ws", plan: "pro" });
    const secondHandle = `zq-ws2-${Math.random().toString(36).slice(2, 7)}`;
    const thirdHandle = `zq-ws3-${Math.random().toString(36).slice(2, 7)}`;
    const second = await createPage(context, secondHandle);
    await createPage(context, thirdHandle);
    // Creating a page selects it: go back to the first one.
    await context.addCookies([{ name: "hl-page", value: owner.pageId, url: url("app") }]);

    await openEditor(page);
    await expect(h1(page)).toHaveText("Main page");
    const switcher = page.locator("aside").getByRole("button", { name: /Switch page, current:/ });
    await expect(switcher).toHaveAttribute(
      "aria-label",
      `Switch page, current: ${owner.handle}.hydlnk.com`,
    );
    await expect(switcher).toContainText(`${owner.handle}.hydlnk.com`);
    await switcher.click();
    const items = page.locator("aside").getByRole("menuitemradio");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Main page");
    await expect(items.nth(0)).toContainText(`${owner.handle}.hydlnk.com`);
    await expect(items.nth(1)).toContainText("Page 2");
    await expect(items.nth(1)).toContainText(`${secondHandle}.hydlnk.com`);
    await expect(items.nth(2)).toContainText("Page 3");
    for (let i = 0; i < 3; i++)
      expect((await items.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Choosing another page changes the h1 to that page's name.
    await items.nth(1).click();
    await expect(h1(page)).toHaveText("Page 2");
    await expect(header(page).locator("p")).toHaveText(`${secondHandle}.hydlnk.com`);

    // Renaming one does not change the other two; Settings lists all three by name in creation order.
    await pencil(page).click();
    await nameField(page).fill("Summer tour");
    await nameField(page).press("Enter");
    await expect(h1(page)).toHaveText("Summer tour");
    expect(await nameOf(owner.pageId)).toBe("Main page");
    expect(await nameOf(second)).toBe("Summer tour");
    await switcher.click();
    await expect(items.nth(1)).toContainText("Summer tour");
    await expect(items.nth(2)).toContainText("Page 3");
    await page.keyboard.press("Escape");

    await page.goto(url("app", "/settings"));
    const rows = page.locator("[data-page-row]");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Main page");
    await expect(rows.nth(0)).toContainText(`${owner.handle}.hydlnk.com`);
    await expect(rows.nth(1)).toContainText("Summer tour");
    await expect(rows.nth(1)).toContainText(`${secondHandle}.hydlnk.com`);
    await expect(rows.nth(2)).toContainText("Page 3");
    // The delete dialog still names the address.
    await rows.nth(2).getByRole("button", { name: "Delete page" }).click();
    await expect(page.getByRole("dialog")).toContainText(`Delete ${thirdHandle}.hydlnk.com?`);
    await page.keyboard.press("Escape");

    // The domains screen lists the choices as "name · address".
    await page.goto(url("app", "/domains"));
    const serves = page.getByLabel("Serves").first();
    await expect(serves.locator("option")).toHaveText([
      `Main page · ${owner.handle}.hydlnk.com`,
      `Summer tour · ${secondHandle}.hydlnk.com`,
      `Page 3 · ${thirdHandle}.hydlnk.com`,
    ]);
  });

  test("M6-14 the load-failure card shows the page's real name and address", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "same data path at both widths");
    test.skip(
      FAULT_COOKIE_IGNORED,
      "this production server was started without the test hooks, so it ignores the fault cookie",
    );
    const owner = await signedInUser(context, { label: "lf" });
    await adminClient()
      .from("pages")
      .update({ name: "Renamed before the failure" })
      .eq("id", owner.pageId);
    await context.addCookies([{ name: "hl-fault", value: "draft-load", url: url("app") }]);
    await page.goto(url("app", "/editor"));
    await expect(page.getByTestId("load-failure")).toBeVisible();
    // M7-02: a failed load has no toolbar; the page header is the card's: the address and the name.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Renamed before the failure");
    await expect(page.locator("main > header p")).toHaveText(`${owner.handle}.hydlnk.com`);
    await context.clearCookies({ name: "hl-fault" });
  });
});

test.describe("M6-14 layout", () => {
  test("M6-14 a 60 character name with no spaces wraps inside the h1 on a phone and is cut with an ellipsis in the 56px toolbar; the cluster keeps its row at 1440; at 390 the rename form stacks at full width", async ({
    page,
    context,
  }, info) => {
    const owner = await signedInUser(context, { label: "ly" });
    const long = "W".repeat(60);
    await adminClient().from("pages").update({ name: long }).eq("id", owner.pageId);
    await openEditor(page);
    await expect(h1(page)).toHaveText(long);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-testid='workspace-toolbar']");
    const title = (await h1(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(title.x + title.width).toBeLessThanOrEqual(viewport.width);
    if (info.project.name === "desktop") {
      // M7-05: the toolbar is one 56px row, so the long name stays on one line and is cut.
      expect(title.height).toBeLessThanOrEqual(30);
      expect(await h1(page).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      // It wrapped: taller than one 22px line.
      expect(title.height).toBeGreaterThan(30);
    }

    const publish = (await header(page)
      .getByRole("button", { name: "Publish", exact: true })
      .boundingBox())!;
    if (info.project.name === "desktop") {
      // The right-hand cluster stays on its row, next to the title block.
      expect(publish.x + publish.width).toBeLessThanOrEqual(viewport.width);
      expect(publish.y).toBeLessThan(title.y + title.height);
    }

    await pencil(page).click();
    const field = nameField(page);
    const save = header(page).getByRole("button", { name: "Save", exact: true });
    const cancel = header(page).getByRole("button", { name: "Cancel", exact: true });
    const [f, s, c] = [
      await field.boundingBox(),
      await save.boundingBox(),
      await cancel.boundingBox(),
    ];
    expect(f!.height).toBeGreaterThanOrEqual(44);
    expect(s!.height).toBeGreaterThanOrEqual(44);
    expect(c!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "[data-testid='workspace-toolbar']");
    if (info.project.name === "phone") {
      // Stacked, each as wide as the header's content.
      expect(s!.y).toBeGreaterThan(f!.y + f!.height - 1);
      expect(c!.y).toBeGreaterThan(s!.y + s!.height - 1);
      expect(Math.abs(f!.width - s!.width)).toBeLessThan(2);
      expect(Math.abs(f!.width - c!.width)).toBeLessThan(2);
    } else {
      // The input replaces the title in the left block; the right cluster does not move.
      const after = (await header(page)
        .getByRole("button", { name: "Publish", exact: true })
        .boundingBox())!;
      expect(Math.abs(after.x - publish.x)).toBeLessThan(2);
      // Still on the header's one row (it is centered, so it follows the title block's height).
      const bar = (await header(page).boundingBox())!;
      expect(after.y).toBeGreaterThanOrEqual(bar.y);
      expect(after.y + after.height).toBeLessThanOrEqual(bar.y + bar.height);
      const input = (await field.boundingBox())!;
      expect(input.x + input.width).toBeLessThanOrEqual(after.x);
    }
  });
});
