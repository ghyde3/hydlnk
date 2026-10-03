import { expect, type Locator, type Page, type Request } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { url } from "../helpers";

/**
 * Shared setup for the version history specs (M6-48 .. M6-50). Versions are made the way the
 * Publish gate makes them: a secret-key update of `published` and `published_at` together, which the
 * database trigger turns into the next `page_versions` row. Every spec makes its own users (the phone
 * and desktop projects run at the same time); nothing here touches mara's rows.
 */

export const HISTORY_URL = url("app", "/editor/history");
export const EDITOR_URL = url("app", "/editor");

export interface MadeVersion {
  id: string;
  versionNo: number;
  bio: string;
  publishedAt: string;
}

export interface VersionRow {
  id: string;
  version_no: number;
  document: Record<string, unknown> & { profile: { bio: string; name: string } };
  published_at: string;
}

export async function versionRows(pageId: string): Promise<VersionRow[]> {
  const { data, error } = await adminClient()
    .from("page_versions")
    .select("id, version_no, document, published_at")
    .eq("page_id", pageId)
    .order("version_no", { ascending: true });
  if (error) throw new Error(`versionRows failed: ${error.message}`);
  return data as unknown as VersionRow[];
}

export async function pageState(pageId: string) {
  const { data, error } = await adminClient()
    .from("pages")
    .select("draft, published, published_at")
    .eq("id", pageId)
    .single();
  if (error) throw new Error(`pageState failed: ${error.message}`);
  return data as {
    draft: Record<string, unknown>;
    published: Record<string, unknown>;
    published_at: string;
  };
}

/**
 * Publishes `count` distinct documents (the page's current published document with a different bio
 * each time) with the secret key, one second apart, the first at `firstAt`. The last one is live.
 */
export async function makeVersions(
  pageId: string,
  count: number,
  opts: {
    label?: string;
    firstAt?: string;
    extra?: (index: number, base: Record<string, unknown>) => Record<string, unknown>;
  } = {},
): Promise<MadeVersion[]> {
  const admin = adminClient();
  const base = (await pageState(pageId)).published as Record<string, unknown> & {
    profile: Record<string, unknown>;
  };
  const start = Date.parse(opts.firstAt ?? new Date(Date.now() - 3600_000).toISOString());
  const made: MadeVersion[] = [];
  for (let i = 1; i <= count; i++) {
    const bio = `${opts.label ?? "Bio"} number ${i}`;
    const doc = {
      ...base,
      profile: { ...base.profile, bio },
      ...(opts.extra?.(i, base) ?? {}),
    };
    const publishedAt = new Date(start + i * 1000).toISOString();
    const { error } = await admin
      .from("pages")
      .update({ published: doc as never, published_at: publishedAt })
      .eq("id", pageId);
    if (error) throw new Error(`publish #${i} failed: ${error.message}`);
    made.push({ id: "", versionNo: 0, bio, publishedAt });
  }
  // Matched on the Publish time (a document may carry any bio); a version pruned by retention is not returned.
  const rows = await versionRows(pageId);
  const recorded: MadeVersion[] = [];
  for (const m of made) {
    const row = rows.find((r) => Date.parse(r.published_at) === Date.parse(m.publishedAt));
    if (row) recorded.push({ ...m, id: row.id, versionNo: row.version_no });
  }
  return recorded;
}

/** The page's draft with the bio changed: an unpublished change, written like autosave would. */
export async function changeDraftBio(pageId: string, bio: string): Promise<void> {
  const { draft } = await pageState(pageId);
  const profile = { ...(draft.profile as Record<string, unknown>), bio };
  const rev = (draft.rev as number) + 1;
  const { error } = await adminClient()
    .from("pages")
    .update({ draft: { ...draft, profile, rev } as never })
    .eq("id", pageId);
  if (error) throw new Error(`changeDraftBio failed: ${error.message}`);
}

export const rowFor = (page: Page, versionNo: number): Locator =>
  page.locator(`li[data-testid="version-row"][data-version-no="${versionNo}"]`);
export const allRows = (page: Page): Locator => page.getByTestId("version-row");

/** Waits until the history list has React handlers: the server-rendered markup shows before that. */
export async function waitForHistoryHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="version-row"] button');
    return !!button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
  });
}

export async function openHistory(page: Page): Promise<void> {
  await page.goto(HISTORY_URL);
  await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
  await expect(allRows(page).first()).toBeVisible();
  await waitForHistoryHydrated(page);
}

/** Server Action calls the page makes (the POSTs carrying a Next-Action header). */
export function trackActions(page: Page): Request[] {
  const calls: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
      calls.push(request);
    }
  });
  return calls;
}

/** Requests the browser makes to Supabase's REST API for a table. */
export function trackRest(page: Page, table: string): Request[] {
  const calls: Request[] = [];
  page.on("request", (request) => {
    if (request.url().includes(`/rest/v1/${table}`)) calls.push(request);
  });
  return calls;
}

export const css = (locator: Locator, property: string) =>
  locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

/** The id of the bio a draft or version carries, for readable assertions. */
export const bioOf = (doc: unknown): string => (doc as { profile: { bio: string } }).profile.bio;
