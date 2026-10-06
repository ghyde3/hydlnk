import { rangesOverlap, type LinkMark, type Mark } from "./marks";

/**
 * Reading marks for the text editor (M6-30, M9-12): pure helpers the editor's link panel uses. Every
 * offset is a code point offset (an emoji is one position). The editing itself, formatting and the
 * way marks follow the text, is the editor's: the document is converted at its edge
 * (`src/components/blocks/forms/text-editor/convert.ts`).
 */

/** The text of `[start, end)` in code points. */
export function textBetween(text: string, start: number, end: number): string {
  return Array.from(text).slice(Math.max(0, start), Math.max(0, end)).join("");
}

/** The links that share at least one position with `[start, end)`. */
export function linksOverlapping(marks: readonly Mark[], start: number, end: number): LinkMark[] {
  return marks.filter(
    (mark): mark is LinkMark => mark.type === "link" && rangesOverlap(mark, { start, end }),
  );
}

/**
 * The link the selection is inside: one that contains all of `[start, end)`, or, for a caret
 * (`start === end`), the one the caret is in or touches (inside wins over the edge).
 */
export function linkAt(marks: readonly Mark[], start: number, end: number): LinkMark | undefined {
  const links = marks.filter((mark): mark is LinkMark => mark.type === "link");
  if (start === end) {
    return (
      links.find((link) => link.start < start && start < link.end) ??
      links.find((link) => link.start <= start && start <= link.end)
    );
  }
  return links.find((link) => link.start <= start && end <= link.end);
}
