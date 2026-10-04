import AxeBuilder from "@axe-core/playwright";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminClient, supabaseUrl } from "../fixtures/auth";
import { uploadImage } from "../m2/blocks-helpers";
import { SYSTEM_IDS } from "../m6/themes-helpers";
import { dialogOf, emptyPageUser, pageRow, setDraft, type DraftDoc } from "../m6/templates-helpers";
import { describeTemplate as insideLine, type Template } from "@/lib/templates";

/**
 * Shared setup for the M7 template specs (M7-07 the picker's previews, M7-08 the style choice).
 * Everything of the M6 template helpers is here too (`applyTemplateChoice`, `choiceOf`, `cardOf`,
 * `templateButton`, ...); every spec makes its own user and never touches mara's rows.
 */

export * from "../m6/templates-helpers";
export { SYSTEM_IDS, insideLine };

export type Shape = "blank" | "blocks" | "theme" | "overrides" | "both";

/** The six pages the default style has to be right for (M7-08 step 2), keyed by what they hold. */
export const SHAPE_DEFAULTS: Record<Shape, "template" | "keep"> = {
  blank: "template",
  blocks: "template",
  theme: "keep",
  overrides: "keep",
  both: "keep",
};

/** A draft of the given shape on top of the one the page has (name, photo and options stay). */
export function shapedDraft(base: DraftDoc, shape: Shape): DraftDoc {
  const blocks: DraftDoc["blocks"] =
    shape === "blank"
      ? []
      : [
          { id: "Zq7HeaderOne1", type: "header", visible: true, text: "My own header" },
          {
            id: "Zq7LinkOne001",
            type: "link",
            visible: true,
            label: "My own link",
            url: "https://example.com/mine",
          },
        ];
  const theme: DraftDoc["theme"] =
    shape === "theme"
      ? { ref: SYSTEM_IDS.Ivory, overrides: {} }
      : shape === "overrides"
        ? { ref: null, overrides: { accent: "#C46A4F", radius: 20 } }
        : shape === "both"
          ? { ref: SYSTEM_IDS.Noir, overrides: { accent: "#C46A4F", radius: 20 } }
          : { ref: null, overrides: {} };
  return { ...base, blocks, theme, profile: { ...base.profile, bio: "" } };
}

/** A user whose empty page is then given a shape. */
export async function shapedUser(context: BrowserContext, label: string, shape: Shape) {
  const user = await emptyPageUser(context, label);
  const row = await pageRow(user.pageId);
  const draft = shapedDraft(row.draft, shape);
  await setDraft(user.pageId, draft);
  return { ...user, before: draft };
}

/**
 * A page with everything an apply must never lose: a block with an uploaded image, a background
 * image in its theme, page-level overrides, a share card, a photo of its own and a saved theme row
 * is added by the caller. Returns the stored draft.
 */
export async function richUser(context: BrowserContext, label: string) {
  const user = await emptyPageUser(context, label);
  const photo = await uploadImage(user.id, 96, 96, [60, 90, 200]);
  const cardImage = await uploadImage(user.id, 120, 80, [200, 80, 60]);
  const background = await uploadImage(user.id, 200, 300, [30, 60, 90]);
  const row = await pageRow(user.pageId);
  const draft: DraftDoc = {
    ...row.draft,
    profile: { ...row.draft.profile, name: "Rich Page", bio: "My own words.", photo },
    share: { title: "Share title", description: "Share description" },
    theme: {
      ref: SYSTEM_IDS.Noir,
      overrides: {
        accent: "#C46A4F",
        bgType: "image",
        bgImage: `${supabaseUrl()}/storage/v1/object/public/page-media/${background.path}`,
      },
    },
    blocks: [
      { id: "Zq7HeaderTwo1", type: "header", visible: true, text: "Hello" },
      {
        id: "Zq7CardImage01",
        type: "card",
        visible: true,
        title: "With a picture",
        caption: "",
        url: "https://example.com/pic",
        image: cardImage,
      },
    ],
  };
  await setDraft(user.pageId, draft);
  return {
    ...user,
    before: (await pageRow(user.pageId)).draft,
    images: { photo, cardImage, background },
  };
}

/** The preview box of one card, and the page root drawn in it (once the card is near the viewport). */
export const previewOf = (page: Page, name: string): Locator =>
  dialogOf(page)
    .locator(`[data-template-id="${name.toLowerCase()}"]`)
    .getByTestId("template-preview");

export const previewRootOf = (page: Page, name: string): Locator =>
  previewOf(page, name).locator("[data-page-root]");

/** Scrolls a card into view inside the dialog and waits for its picture to be drawn. */
export async function drawn(page: Page, name: string): Promise<Locator> {
  await previewOf(page, name).scrollIntoViewIfNeeded();
  const root = previewRootOf(page, name);
  await expect(root).toBeAttached();
  return root;
}

/** The six system themes' stored tokens, by theme id (what the previews must be drawn in). */
export async function templateThemeTokens(): Promise<Map<string, Record<string, unknown>>> {
  const { data, error } = await adminClient()
    .from("themes")
    .select("id, tokens")
    .is("owner_id", null);
  if (error) throw new Error(`reading system themes failed: ${error.message}`);
  return new Map(data.map((row) => [row.id as string, row.tokens as Record<string, unknown>]));
}

/** Serious and critical axe violations inside the dialog only. */
export async function dialogAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include("[data-testid=template-dialog]").analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => String(n.target)).join(" | ")}`);
}

export const rect = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return box;
};

export const insideOf = (template: Template): string => `Inside: ${insideLine(template)}`;
