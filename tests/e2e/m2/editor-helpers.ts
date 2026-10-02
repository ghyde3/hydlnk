import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient, signInAs } from "../fixtures/auth";
import { insertPage, makeUser, rand, signedInUser, trackEmail } from "../fixtures/data";
import { sessionOf } from "../fixtures/http";
import { emptyDraft, type DraftDoc } from "@/lib/document";
import { url } from "../helpers";

/**
 * Shared setup for the editor specs (M2-03 .. M2-27). Every spec makes its own users: the phone and
 * desktop projects run at the same time, and two contexts autosaving one draft would trip the
 * stale-tab guard. Nothing here touches mara's rows.
 */

export type { DraftDoc };

export const EDITOR_URL = url("app", "/editor");

/** The seeded demo user. Read-only in the editor specs. */
export const MARA_EMAIL = "mara@example.test";

/** A user with a published page copied from mara's (draft equals published). Signed in on `context`. */
export async function seededUser(context: BrowserContext, label = "ed") {
  return signedInUser(context, { label });
}

/** A user whose single page is what signup creates: the handle as name, no blocks, unpublished. */
export async function emptyUser(
  context: BrowserContext,
  label = "ed",
  opts: { draft?: unknown; plan?: "free" | "pro" | "studio" } = {},
) {
  const user = await makeUser(label, { plan: opts.plan });
  const handle = `zq-${label}-${rand(5)}`;
  const pageId = await insertPage(
    user.id,
    handle,
    opts.draft === undefined ? {} : { draft: opts.draft },
  );
  await signInAs(context, user.email);
  return { ...user, handle, pageId };
}

export interface PageRow {
  draft: DraftDoc;
  published: unknown;
  published_at: string | null;
}

export async function pageRow(pageId: string): Promise<PageRow> {
  const { data, error } = await adminClient()
    .from("pages")
    .select("draft, published, published_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(`pageRow failed: ${error.message}`);
  return data as unknown as PageRow;
}

export async function setDraft(pageId: string, draft: unknown): Promise<void> {
  const { error } = await adminClient().from("pages").update({ draft }).eq("id", pageId);
  if (error) throw new Error(`setDraft failed: ${error.message}`);
}

/** Waits until the stored draft satisfies `check` (autosave is asynchronous). */
export async function expectDraft(
  pageId: string,
  check: (draft: DraftDoc) => unknown,
  message = "the stored draft",
): Promise<DraftDoc> {
  let last: DraftDoc | undefined;
  await expect
    .poll(
      async () => {
        last = (await pageRow(pageId)).draft;
        try {
          return Boolean(check(last));
        } catch {
          return false;
        }
      },
      { message, timeout: 15_000 },
    )
    .toBe(true);
  return last!;
}

export const accessToken = async (context: BrowserContext) =>
  (await sessionOf(context)).access_token;

/** A draft with the given blocks and `name`, valid for the draft schema. */
export function draftWith(
  handle: string,
  blocks: unknown[],
  extra: Partial<DraftDoc> = {},
): DraftDoc {
  return { ...emptyDraft(handle), blocks, ...extra } as DraftDoc;
}

/** Opens the editor and waits until the screen is interactive (rendered and hydrated). */
export async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR_URL);
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  // The server-rendered markup is visible before React has attached its handlers; wait for them.
  await page.waitForFunction(() => {
    const input = document.querySelector("input[autocomplete='name']");
    return !!input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
}

export const saveIndicator = (page: Page): Locator => page.locator("[data-save-status]");
export const statusChip = (page: Page): Locator => page.locator("[data-publish-status]");
export const rowOf = (page: Page, blockId: string): Locator =>
  page.locator(`li[data-block-id="${blockId}"]`);
export const rows = (page: Page): Locator => page.locator("li[data-block-id]");
export const bezel = (page: Page): Locator => page.getByTestId("preview-bezel");
export const previewScreen = (page: Page): Locator => page.getByTestId("preview-screen");

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** A unique mark for typed text, so an assertion can never match a seed string. */
export const mark = () => `Zq${rand(5)}`;

export { trackEmail };
