import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BlockTypeChips } from "@/components/editor/block-type-chips";
import { blockRowSummary } from "@/components/blocks/summary";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BlockView } from "@/components/page/blocks";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import {
  BLOCK_TYPES,
  BLOCK_TYPE_LABELS,
  blockDefaults,
  draftDocSchema,
  toPublishForm,
  type Block,
} from "@/lib/document";
import { STYLE_SPECS, styleSpecOf } from "@/lib/themes";
import { STYLED_BLOCK_TYPES } from "@/lib/tenant-assets/css";
import { describeTemplate } from "@/lib/templates/describe";
import type { Template } from "@/lib/templates/catalog";
import { draftWith, noirTokens } from "./fixtures/page-document";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

/**
 * M9-15: the per-type tables are complete. Every entry of `BLOCK_TYPES` must have a label, a chip, a
 * default, a Publish form case, a style spec, a row summary, a form, a stylesheet family, a plural
 * word in a template's description and a place in the renderer. Each Wave K block can land alone, so
 * the order of the list is checked against the full order cut to the types that exist so far.
 */

const FORMS_SOURCE = readFileSync(
  join(process.cwd(), "src/components/blocks/forms/index.ts"),
  "utf8",
);

const ORIGINAL_NINE = [
  "link",
  "card",
  "header",
  "text",
  "image",
  "social",
  "embed",
  "grid",
  "divider",
];
const WAVE_K = ["faq", "contact", "discount", "book", "apps", "map"];
const WAVE_M = ["page_link"];
const FULL_ORDER = [...ORIGINAL_NINE, ...WAVE_K, ...WAVE_M];
/**
 * Types whose document layer exists but whose renderer, editor form, stylesheet family or add-block
 * chip is not built yet; an entry turns the checks below off for the type. Empty since M11-07 landed
 * the page link's form, chip and renderer.
 */
const PENDING_UI = new Set<string>();
const PLURALS: Record<string, string> = {
  faq: "faqs",
  contact: "contacts",
  discount: "discounts",
  book: "books",
  apps: "apps",
  map: "maps",
};

describe("M9-15 the list of block types", () => {
  it("is the nine originals in their order, then the Wave K types in theirs, cut to the ones that exist", () => {
    expect(BLOCK_TYPES.length).toBeGreaterThanOrEqual(9);
    expect([...BLOCK_TYPES]).toEqual(FULL_ORDER.slice(0, BLOCK_TYPES.length));
  });
});

describe.each([...BLOCK_TYPES])(
  "M9-15 the %s block has an entry in every per-type table",
  (type) => {
    it("label, default, form, style spec and stylesheet family", () => {
      expect(BLOCK_TYPE_LABELS[type]).toMatch(/\S/);
      const block = blockDefaults[type]();
      expect(block.type).toBe(type);
      expect(block.visible).toBe(true);
      expect(draftDocSchema.safeParse(draftWith(block)).success).toBe(true);
      // The forms module pulls in the whole editor, so its table is read as text: `faq: FaqForm,`.
      expect(STYLE_SPECS[type].controls).toContain("color");
      expect(styleSpecOf(block)).toBe(STYLE_SPECS[type]);
      if (PENDING_UI.has(type)) return;
      expect(FORMS_SOURCE).toMatch(new RegExp(`^\\s+${type}: [A-Za-z]+Form,$`, "m"));
      expect(STYLED_BLOCK_TYPES).toContain(type);
    });

    it("the Publish form keeps it (the case exists), and the row summary names it", () => {
      const block = blockDefaults[type]();
      const form = toPublishForm(draftDocSchema.parse(draftWith(block)), noirTokens);
      expect(form.blocks.map((b: Block) => b.type)).toEqual([type]);
      const summary = blockRowSummary(block);
      expect(summary.typeLabel).toBe(BLOCK_TYPE_LABELS[type]);
      expect(summary.title).toMatch(/\S/);
    });

    it("the renderer draws it (a new, empty block still has markup in the preview)", () => {
      if (PENDING_UI.has(type)) return;
      const block = blockDefaults[type]();
      const html = renderToStaticMarkup(
        createElement(BlockView, {
          block,
          ctx: {
            pageId: "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01",
            tokens: noirTokens as never,
            mode: "preview",
          },
        }),
      );
      expect(html).toContain(`data-block-type="${type}"`);
    });

    it("a template's description counts it with a plural word", () => {
      const template = {
        blocks: [{ type }, { type }],
      } as unknown as Template;
      const expected = type === "text" || type === "social" ? type : (PLURALS[type] ?? `${type}s`);
      expect(describeTemplate(template)).toBe(`2 blocks: 2 ${expected}`);
    });
  },
);

describe("M9-15 the add-block chips and the analytics labels", () => {
  it("one chip per type, in the order of BLOCK_TYPES, each with its label", () => {
    const markup = renderToStaticMarkup(createElement(BlockTypeChips, { onPick: () => undefined }));
    const buttons = markup.split("<button").slice(1);
    const chipTypes = BLOCK_TYPES.filter((type) => !PENDING_UI.has(type));
    expect(buttons).toHaveLength(chipTypes.length);
    chipTypes.forEach((type, index) => {
      expect(buttons[index]).toContain(`>${BLOCK_TYPE_LABELS[type].replace("&", "&amp;")}</button`);
    });
  });

  it("'Clicks by link' has a label for the clickable types it knows, and never throws for any type", () => {
    const published = {
      blocks: BLOCK_TYPES.map((type, index) => ({
        ...blockDefaults[type](),
        id: `block-${String(index).padStart(2, "0")}-aaaa`,
      })),
    };
    expect(() => linkLabelsFromPublished(published)).not.toThrow();
    const labels = linkLabelsFromPublished({
      blocks: [
        {
          id: "contact-blk-0001",
          type: "contact",
          name: "Mara",
          phone: "5551234",
          email: "",
          hours: "",
        },
        {
          id: "discount-blk-001",
          type: "discount",
          code: "SAVE10",
          description: "",
          url: "https://x.example",
        },
      ],
    });
    expect(labels.get("contact-blk-0001")).toBe("Save contact: Mara");
    expect(labels.get("discount-blk-001")).toBe("Discount SAVE10");
  });
});
