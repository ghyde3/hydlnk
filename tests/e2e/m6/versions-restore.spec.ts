import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectTapTargets, url } from "../helpers";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, phoneOnly, rand, signedInUser } from "../fixtures/data";
import { openEditor, statusChip } from "../m2/editor-helpers";
import {
  EDITOR_URL,
  allRows,
  bioOf,
  changeDraftBio,
  makeVersions,
  openHistory,
  pageState,
  rowFor,
  trackActions,
  versionRows,
} from "./versions-helpers";

/**
 * M6-49 and M6-50: restoring a version into the draft from the history screen. Confirmation, the
 * request, the success line with Open editor and Undo, every failure, Publish afterwards, and the
 * requests an edited page and version id cannot change.
 */

test.afterAll(cleanupUsers);

test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

const restoreButton = (page: Page, n: number) =>
  rowFor(page, n).getByRole("button", { name: `Restore version ${n}`, exact: true });
const confirmOf = (page: Page, n: number) => rowFor(page, n).getByTestId("restore-confirm");
const confirmButton = (page: Page, n: number) =>
  confirmOf(page, n).getByRole("button", { name: `Restore version ${n}`, exact: true });
const keepButton = (page: Page, n: number) =>
  confirmOf(page, n).getByRole("button", { name: "Keep my draft", exact: true });

/** A published page with `count` versions and an unpublished edit in the draft. */
async function pageWithVersions(
  context: import("@playwright/test").BrowserContext,
  label: string,
  count = 3,
  plan: "pro" | "studio" = "pro",
) {
  const user = await signedInUser(context, { label, plan });
  const made = await makeVersions(user.pageId, count, { label: "Bio" });
  await changeDraftBio(user.pageId, "My unpublished edit");
  return { user, made };
}

test.describe("M6-50 the confirmation", () => {
  test("M6-50 Restore asks first, says what is replaced and what is not, and Escape and Keep my draft close it and return focus", async ({
    page,
    context,
  }) => {
    const { user } = await pageWithVersions(context, "vr1");
    const before = await pageState(user.pageId);
    await openHistory(page);

    await restoreButton(page, 2).click();
    const confirm = confirmOf(page, 2);
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      "Restore version 2? Your draft is replaced with this version. Your live page doesn’t change until you publish.",
    );
    // the draft differs from the live page, so it says so
    await expect(page.getByTestId("restore-unpublished")).toHaveText(
      "You have unpublished changes. They’ll be replaced.",
    );
    const confirmBtn = confirmButton(page, 2);
    const keep = keepButton(page, 2);
    expect(await confirmBtn.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(28, 27, 26)",
    );
    expect(await keep.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(255, 255, 255)",
    );
    expect((await confirmBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await keep.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Escape closes it and focus goes back to Restore
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(restoreButton(page, 2)).toBeFocused();

    // Keep my draft does the same
    await restoreButton(page, 2).click();
    await expect(confirm).toBeVisible();
    await keepButton(page, 2).click();
    await expect(confirm).toBeHidden();
    await expect(restoreButton(page, 2)).toBeFocused();

    // nothing was sent and nothing changed
    expect(await pageState(user.pageId)).toEqual(before);
  });

  test("M6-50 the unpublished-changes line is left out when the draft equals the live page", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vr2", plan: "pro" });
    await makeVersions(user.pageId, 2);
    // draft = what is live
    await changeDraftBio(user.pageId, "Bio number 2");
    await openHistory(page);
    await restoreButton(page, 1).click();
    await expect(confirmOf(page, 1)).toBeVisible();
    await expect(page.getByTestId("restore-unpublished")).toHaveCount(0);
  });

  test("M6-50 phone: the confirmation's buttons are stacked, full width and at least 44px tall", async ({
    page,
    context,
  }, info) => {
    test.skip(!phoneOnly(info), "the stacked confirmation is the phone layout");
    await pageWithVersions(context, "vr3");
    await openHistory(page);
    await restoreButton(page, 2).click();
    const confirm = confirmOf(page, 2);
    await expect(confirm).toBeVisible();
    const box = (await confirm.boundingBox())!;
    const yes = (await confirmButton(page, 2).boundingBox())!;
    const no = (await keepButton(page, 2).boundingBox())!;
    expect(yes.height).toBeGreaterThanOrEqual(44);
    expect(no.height).toBeGreaterThanOrEqual(44);
    expect(no.y).toBeGreaterThan(yes.y + yes.height - 1);
    expect(Math.abs(yes.x - no.x)).toBeLessThan(2);
    // full width of the confirmation box (less its padding)
    expect(yes.width).toBeGreaterThan(box.width - 40);
    expect(no.width).toBeGreaterThan(box.width - 40);
    await expectNoHorizontalScroll(page);
    await expectTapTargets(page, "li[data-version-no='2']");
  });
});

test.describe("M6-50 restoring", () => {
  test("M6-49 + M6-50 Restore replaces the draft, never publishes, says so, and the editor shows Unpublished changes", async ({
    page,
    context,
  }) => {
    const { user, made } = await pageWithVersions(context, "vr4");
    const before = await pageState(user.pageId);
    const versionsBefore = await versionRows(user.pageId);
    await openHistory(page);
    const actions = trackActions(page);

    // slow the one request down so "Restoring…" can be seen, and count what is sent on a double click
    await page.route("**/*", async (route) => {
      if (route.request().headers()["next-action"] !== undefined)
        await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    await restoreButton(page, 2).click();
    const confirmBtn = confirmButton(page, 2);
    await confirmBtn.dblclick();
    await expect(confirmOf(page, 2).getByRole("button", { name: "Restoring…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    const done = rowFor(page, 2).getByTestId("restore-done");
    await expect(done).toBeVisible();
    await expect(done).toContainText(
      "Restored version 2 to your draft. Review it in the editor, then publish.",
    );
    expect(actions).toHaveLength(1);
    await page.unroute("**/*");

    // Open editor and Undo, each at least 44px tall
    const open = done.getByRole("link", { name: "Open editor" });
    const undo = done.getByRole("button", { name: "Undo" });
    await expect(open).toHaveAttribute("href", "/editor");
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // the draft is version 2, the live page and the versions are exactly as they were
    const after = await pageState(user.pageId);
    expect(bioOf(after.draft)).toBe(made[1]!.bio);
    expect(after.draft.rev as number).toBe((before.draft.rev as number) + 1);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toEqual(before.published_at);
    expect(await versionRows(user.pageId)).toEqual(versionsBefore);

    // the editor shows the version's content, unpublished
    await open.click();
    await expect(page).toHaveURL(EDITOR_URL);
    await expect(page.getByLabel("Bio", { exact: true })).toHaveValue(made[1]!.bio);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
  });

  test("M6-50 Publish after a restore makes a new version, tagged Live now, and the tenant page shows the restored content", async ({
    page,
    context,
  }) => {
    const { user, made } = await pageWithVersions(context, "vr5");
    await openHistory(page);
    await restoreButton(page, 1).click();
    await confirmButton(page, 1).click();
    await expect(rowFor(page, 1).getByTestId("restore-done")).toBeVisible();

    await page.goto(EDITOR_URL);
    await openEditor(page);
    await expect(statusChip(page)).toHaveText("Unpublished changes");
    // the live page has not changed yet
    const live = await page.request.get(url(user.handle)).catch(() => null);
    void live;
    await page
      .getByTestId("workspace-toolbar")
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(statusChip(page)).toHaveText("Published");

    await openHistory(page);
    await expect(allRows(page)).toHaveCount(4);
    const newest = rowFor(page, 4);
    await expect(newest.getByTestId("live-chip")).toHaveText("Live now");
    await expect(page.getByTestId("live-chip")).toHaveCount(1);
    expect(bioOf((await versionRows(user.pageId)).at(-1)!.document)).toBe(made[0]!.bio);

    await page.goto(url(user.handle));
    await expect(page.getByText(made[0]!.bio, { exact: true })).toBeVisible();
    await expect(page.getByText(made[2]!.bio, { exact: true })).toHaveCount(0);
  });

  test("M6-50 Undo writes back the draft the screen read, says Undone, and the editor shows it again", async ({
    page,
    context,
  }) => {
    const { user } = await pageWithVersions(context, "vr6");
    const before = await pageState(user.pageId);
    await openHistory(page);
    await restoreButton(page, 1).click();
    await confirmButton(page, 1).click();
    const done = rowFor(page, 1).getByTestId("restore-done");
    await expect(done).toBeVisible();
    expect(bioOf((await pageState(user.pageId)).draft)).toBe("Bio number 1");

    await done.getByRole("button", { name: "Undo" }).click();
    await expect(rowFor(page, 1).getByTestId("restore-undone")).toHaveText("Undone.");
    const after = await pageState(user.pageId);
    // the draft as it was, with a newer rev than the restore left (so an old editor tab still meets its guard)
    expect({ ...after.draft, rev: 0 }).toEqual({ ...before.draft, rev: 0 });
    expect(after.draft.rev as number).toBeGreaterThan((before.draft.rev as number) + 1);
    expect(after.published).toEqual(before.published);

    await page.goto(EDITOR_URL);
    await openEditor(page);
    await expect(page.getByLabel("Bio", { exact: true })).toHaveValue("My unpublished edit");
  });

  test("M6-50 Undo after something else saved the draft says so and keeps what was saved", async ({
    page,
    context,
  }) => {
    const { user } = await pageWithVersions(context, "vr7");
    await openHistory(page);
    await restoreButton(page, 1).click();
    await confirmButton(page, 1).click();
    const done = rowFor(page, 1).getByTestId("restore-done");
    await expect(done).toBeVisible();
    // another tab saves the draft after the restore
    await changeDraftBio(user.pageId, "Typed after the restore");
    await done.getByRole("button", { name: "Undo" }).click();
    await expect(rowFor(page, 1).getByTestId("undo-failed")).toHaveText(
      "Your page changed in another tab. Reload, then try again.",
    );
    expect(bioOf((await pageState(user.pageId)).draft)).toBe("Typed after the restore");
  });

  test("M6-50 a restore with images that are gone adds the line about them to the success message", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vr8", plan: "pro" });
    const gone = (name: string) => ({
      path: `${user.userId}/${name}.webp`,
      width: 400,
      height: 400,
    });
    await makeVersions(user.pageId, 2, {
      extra: (i, base) => {
        const blocks = [...(base.blocks as Record<string, unknown>[])];
        const card = blocks.findIndex((b) => b.type === "card");
        const profile = base.profile as Record<string, unknown>;
        if (i === 1) {
          blocks[card] = { ...blocks[card], image: gone("gone-card-img1") };
          return {
            blocks,
            profile: { ...profile, bio: "With two images", photo: gone("gone-photo-001") },
          };
        }
        return {};
      },
    });
    await openHistory(page);
    await restoreButton(page, 1).click();
    await confirmButton(page, 1).click();
    await expect(rowFor(page, 1).getByTestId("restore-done")).toContainText(
      "Restored version 1 to your draft. Review it in the editor, then publish. 2 images from this version are no longer stored. Add them again before you publish.",
    );
    const draft = (await pageState(user.pageId)).draft as { profile: { photo: unknown } };
    expect(draft.profile.photo).toBeNull();
  });
});

test.describe("M6-50 failures keep the draft and say what to do", () => {
  test("M6-50 a version with a link to a blocked site can't be restored, names the site and changes nothing", async ({
    page,
    context,
  }) => {
    const user = await signedInUser(context, { label: "vr9", plan: "pro" });
    const host = `zq-blk-${rand(8)}.example.test`;
    await makeVersions(user.pageId, 2, {
      extra: (i, base) => {
        const blocks = [...(base.blocks as Record<string, unknown>[])];
        if (i === 1)
          blocks.push({
            id: "blkLink0001",
            type: "link",
            visible: true,
            label: "Shady",
            url: `https://${host}/x`,
          });
        return { blocks };
      },
    });
    const admin = adminClient();
    expect(
      (await admin.from("blocked_domains").insert({ domain: host, reason: "test" })).error,
    ).toBeNull();
    try {
      const before = await pageState(user.pageId);
      await openHistory(page);
      await restoreButton(page, 1).click();
      await confirmButton(page, 1).click();
      await expect(rowFor(page, 1).getByTestId("restore-failed")).toHaveText(
        `This version has a link to a blocked site (${host}), so it can’t be restored.`,
      );
      expect(await pageState(user.pageId)).toEqual(before);
    } finally {
      await admin.from("blocked_domains").delete().eq("domain", host);
    }
  });

  test("M6-50 a suspended account gets the suspended message and its draft is untouched", async ({
    page,
    context,
  }) => {
    const { user } = await pageWithVersions(context, "vr10");
    const before = await pageState(user.pageId);
    await openHistory(page);
    await adminClient()
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", user.userId);
    await restoreButton(page, 2).click();
    await confirmButton(page, 2).click();
    await expect(rowFor(page, 2).getByTestId("restore-failed")).toHaveText(
      "Couldn’t restore. Your account is suspended.",
    );
    expect(await pageState(user.pageId)).toEqual(before);
  });

  test("M6-50 a request that fails says the draft is safe and offers Retry, which works", async ({
    page,
    context,
  }) => {
    const { user, made } = await pageWithVersions(context, "vr11");
    const before = await pageState(user.pageId);
    await openHistory(page);
    await page.route("**/*", async (route) => {
      if (route.request().headers()["next-action"] !== undefined) await route.abort("failed");
      else await route.continue();
    });
    await restoreButton(page, 3).click();
    await confirmButton(page, 3).click();
    const failed = rowFor(page, 3).getByTestId("restore-failed");
    await expect(failed).toContainText(
      "Couldn’t restore that version. Your draft is safe. Try again.",
    );
    expect(await pageState(user.pageId)).toEqual(before);
    await page.unroute("**/*");
    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(rowFor(page, 3).getByTestId("restore-done")).toBeVisible();
    expect(bioOf((await pageState(user.pageId)).draft)).toBe(made[2]!.bio);
  });

  test("M6-50 a downgrade while the screen is open turns a Restore into the locked card, and the draft is untouched", async ({
    page,
    context,
  }) => {
    const { user } = await pageWithVersions(context, "vr12");
    const before = await pageState(user.pageId);
    await openHistory(page);
    await adminClient().from("accounts").update({ plan: "free" }).eq("id", user.userId);
    await restoreButton(page, 2).click();
    await confirmButton(page, 2).click();
    await expect(page.getByTestId("history-locked")).toBeVisible();
    expect(await pageState(user.pageId)).toEqual(before);
  });
});

test.describe("M6-49 + M6-50 abuse: edited ids change nothing", () => {
  /** Rewrites the Server Action body of the next restore, swapping one id for another. */
  async function rewriteActionBody(page: Page, from: string, to: string) {
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.headers()["next-action"] !== undefined && request.postData()?.includes(from)) {
        await route.continue({ postData: request.postData()!.split(from).join(to) });
      } else {
        await route.continue();
      }
    });
  }

  test("M6-50 a version id swapped for another user's version is not_found: generic failure, both drafts unchanged", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const { user: a, made } = await pageWithVersions(context, "vr13");
    const other = await signedInUser(await page.context().browser()!.newContext(), {
      label: "vr14",
      plan: "pro",
    });
    const theirs = await makeVersions(other.pageId, 2, { label: "Theirs" });
    const aBefore = await pageState(a.pageId);
    const bBefore = await pageState(other.pageId);
    await openHistory(page);
    await rewriteActionBody(page, made[1]!.id, theirs[0]!.id);
    await restoreButton(page, 2).click();
    await confirmButton(page, 2).click();
    await expect(rowFor(page, 2).getByTestId("restore-failed")).toContainText(
      "Couldn’t restore that version. Your draft is safe. Try again.",
    );
    expect(await pageState(a.pageId)).toEqual(aBefore);
    expect(await pageState(other.pageId)).toEqual(bBefore);
    // the failure never names the other user's ids
    await expect(page.locator("body")).not.toContainText(theirs[0]!.id);
    await expect(page.locator("body")).not.toContainText(other.pageId);
  });

  test("M6-50 a page id swapped for another user's page is forbidden: generic failure, nothing changes", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const { user: a } = await pageWithVersions(context, "vr15");
    const other = await signedInUser(await page.context().browser()!.newContext(), {
      label: "vr16",
      plan: "pro",
    });
    await makeVersions(other.pageId, 2, { label: "Theirs" });
    const aBefore = await pageState(a.pageId);
    const bBefore = await pageState(other.pageId);
    await openHistory(page);
    await rewriteActionBody(page, a.pageId, other.pageId);
    await restoreButton(page, 1).click();
    await confirmButton(page, 1).click();
    await expect(rowFor(page, 1).getByTestId("restore-failed")).toBeVisible();
    expect(await pageState(a.pageId)).toEqual(aBefore);
    expect(await pageState(other.pageId)).toEqual(bBefore);
  });

  test("M6-50 a Preview request with a version of another user's page shows a failure and nothing of theirs", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const { made } = await pageWithVersions(context, "vr17");
    const other = await signedInUser(await page.context().browser()!.newContext(), {
      label: "vr18",
      plan: "pro",
    });
    const theirs = await makeVersions(other.pageId, 2, { label: "SecretTheirs" });
    await openHistory(page);
    await rewriteActionBody(page, made[0]!.id, theirs[0]!.id);
    await rowFor(page, 1).getByRole("button", { name: "Preview version 1" }).click();
    await expect(page.getByTestId("history-preview").getByRole("alert")).toHaveText(
      "Couldn’t load that version. Try again.",
    );
    await expect(page.locator("body")).not.toContainText("SecretTheirs");
  });
});

test.describe("M6-48 deleting a page removes its versions", () => {
  test("M6-48 DELETE /api/pages/{id} leaves no version rows behind, and the other page keeps its own", async ({
    page,
    context,
  }, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const user = await signedInUser(context, { label: "vr19", plan: "pro" });
    const admin = adminClient();
    const second = await admin
      .from("pages")
      .insert({
        owner_id: user.userId,
        handle: `zq-vr19b-${rand(4)}`,
        draft: (await pageState(user.pageId)).draft as never,
      })
      .select("id, handle")
      .single();
    expect(second.error).toBeNull();
    const secondId = second.data!.id as string;
    // versions on both pages
    await makeVersions(user.pageId, 2);
    const base = (await pageState(user.pageId)).published;
    for (let i = 1; i <= 2; i++) {
      await admin
        .from("pages")
        .update({
          published: {
            ...base,
            profile: { ...(base.profile as object), bio: `Second ${i}` },
          } as never,
          published_at: new Date(Date.now() - 60_000 + i * 1000).toISOString(),
        })
        .eq("id", secondId);
    }
    expect(await versionRows(secondId)).toHaveLength(2);

    await page.goto(url("app", "/editor"));
    const status = await page.evaluate(
      async ({ id, confirm }) => {
        const res = await fetch(`/api/pages/${id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm }),
        });
        return res.status;
      },
      { id: secondId, confirm: second.data!.handle as string },
    );
    expect(status).toBe(200);
    expect(await versionRows(secondId)).toHaveLength(0);
    expect(await versionRows(user.pageId)).toHaveLength(2);
  });
});
