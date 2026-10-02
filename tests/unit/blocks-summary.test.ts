import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, blockDefaults, type Block } from "@/lib/document";
import { blockRowSummary } from "@/components/blocks/summary";
import { blocks } from "./fixtures/page-document";

describe("M2-11 blockRowSummary: titles and sub lines", () => {
  it("link: label and url", () => {
    expect(blockRowSummary(blocks.link)).toEqual({
      typeLabel: "Link",
      title: "Portrait sessions — fall dates",
      sub: "https://maraokafor.com/book/portraits",
    });
  });

  it("card: title and url", () => {
    expect(blockRowSummary(blocks.card)).toMatchObject({
      typeLabel: "Card",
      title: "Night Market",
      sub: "https://maraokafor.com/night-market",
    });
  });

  it("header: its text, no sub line", () => {
    expect(blockRowSummary(blocks.header)).toEqual({
      typeLabel: "Header",
      title: "Book a session",
      sub: "",
    });
  });

  it("text: the first 60 characters on one line", () => {
    const long: Block = { ...blocks.text, text: `${"a".repeat(50)}\n${"b".repeat(50)}` };
    const summary = blockRowSummary(long);
    expect(summary.typeLabel).toBe("Text");
    expect(summary.title).toBe(`${"a".repeat(50)} ${"b".repeat(9)}`);
    expect(Array.from(summary.title)).toHaveLength(60);
    expect(summary.sub).toBe("");
    expect(blockRowSummary({ ...blocks.text, text: "Short" }).title).toBe("Short");
  });

  it("text: cuts on code points, never inside an emoji", () => {
    const emoji: Block = { ...blocks.text, text: "😀".repeat(70) };
    expect(Array.from(blockRowSummary(emoji).title)).toHaveLength(60);
  });

  it("image: the alt text, or 'Image' without one; the optional link is the sub line", () => {
    expect(blockRowSummary(blocks.image)).toMatchObject({
      typeLabel: "Image",
      title: "The studio at golden hour",
      sub: "https://maraokafor.com/studio",
    });
    expect(blockRowSummary({ ...blocks.image, alt: "", url: "" })).toMatchObject({
      title: "Image",
      sub: "",
    });
  });

  it("social: platform names joined with ', ' and an icon count", () => {
    const social: Block = {
      ...blocks.social,
      icons: [
        { id: "icon-a-000001", platform: "instagram", url: "https://instagram.com/a" },
        { id: "icon-b-000001", platform: "tiktok", url: "https://tiktok.com/@a" },
        { id: "icon-c-000001", platform: "youtube", url: "https://youtube.com/@a" },
        { id: "icon-d-000001", platform: "email", address: "a@b.co" },
      ],
    };
    expect(blockRowSummary(social)).toEqual({
      typeLabel: "Social",
      title: "Instagram, TikTok, YouTube, Email",
      sub: "4 icons",
    });
  });

  it("social: one icon reads '1 icon'", () => {
    const one: Block = { ...blocks.social, icons: [blocks.social.icons[0]!] };
    expect(blockRowSummary(one)).toMatchObject({ title: "Instagram", sub: "1 icon" });
  });

  it("embed: caption and url", () => {
    expect(blockRowSummary(blocks.embed)).toEqual({
      typeLabel: "Embed",
      title: "Behind the lens, ep. 4",
      sub: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    });
  });

  it("grid: cell titles joined with ' · ' and a card count", () => {
    expect(blockRowSummary(blocks.grid)).toEqual({
      typeLabel: "Grid",
      title: "Prints · Workshops",
      sub: "2 cards",
    });
  });

  it("divider: 'Divider'", () => {
    expect(blockRowSummary(blocks.divider)).toEqual({
      typeLabel: "Divider",
      title: "Divider",
      sub: "",
    });
  });
});

describe("M2-11 blockRowSummary: unfinished blocks still have a name", () => {
  it("every freshly added block has a non-empty title and a type label", () => {
    for (const type of BLOCK_TYPES) {
      const summary = blockRowSummary(blockDefaults[type]());
      expect(summary.typeLabel).not.toBe("");
      expect(summary.title).not.toBe("");
    }
  });

  it("falls back to 'Untitled <type>' for an empty value", () => {
    expect(blockRowSummary({ ...blocks.link, label: "   " }).title).toBe("Untitled link");
    expect(blockRowSummary({ ...blocks.card, title: "" }).title).toBe("Untitled card");
    expect(blockRowSummary({ ...blocks.header, text: "" }).title).toBe("Untitled header");
    expect(blockRowSummary({ ...blocks.embed, caption: "" }).title).toBe("Untitled embed");
    const emptyGrid: Block = {
      ...blocks.grid,
      cells: [
        { id: "cell-a-000001", title: "", subtitle: "", url: "" },
        { id: "cell-b-000001", title: "", subtitle: "", url: "" },
      ],
    };
    expect(blockRowSummary(emptyGrid)).toMatchObject({ title: "Untitled grid", sub: "2 cards" });
  });

  it("never throws for an unknown type", () => {
    const unknown = { id: "unknown-blk-1", type: "carousel", visible: true } as unknown as Block;
    expect(blockRowSummary(unknown).title).toBe("Unknown block");
  });
});
