import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { expectNoHorizontalScroll, expectTapTargets } from "../helpers";
import {
  expectDraft,
  openEditor,
  pageRow,
  saveIndicator,
  setDraft,
  seededUser,
  emptyUser,
  type DraftDoc,
} from "../m2/editor-helpers";
import { TEMPLATES, type Template } from "@/lib/templates";

export * from "../m2/editor-helpers";
export { expectNoHorizontalScroll, expectTapTargets };

/**
 * Shared setup for the template specs (M6-40). Every spec makes its own user (the phone and
 * desktop projects run at once, and two contexts autosaving one draft would trip the stale-tab
 * guard); mara's rows are never touched.
 */

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 760;

export const TEMPLATE_NAMES = TEMPLATES.map((template) => template.name);
export const templateOf = (name: string): Template => TEMPLATES.find((t) => t.name === name)!;

/** The "Start from a template" button of the "Add a block" card. */
export const startButton = (page: Page): Locator => page.getByTestId("start-from-template");

export const dialogOf = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Start from a template" });

export const templateButton = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `Use the ${name} template`, exact: true });

export const cardOf = (page: Page, name: string): Locator =>
  dialogOf(page).locator("li[data-template-id]", {
    has: page.getByRole("heading", { level: 3, name, exact: true }),
  });

/** The toast of an apply, and its Undo. */
export const toastOf = (page: Page): Locator => page.getByTestId("template-toast");
export const toastUndo = (page: Page): Locator => page.getByTestId("template-undo");

export const blocksHeading = (page: Page, count: number): Locator =>
  page.getByRole("heading", { level: 2, name: `Blocks · ${count}` });

/** M7-08: the choice a card asks in place after "Use this template" (it replaced the M6-40 confirmation). */
export const choiceOf = (page: Page, name: string): Locator =>
  dialogOf(page).getByRole("group", { name: `Apply the ${name} template`, exact: true });

/**
 * M7-08: presses "Use this template" on a card, picks a style when one is given (otherwise the
 * default the page earns), and presses "Apply template". "template" is the template's blocks and
 * style (what M6-40 applied); "keep" is the blocks only.
 */
export async function applyTemplateChoice(
  page: Page,
  name: string,
  style?: "template" | "keep",
): Promise<void> {
  await templateButton(page, name).click();
  const panel = choiceOf(page, name);
  await expect(panel).toBeVisible();
  if (style) await panel.locator(`[data-style-option="${style}"] input`).check();
  await panel.getByRole("button", { name: "Apply template", exact: true }).click();
}

export async function openDialog(page: Page): Promise<void> {
  await startButton(page).click();
  await expect(dialogOf(page)).toBeVisible();
}

/** A user whose page is empty: no blocks, no theme, no overrides (what signup creates). */
export async function emptyPageUser(
  context: BrowserContext,
  label: string,
  plan: "free" | "pro" | "studio" = "free",
) {
  return emptyUser(context, label, { plan });
}

/**
 * A user with a published page (a copy of mara's: Noir, blocks) whose draft is then emptied: no
 * blocks, no theme, no overrides, no bio. The live page keeps the published content.
 */
export async function publishedUserWithEmptyDraft(context: BrowserContext, label: string) {
  const user = await seededUser(context, label);
  const row = await pageRow(user.pageId);
  const draft: DraftDoc = {
    ...row.draft,
    profile: { ...row.draft.profile, bio: "" },
    theme: { ref: null, overrides: {} },
    blocks: [],
  };
  await setDraft(user.pageId, draft);
  return { ...user, before: draft };
}

/** The block texts of a draft in order, one string each, for comparing against a template. */
export function describeBlocks(blocks: DraftDoc["blocks"]): string[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "header":
      case "text":
        return `${block.type}:${block.text}`;
      case "link":
        return `link:${block.label}`;
      case "card":
        return `card:${block.title}|${block.caption}`;
      case "image":
        return `image:${block.alt}`;
      case "embed":
        return `embed:${block.caption}`;
      case "grid":
        return `grid:${block.cells.map((cell) => `${cell.title}/${cell.subtitle}`).join(",")}`;
      case "social":
        return `social:${block.icons.map((icon) => icon.platform).join(",")}`;
      case "divider":
        return "divider";
      case "faq":
        return `faq:${block.items.map((item) => item.question).join(",")}`;
      case "contact":
        return `contact:${block.name}`;
      case "discount":
        return `discount:${block.code}`;
      case "book":
        return `book:${block.title}`;
      case "apps":
        return `apps:${block.links.map((link) => link.store).join(",")}`;
      case "map":
        return `map:${block.name}`;
      case "page_link":
        return `page_link:${block.label}`;
    }
  });
}

export const describeTemplate = (template: Template): string[] =>
  describeBlocks(
    template.blocks.map((block): DraftDoc["blocks"][number] => {
      switch (block.type) {
        case "header":
          return { id: "x", type: "header", visible: true, text: block.text };
        case "text":
          return { id: "x", type: "text", visible: true, text: block.text };
        case "link":
          return { id: "x", type: "link", visible: true, label: block.label, url: "" };
        case "card":
          return {
            id: "x",
            type: "card",
            visible: true,
            title: block.title,
            caption: block.caption,
            url: "",
            image: null,
          };
        case "image":
          return { id: "x", type: "image", visible: true, image: null, alt: block.alt, url: "" };
        case "embed":
          return { id: "x", type: "embed", visible: true, url: "", caption: block.caption };
        case "grid":
          return {
            id: "x",
            type: "grid",
            visible: true,
            cells: block.cells.map((c) => ({
              id: "y",
              title: c.title,
              subtitle: c.subtitle,
              url: "",
            })),
          };
        case "social":
          return {
            id: "x",
            type: "social",
            visible: true,
            icons: block.platforms.map((platform) =>
              platform === "email"
                ? { id: "z", platform, address: "" }
                : { id: "z", platform, url: "" },
            ),
          };
      }
    }),
  );

/** The draft PATCHes (writes to /rest/v1/pages) a page makes from now on, and every other write. */
export function watchWrites(page: Page): {
  patches: { body: Record<string, unknown>; url: string }[];
  others: string[];
  serverActions: string[];
} {
  const patches: { body: Record<string, unknown>; url: string }[] = [];
  const others: string[] = [];
  const serverActions: string[] = [];
  page.on("request", (request) => {
    const target = request.url();
    if (request.headers()["next-action"] !== undefined) serverActions.push(target);
    if (request.method() === "GET" || request.method() === "HEAD" || request.method() === "OPTIONS")
      return;
    if (request.method() === "PATCH" && target.includes("/rest/v1/pages")) {
      patches.push({
        body: JSON.parse(request.postData() ?? "{}") as Record<string, unknown>,
        url: target,
      });
      return;
    }
    others.push(`${request.method()} ${target}`);
  });
  return { patches, others, serverActions };
}

export async function userThemeRows(userId: string) {
  const { data, error } = await adminClient()
    .from("themes")
    .select("id, name, tokens")
    .eq("owner_id", userId)
    .order("name");
  if (error) throw new Error(`reading themes failed: ${error.message}`);
  return data;
}

/**
 * The status chip and the Publish button as the person sees them: the workspace toolbar (M7-05)
 * keeps one of each per layout, so these take the visible one instead of assuming there is only one.
 */
export const statusChip = (page: Page): Locator =>
  page.locator("[data-publish-status]:visible").first();
export const publishButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Publish", exact: true }).first();

export { expectDraft, openEditor, pageRow, saveIndicator, setDraft };
