import { z } from "zod";
import { LIMITS, codePointLength } from "./limits";

/**
 * Bold, italic and links inside a text block (M6-28): structured marks, never syntax in the text.
 *
 * A text block keeps its plain `text` and an optional list of marks, each a range of code point
 * offsets (`start` inclusive, `end` exclusive) into the text. The renderer never parses the text:
 * it cuts it at the mark boundaries and draws React text nodes inside `<strong>`, `<em>` and `<a>`.
 * Nothing here produces or reads HTML, so a text of `<b>x</b>` or `**x**` stays literal.
 *
 * Offsets in a DRAFT count into the text as typed (the editor's textarea value). `toPublishForm`
 * trims the text and shifts the marks with it (`publishTextAndMarks`); the published form counts into
 * the trimmed text, `0 <= start < end <= length`.
 */

export type BoldMark = { type: "bold"; start: number; end: number };
export type ItalicMark = { type: "italic"; start: number; end: number };
export type LinkMark = { type: "link"; start: number; end: number; id: string; url: string };
export type Mark = BoldMark | ItalicMark | LinkMark;

export const MARK_MESSAGES = {
  tooMany: "This text has too much formatting.",
  tooManyLinks: "Use up to 10 links in one text block.",
  overlap: "Links can’t overlap. Remove the other link first.",
  unsupported: "This text has formatting that can’t be published.",
  /** Editor only: a change that would leave more than `LIMITS.textMarks` marks. */
  editorTooMany: "This block has too much formatting. Remove some bold, italic or links.",
  /** Editor only: the 11th link. */
  editorTooManyLinks: "You can add up to 10 links to one text block.",
} as const;

/** Orders marks by position, then bold, italic, link; a link's id breaks the last tie. */
const TYPE_ORDER = { bold: 0, italic: 1, link: 2 } as const;
export function sortMarks<T extends Mark>(marks: readonly T[]): T[] {
  return marks.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    return a.type === "link" && b.type === "link" ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : 0;
  });
}

/** Whether two ranges share at least one position. */
export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return a.start < b.end && b.start < a.end;
}

/**
 * The array rule of a marks list at Publish: at most `LIMITS.textLinks` links, and no two links
 * overlap (the later one, in text order, is named). Counting marks (`LIMITS.textMarks`) is the
 * array's own `max`.
 */
export function checkMarks(
  marks: readonly { type: string; start: number; end: number }[],
  ctx: z.core.$RefinementCtx,
) {
  const links = marks
    .map((mark, index) => ({ mark, index }))
    .filter((entry) => entry.mark.type === "link" && entry.mark.start < entry.mark.end);
  if (links.length > LIMITS.textLinks) {
    ctx.addIssue({ code: "custom", message: MARK_MESSAGES.tooManyLinks });
  }
  const ordered = links
    .slice()
    .sort((a, b) => a.mark.start - b.mark.start || a.mark.end - b.mark.end);
  let reach = -Infinity;
  for (const { mark, index } of ordered) {
    if (mark.start < reach) {
      ctx.addIssue({ code: "custom", path: [index, "start"], message: MARK_MESSAGES.overlap });
    }
    reach = Math.max(reach, mark.end);
  }
}

/** Every link mark of a block's marks (the ones that carry an id and an address). */
export function linkMarksOf(marks: readonly Mark[] | undefined): LinkMark[] {
  return (marks ?? []).filter((mark): mark is LinkMark => mark.type === "link");
}

// Normalizing -----------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Marks clipped to a text of `length` code points, defensively: `marks` may be anything (a stored
 * document is JSON from the database, a draft may come straight from PostgREST). `lead` code
 * points are removed from the front first, so offsets shift with a trimmed text. Entries that are
 * not a bold, italic or complete link mark are dropped; offsets are truncated to whole numbers
 * and clipped to `[0, length]`; empty marks are dropped; the later of two overlapping links is
 * dropped; the result is sorted and capped at `LIMITS.textMarks` marks and `LIMITS.textLinks`
 * links. Never throws.
 */
export function clipMarks(marks: unknown, length: number, lead = 0): Mark[] {
  if (!Array.isArray(marks)) return [];
  const kept: Mark[] = [];
  for (const raw of marks) {
    if (!isRecord(raw)) continue;
    const { type, start, end } = raw;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const s = Math.max(0, Math.trunc(start) - lead);
    const e = Math.min(length, Math.trunc(end) - lead);
    if (!(s < e)) continue;
    if (type === "bold" || type === "italic") {
      kept.push({ type, start: s, end: e });
    } else if (type === "link" && typeof raw.id === "string" && typeof raw.url === "string") {
      kept.push({ type: "link", start: s, end: e, id: raw.id, url: raw.url.trim() });
    }
  }
  const sorted = sortMarks(kept);
  const result: Mark[] = [];
  let links = 0;
  let linkReach = 0;
  for (const mark of sorted) {
    if (result.length >= LIMITS.textMarks) break;
    if (mark.type === "link") {
      if (mark.start < linkReach || links >= LIMITS.textLinks) continue;
      linkReach = mark.end;
      links += 1;
    }
    result.push(mark);
  }
  return result;
}

/**
 * The publish form of a text block's text and marks (M6-28): the text with CRLF as LF and trimmed,
 * and the marks shifted by the trimmed whitespace and clipped to what is left (see `clipMarks`).
 * Offsets count code points, so an emoji is one position.
 */
export function publishTextAndMarks(
  rawText: string,
  marks: unknown,
): { text: string; marks: Mark[] } {
  const unified = rawText.replace(/\r\n?/g, "\n");
  const text = unified.trim();
  if (text === "") return { text, marks: [] };
  const lead = unified.length - unified.trimStart().length;
  return { text, marks: clipMarks(marks, codePointLength(text), lead) };
}

// Segments --------------------------------------------------------------------------------------

export interface TextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  link: { id: string; url: string } | null;
}

/**
 * The text cut at every mark boundary, for the renderer: each piece with the formatting that
 * covers it. Neighbours with the same formatting are one piece. Marks are clipped first, so a
 * range past the end or a negative offset never throws and never draws anything. A text without
 * marks is one plain piece.
 */
export function textSegments(text: string, marks: unknown): TextSegment[] {
  const chars = Array.from(text);
  const clipped = clipMarks(marks, chars.length);
  if (clipped.length === 0) return [{ text, bold: false, italic: false, link: null }];
  const cuts = new Set<number>([0, chars.length]);
  for (const mark of clipped) {
    cuts.add(mark.start);
    cuts.add(mark.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    let bold = false;
    let italic = false;
    let link: TextSegment["link"] = null;
    for (const mark of clipped) {
      if (mark.start > from || mark.end < to) continue;
      if (mark.type === "bold") bold = true;
      else if (mark.type === "italic") italic = true;
      else link ??= { id: mark.id, url: mark.url };
    }
    const piece = chars.slice(from, to).join("");
    const last = segments[segments.length - 1];
    if (last && last.bold === bold && last.italic === italic && last.link?.id === link?.id) {
      last.text += piece;
    } else {
      segments.push({ text: piece, bold, italic, link });
    }
  }
  return segments;
}

/**
 * The published document's own check on marks (the stored form must already be what `clipMarks`
 * returns): whole-number offsets with `0 <= start < end <= length`. Used by `publishedDocSchema`.
 */
export function requireMarkRanges(
  doc: { blocks: readonly { type: string; text?: unknown; marks?: unknown }[] },
  ctx: z.core.$RefinementCtx,
): void {
  doc.blocks.forEach((block, index) => {
    if (block.type !== "text" || !Array.isArray(block.marks)) return;
    const length = typeof block.text === "string" ? codePointLength(block.text) : 0;
    block.marks.forEach((mark, i) => {
      const { start, end } = (isRecord(mark) ? mark : {}) as { start?: unknown; end?: unknown };
      const ok =
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        (start as number) >= 0 &&
        (start as number) < (end as number) &&
        (end as number) <= length;
      if (!ok) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index, "marks", i],
          message: MARK_MESSAGES.unsupported,
        });
      }
    });
  });
}
