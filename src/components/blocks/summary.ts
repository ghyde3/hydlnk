import {
  BLOCK_TYPE_LABELS,
  SOCIAL_PLATFORM_LABELS,
  appStoreLabel,
  singleLine,
  truncateToCodePoints,
  type Block,
} from "@/lib/document";

/** What the block list row shows (M2-11): the type, a title and an optional second line. */
export interface BlockRowSummary {
  /** `Link`, `Card`, `Header`, `Text`, `Image`, `Social`, `Embed`, `Grid` or `Divider`. */
  typeLabel: string;
  /** The row title; never empty, so a half-filled block still has a name to tap. */
  title: string;
  /** The URL, `{n} cards` or `{n} icons`; empty when the block has nothing to add. */
  sub: string;
}

/** The first 60 characters of a text block make its title. */
const TEXT_TITLE_LENGTH = 60;

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A one-line value for a row: line breaks collapsed, trimmed; `fallback` when nothing is left. */
function line(value: string, fallback: string): string {
  const text = singleLine(value).trim();
  return text === "" ? fallback : text;
}

/**
 * The row summary of a block. The title derives from the content:
 * link label, card title, header text, the first 60 characters of a text block, the image's alt
 * text (or "Image"), the social platforms joined with ", ", the embed caption, the grid cell
 * titles joined with " · " and "Divider". An empty value falls back to "Untitled <type>", so a
 * block that is still being filled in is never a blank row.
 */
export function blockRowSummary(block: Block): BlockRowSummary {
  const typeLabel = BLOCK_TYPE_LABELS[block.type] ?? "Block";
  const untitled = `Untitled ${typeLabel.toLowerCase()}`;
  switch (block.type) {
    case "link":
      return { typeLabel, title: line(block.label, untitled), sub: block.url.trim() };
    case "card":
      return { typeLabel, title: line(block.title, untitled), sub: block.url.trim() };
    case "header":
      return { typeLabel, title: line(block.text, untitled), sub: "" };
    case "text":
      return {
        typeLabel,
        title: line(truncateToCodePoints(block.text.trim(), TEXT_TITLE_LENGTH), untitled),
        sub: "",
      };
    case "image":
      return { typeLabel, title: line(block.alt, "Image"), sub: (block.url ?? "").trim() };
    case "social":
      return {
        typeLabel,
        title: block.icons.map((icon) => SOCIAL_PLATFORM_LABELS[icon.platform]).join(", "),
        sub: count(block.icons.length, "icon", "icons"),
      };
    case "embed":
      return { typeLabel, title: line(block.caption, untitled), sub: block.url.trim() };
    case "grid":
      return {
        typeLabel,
        title: line(
          block.cells
            .map((cell) => singleLine(cell.title).trim())
            .filter((title) => title !== "")
            .join(" · "),
          untitled,
        ),
        sub: count(block.cells.length, "card", "cards"),
      };
    case "divider":
      return { typeLabel, title: "Divider", sub: "" };
    case "faq":
      return {
        typeLabel,
        title: line(
          truncateToCodePoints(
            singleLine(block.items[0]?.question ?? "").trim(),
            TEXT_TITLE_LENGTH,
          ),
          "FAQ",
        ),
        sub: count(block.items.length, "question", "questions"),
      };
    case "contact": {
      const phone = (block.phone ?? "").trim() !== "";
      const email = (block.email ?? "").trim() !== "";
      return {
        typeLabel,
        title: line(block.name, untitled),
        sub: phone && email ? "Phone and email" : phone ? "Phone" : email ? "Email" : "",
      };
    }
    case "discount":
      return {
        typeLabel,
        title: line(block.code, untitled),
        sub: line(block.description ?? "", "Discount code"),
      };
    case "book":
      // M9-20: the book's title, and how many stores sell it.
      return {
        typeLabel,
        title: line(block.title, untitled),
        sub: count(block.links.length, "store", "stores"),
      };
    case "apps":
      // M9-21: the stores' names ("App Store, Google Play"), in the stored order.
      return {
        typeLabel,
        title: line(
          block.links
            .map((link) => appStoreLabel(link.store) ?? "")
            .filter((name) => name !== "")
            .join(", "),
          untitled,
        ),
        sub: count(block.links.length, "store", "stores"),
      };
    case "map":
      // M9-22: the place name, and its address under it.
      return { typeLabel, title: line(block.name, untitled), sub: line(block.address, "") };
    default:
      return { typeLabel: "Block", title: "Unknown block", sub: "" };
  }
}
