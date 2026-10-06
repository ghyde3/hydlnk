import { expect, type Locator, type Page } from "@playwright/test";
import { computed, previewRoot, showPreview, showTokens } from "../m3/design-helpers";

export {
  DESIGN_URL,
  computed,
  expectOverrides,
  isPhone,
  openDesign,
  previewRoot,
  previewScreen,
  publishFromEditor,
  reloadDesign,
  saveStatus,
  setOverrides,
  showPreview,
  showTokens,
} from "../m3/design-helpers";

/**
 * Helpers of the Milestone 6 Design specs (the five groups, M6-47, and the gradient, M6-41 and
 * M6-42). The screen's own helpers stay in ../m3/design-helpers; these only add what the new
 * markup needs.
 */

/** One of the five style cards: color, fonts, buttons, layout or background. */
export const card = (page: Page, name: string): Locator =>
  page.locator(`[data-design-section="${name}"]`);

/** A segmented control or other labeled group, by its accessible name. */
export const group = (page: Page, label: string): Locator =>
  page.locator(`[role="group"][aria-label="${label}"]`);

export const option = (page: Page, label: string, name: string): Locator =>
  group(page, label).getByRole("button", { name, exact: true });

export const gradientPanel = (page: Page): Locator => page.getByTestId("gradient-panel");

/** The Background group's own buttons: Solid, Gradient, Image... */
export const background = (page: Page, name: "Solid" | "Gradient" | "Image…"): Locator =>
  group(page, "Background").getByRole("button", { name, exact: true });

/** Chooses Gradient in the Background group and waits for the panel. */
export async function chooseGradient(page: Page): Promise<void> {
  await background(page, "Gradient").click();
  await expect(gradientPanel(page)).toBeVisible();
}

/** The value of a `--t-*` variable on the preview's page root, read from the tab that shows it. */
export async function previewVar(page: Page, name: string): Promise<string> {
  await showPreview(page);
  const value = await computed(previewRoot(page), name);
  await showTokens(page);
  return value.trim();
}

/** The preview root's computed `background-image`, read from the tab that shows it. */
export async function previewBackground(page: Page): Promise<string> {
  await showPreview(page);
  const value = await computed(previewRoot(page), "background-image");
  await showTokens(page);
  return value;
}

/** The text a person can read or hear on the page: visible text, aria-label and title. */
export async function spokenText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const preview = main.querySelector('[data-testid="preview-screen"]');
    const out: string[] = [];
    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = (node.textContent ?? "").trim();
      if (!parent || text === "" || preview?.contains(parent) || !visible(parent)) continue;
      out.push(text);
    }
    for (const el of Array.from(main.querySelectorAll("[aria-label], [title]"))) {
      if (preview?.contains(el)) continue;
      for (const attribute of ["aria-label", "title"]) {
        const value = el.getAttribute(attribute);
        if (value) out.push(value);
      }
    }
    return out;
  });
}

/** The draft PATCHes the screen sends: every PostgREST write to `pages`. */
export function watchDraftWrites(page: Page): { bodies: () => unknown[]; count: () => number } {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() !== "PATCH" || !request.url().includes("/rest/v1/pages")) return;
    try {
      bodies.push(request.postDataJSON());
    } catch {
      bodies.push(request.postData());
    }
  });
  return { bodies: () => bodies, count: () => bodies.length };
}
