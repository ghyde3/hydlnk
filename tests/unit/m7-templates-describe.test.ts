import { describe, expect, it } from "vitest";
import { TEMPLATES, describeTemplate, type Template } from "@/lib/templates";

/**
 * M7-07, the "Inside" line of a template card: the count of blocks, then each block type in the
 * order it first appears, with its count when above one. Pure and derived from the catalog.
 */

const byName = (name: string): Template => TEMPLATES.find((template) => template.name === name)!;

describe("M7-07 describeTemplate", () => {
  it("gives the line of the spec for all six templates", () => {
    expect(TEMPLATES.map((template) => [template.name, describeTemplate(template)])).toEqual([
      ["Musician", "6 blocks: header, embed, 2 links, card, social"],
      ["Podcaster", "8 blocks: header, 4 links, embed, text, social"],
      ["Artist", "6 blocks: image, header, grid, link, text, social"],
      ["Shop", "7 blocks: header, card, grid, 2 links, text, social"],
      ["Coach", "6 blocks: text, 2 links, card, embed, social"],
      ["Streamer", "5 blocks: 3 links, grid, social"],
    ]);
  });

  it("counts every block: the number up front is the number of blocks of the template", () => {
    for (const template of TEMPLATES) {
      expect(describeTemplate(template)).toMatch(new RegExp(`^${template.blocks.length} blocks: `));
    }
  });

  it("adds an s above one, except for text and social, which never change", () => {
    const template: Template = {
      ...byName("Musician"),
      blocks: [
        { type: "header", text: "a" },
        { type: "header", text: "b" },
        { type: "card", title: "a", caption: "" },
        { type: "card", title: "b", caption: "" },
        { type: "embed", caption: "" },
        { type: "embed", caption: "" },
        { type: "grid", cells: [] },
        { type: "grid", cells: [] },
        { type: "image", alt: "" },
        { type: "image", alt: "" },
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "social", platforms: ["x"] },
        { type: "social", platforms: ["x"] },
      ],
    };
    expect(describeTemplate(template)).toBe(
      "14 blocks: 2 headers, 2 cards, 2 embeds, 2 grids, 2 images, 2 text, 2 social",
    );
  });

  it("follows the catalog: a changed template changes its line and nothing else needs an edit", () => {
    const musician = byName("Musician");
    const changed: Template = {
      ...musician,
      blocks: [...musician.blocks, { type: "link", label: "More" }, { type: "divider" } as never],
    };
    // A fourth link and a block of a type the line has not seen yet.
    expect(describeTemplate(changed)).toBe(
      "8 blocks: header, embed, 3 links, card, social, divider",
    );
    expect(describeTemplate(musician)).toBe("6 blocks: header, embed, 2 links, card, social");
  });

  it("says one block and no blocks in words", () => {
    const one: Template = { ...byName("Shop"), blocks: [{ type: "link", label: "x" }] };
    expect(describeTemplate(one)).toBe("1 block: link");
    expect(describeTemplate({ ...one, blocks: [] })).toBe("No blocks");
  });

  it("does not read anything but the blocks (the same call twice gives the same words)", () => {
    for (const template of TEMPLATES) {
      expect(describeTemplate(template)).toBe(describeTemplate({ ...template }));
    }
  });
});
