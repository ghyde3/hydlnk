import { expect, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { blockDefaults, type Block, type FormBlock } from "@/lib/document";
import { publishDocOf, publishedPage, type PublishedTestPage } from "../m2/blocks-helpers";

/**
 * Fixtures for the forms wave's specs (Wave D, M17-04 to M17-10): a live page that holds form
 * blocks (written with the secret key), the submissions stored for it, and the checks every
 * result page shares.
 */

export const SIGNUP_ID = "formSignE2E1";
export const CONTACT_ID = "formContE2E1";

export function signupForm(over: Partial<FormBlock> = {}): FormBlock {
  return {
    ...(blockDefaults.form() as FormBlock),
    id: SIGNUP_ID,
    heading: "Studio notes",
    description: "A short letter when a new series is out.",
    ...over,
  };
}

export function contactForm(over: Partial<FormBlock> = {}): FormBlock {
  return {
    ...(blockDefaults.form() as FormBlock),
    id: CONTACT_ID,
    kind: "contact",
    heading: "Write to me",
    buttonLabel: "Send",
    successMessage: "Thanks. Your message was sent.",
    ...over,
  };
}

/** A live page (Free unless said) with both kinds of form under a link. */
export async function formPage(
  label: string,
  opts: { blocks?: Block[]; plan?: "free" | "pro" | "studio" } = {},
): Promise<PublishedTestPage> {
  const blocks = opts.blocks ?? [
    {
      id: "lnkFormE2E1",
      type: "link",
      visible: true,
      label: "Shop",
      url: "https://example.com/shop",
    },
    signupForm(),
    contactForm(),
  ];
  return publishedPage(label, publishDocOf(blocks as Block[]), opts);
}

export interface StoredRow {
  block_id: string;
  kind: string;
  email: string;
  name: string;
  message: string;
  entry_id: string | null;
}

export async function storedRows(siteId: string): Promise<StoredRow[]> {
  const { data, error } = await adminClient()
    .from("form_submissions")
    .select("block_id, kind, email, name, message, entry_id")
    .eq("site_id", siteId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`reading submissions failed: ${error.message}`);
  return (data ?? []) as StoredRow[];
}

/** Polls until the site holds `count` submissions (the 303 answers after the store). */
export async function waitForRows(siteId: string, count: number): Promise<StoredRow[]> {
  let rows: StoredRow[] = [];
  await expect
    .poll(async () => {
      rows = await storedRows(siteId);
      return rows.length;
    })
    .toBe(count);
  return rows;
}

/** One submission written the way the route writes it (the RPC, secret key). */
export async function recordRow(
  siteId: string,
  row: {
    blockId: string;
    kind: "signup" | "contact";
    email: string;
    name?: string;
    message?: string;
  },
): Promise<string> {
  const { data, error } = await adminClient().rpc("record_form_submission", {
    p_site_id: siteId,
    p_block_id: row.blockId,
    p_entry_id: null,
    p_kind: row.kind,
    p_email: row.email,
    p_name: row.name ?? "",
    p_message: row.message ?? "",
  });
  if (error) throw new Error(`record_form_submission failed: ${error.code}`);
  return (data as { status: string }[])[0]!.status;
}

/** Every input, textarea and button inside the visible form controls is at least 44px tall. */
export async function expectFormControls(page: Page, scope = page.locator("main")): Promise<void> {
  const controls = scope.locator(
    ".pg-form input:not([type=hidden]):not([name=hl_confirm]), .pg-form textarea, .pg-form button, .pg-form-back",
  );
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    const box = (await control.boundingBox())!;
    expect(
      box.height,
      await control.evaluate((el) => el.outerHTML.slice(0, 80)),
    ).toBeGreaterThanOrEqual(44);
    const tag = await control.evaluate((el) => el.tagName);
    if (tag === "INPUT" || tag === "TEXTAREA") {
      expect(await control.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    }
  }
}
