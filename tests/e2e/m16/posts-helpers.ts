import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { POSTS_TEST_IDS, POST_TEST_IDS } from "@/lib/blog/test-ids";
import { adminClient } from "../fixtures/auth";
import { url } from "../helpers";
import { emptyUser } from "../m2/editor-helpers";

/** Setup shared by the Posts specs (M16-02, M16-12 to M16-15): a user, their blog, posts and terms. */

export { POSTS_TEST_IDS, POST_TEST_IDS };
export const POSTS_URL = url("app", "/posts");
export const postUrl = (id: string) => url("app", `/posts/${id}`);

export async function postTypeId(siteId: string): Promise<string> {
  const type = await adminClient()
    .from("content_types")
    .select("id")
    .eq("site_id", siteId)
    .eq("key", "post")
    .single();
  if (type.error) throw new Error(type.error.message);
  return type.data.id as string;
}

/** Turn the site's blog on with the secret key (what "Add blog" does through the route). */
export async function enableBlog(siteId: string): Promise<string> {
  const admin = adminClient();
  const on = await admin
    .from("content_types")
    .update({ enabled: true })
    .eq("site_id", siteId)
    .eq("key", "post");
  if (on.error) throw new Error(on.error.message);
  return postTypeId(siteId);
}

/** A signed-in user whose one site has the blog on. */
export async function blogUser(
  context: BrowserContext,
  label: string,
  opts: { plan?: "free" | "pro" | "studio" } = {},
) {
  const user = await emptyUser(context, label, opts);
  const typeId = await enableBlog(user.pageId);
  return { ...user, typeId };
}

export async function seedPost(siteId: string, draft: Record<string, unknown>): Promise<string> {
  const made = await adminClient()
    .from("content_entries")
    .insert({ site_id: siteId, type_id: await postTypeId(siteId), draft: draft as never })
    .select("id")
    .single();
  if (made.error) throw new Error(made.error.message);
  return made.data.id as string;
}

export interface PostRow {
  rev: number;
  draft: Record<string, unknown> & {
    title?: string;
    slug?: string;
    body?: string;
    excerpt?: string;
    featuredImage?: { path: string } | null;
    seo?: { title?: string; description?: string; noindex?: boolean };
    terms?: { categories?: string[]; tags?: string[] };
  };
  published: (Record<string, unknown> & { title?: string; body?: string }) | null;
  deleted_at: string | null;
}

export async function postRow(id: string): Promise<PostRow> {
  const found = await adminClient()
    .from("content_entries")
    .select("rev, draft, published, deleted_at")
    .eq("id", id)
    .single();
  if (found.error) throw new Error(found.error.message);
  return { ...(found.data as unknown as PostRow), rev: Number(found.data.rev) };
}

export async function postsOf(siteId: string): Promise<Array<{ id: string }>> {
  const found = await adminClient()
    .from("content_entries")
    .select("id")
    .eq("site_id", siteId)
    .eq("type_id", await postTypeId(siteId));
  if (found.error) throw new Error(found.error.message);
  return found.data as Array<{ id: string }>;
}

/** Opens a post's editor and waits until it is interactive (the body editor mounts in the browser). */
export async function openPost(page: Page, id: string): Promise<void> {
  await page.goto(postUrl(id));
  await waitForPostEditor(page);
}

export async function waitForPostEditor(page: Page): Promise<void> {
  await expect(page.getByTestId("post-editor")).toBeVisible();
  await expect(
    page.getByTestId(POST_TEST_IDS.body).or(page.getByTestId(POST_TEST_IDS.bodySource)),
  ).toBeVisible();
  await page.waitForFunction(() => {
    const input = document.querySelector("[data-testid='post-title']");
    return !!input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
}

export const saveState = (page: Page): Locator => page.getByTestId(POST_TEST_IDS.saveState);

export async function expectSaved(page: Page): Promise<void> {
  await expect(saveState(page)).toHaveAttribute("data-save-state", "saved", { timeout: 15_000 });
}

/** Every button, link, field and select inside `root` is at least 44px tall (a checkbox sits in a 44px label). */
export async function expectTargets44(root: Locator): Promise<void> {
  const small = await root.evaluate((element) => {
    const found: string[] = [];
    const targets = element.querySelectorAll(
      "button, a, select, textarea, input:not([type=checkbox]):not([type=file]):not([type=hidden])",
    );
    for (const target of Array.from(targets)) {
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 43.5) {
        const name =
          target.getAttribute("data-testid") ??
          target.getAttribute("aria-label") ??
          (target.textContent ?? "").trim().slice(0, 30);
        found.push(`${target.tagName.toLowerCase()} "${name}" ${Math.round(rect.height)}px`);
      }
    }
    return found;
  });
  expect(small, `controls under 44px: ${small.join(", ")}`).toEqual([]);
}
