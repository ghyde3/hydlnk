import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Block, DraftDoc } from "@/lib/document";
import { rowOf } from "../m2/blocks-helpers";
import { pageRow, previewScreen, statusChip } from "../m2/editor-helpers";
import { halves, userWithBlocks } from "./images-helpers";

/**
 * Shared setup for the block style specs (M6-45, M6-46): a page with two blocks of every type, the
 * first of each pair carrying every override its type reads and the second none, so a test can
 * check both what the override does and that the sibling is unchanged. Users are made fresh per
 * test (the phone and desktop projects run at once), and the page is the user's own, never mara's.
 */

export const COLOR = "#C46A4F";
export const RGB = "rgb(196, 106, 79)";

/** The system default theme (a page with no theme): what a block without overrides shows. */
export const DEFAULT = {
  text: "rgb(26, 26, 26)",
  textMuted: "rgb(107, 107, 102)",
  border: "rgb(226, 226, 221)",
  accent: "rgb(59, 91, 219)",
  radius: "12px",
  borderWidth: "1px",
};

/** The ten keys of one block, with #C46A4F on each color key, 20 on radius and 2 on borderWidth. */
export const STYLE = {
  accent: COLOR,
  buttonBg: COLOR,
  buttonText: COLOR,
  text: COLOR,
  textMuted: COLOR,
  surface: COLOR,
  border: COLOR,
  radius: 20,
  borderWidth: 2,
};

/** Ids (8 to 24 characters of letters, digits, _ and -) of the styled block ("a") and its sibling ("b"). */
export const ID = {
  header: { a: "styleheadera01", b: "styleheaderb02" },
  text: { a: "styletexta0001", b: "styletextb0002" },
  image: { a: "styleimagea001", b: "styleimageb002" },
  embed: { a: "styleembeda001", b: "styleembedb002" },
  spotify: { a: "stylespotifya1", b: "stylespotifyb2" },
  grid: { a: "stylegrida0001", b: "stylegridb0002" },
  social: { a: "stylesociala01", b: "stylesocialb02" },
  divider: { a: "styledividera1", b: "styledividerb2" },
  link: { a: "stylelinka0001", b: "stylelinkb0002" },
  card: { a: "stylecarda0001", b: "stylecardb0002" },
} as const;

/** A third image, styled like the others, with a shape and a link (its frame and its anchor). */
export const SHAPED_ID = "styleshapedimg1";

export type Pair = keyof typeof ID;
/** Display order on the page. */
export const PAIRS: Pair[] = [
  "header",
  "text",
  "image",
  "embed",
  "spotify",
  "grid",
  "social",
  "divider",
  "link",
  "card",
];

const YOUTUBE = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const SPOTIFY = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";

type Raw = Record<string, unknown>;

/** The styled and the plain copy of each block type, in page order (a then b of each pair). */
export function styleBlocks(image: Raw): Block[] {
  const common = { visible: true };
  const make = (pair: Pair, which: "a" | "b", body: Raw): Block => {
    const overrides =
      which === "a"
        ? {
            // A link's own Color writes buttonBg with its ink; the all-keys set is the spec's.
            overrides: pair === "link" ? { ...STYLE, buttonStyle: "fill" } : STYLE,
          }
        : {};
    return { id: ID[pair][which], ...common, ...body, ...overrides } as unknown as Block;
  };
  const both = (pair: Pair, body: (which: "a" | "b") => Raw): Block[] => [
    make(pair, "a", body("a")),
    make(pair, "b", body("b")),
  ];
  return [
    ...both("header", (w) => ({ type: "header", text: `Heading ${w}` })),
    ...both("text", (w) => ({ type: "text", text: `Paragraph ${w}` })),
    ...both("image", (w) => ({ type: "image", image, alt: `Picture ${w}`, url: "" })),
    ...both("embed", (w) => ({ type: "embed", url: YOUTUBE, caption: `Video ${w}` })),
    ...both("spotify", (w) => ({ type: "embed", url: SPOTIFY, caption: `Track ${w}` })),
    ...both("grid", (w) => ({
      type: "grid",
      cells: [
        {
          id: `cell${w}0000001`,
          title: `Cell ${w} one`,
          subtitle: "First",
          url: "https://example.com/1",
        },
        {
          id: `cell${w}0000002`,
          title: `Cell ${w} two`,
          subtitle: "Second",
          url: "https://example.com/2",
        },
      ],
    })),
    ...both("social", (w) => ({
      type: "social",
      icons: [
        { id: `icon${w}0000001`, platform: "instagram", url: "https://instagram.com/mara" },
        { id: `icon${w}0000002`, platform: "github", url: "https://github.com/mara" },
      ],
    })),
    ...both("divider", () => ({ type: "divider" })),
    ...both("link", (w) => ({
      type: "link",
      label: `Book ${w}`,
      url: "https://example.com/book",
    })),
    ...both("card", (w) => ({
      type: "card",
      title: `Card ${w}`,
      caption: "View the gallery",
      url: "https://example.com/market",
      image: null,
    })),
    {
      id: SHAPED_ID,
      visible: true,
      type: "image",
      image,
      shape: "square",
      alt: "A shaped picture",
      url: "https://example.com/shaped",
      overrides: STYLE,
    } as unknown as Block,
  ];
}

/** A signed-in user whose draft holds `styleBlocks` (the picture is a real upload of the user's own). */
export async function styledUser(
  context: BrowserContext,
  label: string,
  opts: { plan?: "free" | "pro" | "studio" } = {},
) {
  return userWithBlocks(
    context,
    label,
    async ({ upload }) => styleBlocks(await upload(await halves(400, 300))),
    opts,
  );
}

/** The same blocks with no overrides on any of them: what the editor specs start from. */
export function plainBlocks(image: Raw): Block[] {
  return styleBlocks(image).map((block) => {
    const { overrides: _overrides, ...rest } = block as unknown as Raw;
    void _overrides;
    return rest as unknown as Block;
  });
}

/** A signed-in user whose draft holds `plainBlocks`. */
export async function plainUser(
  context: BrowserContext,
  label: string,
  opts: { plan?: "free" | "pro" | "studio" } = {},
) {
  return userWithBlocks(
    context,
    label,
    async ({ upload }) => plainBlocks(await upload(await halves(400, 300))),
    opts,
  );
}

/** Clicks Publish in the editor and waits for the status chip to read Published. */
export async function publishViaEditor(page: Page): Promise<void> {
  await page
    .getByTestId("workspace-toolbar")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(statusChip(page)).toHaveAttribute("data-publish-status", "published", {
    timeout: 30_000,
  });
}

/**
 * The computed styles that show what a block's overrides did, read in the page (the live page, or
 * the editor's preview when `scope` is the preview screen). One entry per block of a pair.
 */
export interface Look {
  header: { color: string };
  text: { color: string };
  image: Border;
  embed: Border;
  spotify: Border;
  cell: Border & { textColor: string; titleColor: string; height: number };
  social: { color: string; borderColor: string; width: number; height: number };
  divider: { background: string };
  link: { background: string; borderColor: string; color: string; radius: string };
  card: { titleColor: string; borderColor: string; radius: string };
}
interface Border {
  width: string;
  style: string;
  color: string;
  radius: string;
}

export async function looksOf(scope: Locator, which: "a" | "b"): Promise<Look> {
  return scope.evaluate(
    (root, ids) => {
      const el = (selector: string): Element => {
        const found = root.querySelector(selector);
        if (!found) throw new Error(`missing ${selector}`);
        return found;
      };
      const cs = (node: Element) => getComputedStyle(node);
      const border = (node: Element) => ({
        width: cs(node).borderTopWidth,
        style: cs(node).borderTopStyle,
        color: cs(node).borderTopColor,
        radius: cs(node).borderTopLeftRadius,
      });
      const block = (id: string) => `[data-block-id="${id}"]`;
      const cell = el(`${block(ids.grid)} .pg-cell`);
      const icon = el(`${block(ids.social)} .pg-social-link`);
      const link = el(block(ids.link));
      return {
        header: { color: cs(el(block(ids.header))).color },
        text: { color: cs(el(block(ids.text))).color },
        image: border(el(`${block(ids.image)} img`)),
        embed: border(el(`${block(ids.embed)} .pg-embed-play`)),
        spotify: border(el(`${block(ids.spotify)} .pg-embed-spotify`)),
        cell: {
          ...border(cell),
          textColor: cs(cell).color,
          titleColor: cs(el(`${block(ids.grid)} .pg-cell-title`)).color,
          height: cell.getBoundingClientRect().height,
        },
        social: {
          color: cs(icon).color,
          borderColor: cs(icon).borderTopColor,
          width: icon.getBoundingClientRect().width,
          height: icon.getBoundingClientRect().height,
        },
        divider: { background: cs(el(block(ids.divider))).backgroundColor },
        link: {
          background: cs(link).backgroundColor,
          borderColor: cs(link).borderTopColor,
          color: cs(link).color,
          radius: cs(link).borderTopLeftRadius,
        },
        card: {
          titleColor: cs(el(`${block(ids.card)} .pg-card-title`)).color,
          borderColor: cs(el(block(ids.card))).borderTopColor,
          radius: cs(el(block(ids.card))).borderTopLeftRadius,
        },
      };
    },
    Object.fromEntries(PAIRS.map((pair) => [pair, ID[pair][which]])) as Record<Pair, string>,
  );
}

/** What the styled blocks must show (#C46A4F on each color key, 20 on radius, 2 on borderWidth). */
export const STYLED_LOOK: Look = {
  header: { color: RGB },
  text: { color: RGB },
  image: { width: "2px", style: "solid", color: RGB, radius: "20px" },
  embed: { width: "2px", style: "solid", color: RGB, radius: "20px" },
  spotify: { width: "2px", style: "solid", color: RGB, radius: "20px" },
  cell: {
    width: "2px",
    style: "solid",
    color: RGB,
    radius: "20px",
    textColor: RGB,
    titleColor: RGB,
    height: 0,
  },
  social: { color: RGB, borderColor: RGB, width: 44, height: 44 },
  divider: { background: RGB },
  link: { background: RGB, borderColor: RGB, color: RGB, radius: "20px" },
  card: { titleColor: RGB, borderColor: RGB, radius: "20px" },
};

/** What the plain siblings must show: the theme as it was (the system default), unchanged. */
export const PLAIN_LOOK: Look = {
  header: { color: DEFAULT.text },
  text: { color: DEFAULT.textMuted },
  // An image has no border until it sets a thickness: its default look does not change.
  image: { width: "0px", style: "none", color: DEFAULT.text, radius: DEFAULT.radius },
  embed: {
    width: DEFAULT.borderWidth,
    style: "solid",
    color: DEFAULT.border,
    radius: DEFAULT.radius,
  },
  spotify: {
    width: DEFAULT.borderWidth,
    style: "solid",
    color: DEFAULT.border,
    radius: DEFAULT.radius,
  },
  cell: {
    width: DEFAULT.borderWidth,
    style: "solid",
    color: DEFAULT.border,
    radius: DEFAULT.radius,
    textColor: DEFAULT.text,
    titleColor: DEFAULT.text,
    height: 0,
  },
  social: { color: DEFAULT.text, borderColor: DEFAULT.border, width: 44, height: 44 },
  divider: { background: DEFAULT.border },
  link: {
    background: "rgb(26, 26, 26)",
    borderColor: "rgb(26, 26, 26)",
    color: "rgb(255, 255, 255)",
    radius: DEFAULT.radius,
  },
  card: { titleColor: DEFAULT.accent, borderColor: DEFAULT.border, radius: DEFAULT.radius },
};

/** `look` without the measured sizes (they depend on the viewport), for an exact comparison of styles. */
export function styles(look: Look): unknown {
  const copy = JSON.parse(JSON.stringify(look)) as Look;
  copy.cell.height = 0;
  copy.social.width = 0;
  copy.social.height = 0;
  return copy;
}

/** The block with this id on a page or in the preview. */
export const blockIn = (scope: Page | Locator, id: string): Locator =>
  scope.locator(`[data-block-id="${id}"]`);

/** The overrides of one block in the stored draft, or null when the property is absent. */
export async function storedOverrides(pageId: string, id: string): Promise<unknown> {
  const draft = (await pageRow(pageId)).draft as DraftDoc;
  const block = draft.blocks.find((b) => b.id === id) as { overrides?: unknown } | undefined;
  return block && "overrides" in block ? block.overrides : null;
}

/** Waits until the stored draft's block has exactly these overrides (jsonb keeps no key order). */
export async function expectStored(pageId: string, id: string, expected: unknown): Promise<void> {
  await expect
    .poll(async () => storedOverrides(pageId, id), {
      message: `the stored overrides of ${id}`,
      timeout: 15_000,
    })
    .toEqual(expected);
}

export { previewScreen, rowOf };
