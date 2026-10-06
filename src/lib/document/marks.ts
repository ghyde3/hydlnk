import { z } from "zod";
import { BLOCK_ID_PATTERN } from "./ids";
import { LIMITS, codePointLength } from "./limits";

/**
 * Formatting inside a text block (M6-28, M9-11): structured marks, never syntax in the text.
 *
 * A text block keeps its plain `text` and an optional list of marks, each a range of code point
 * offsets (`start` inclusive, `end` exclusive) into the text. The renderer never parses the text:
 * it cuts it at the mark boundaries and draws React text nodes inside `<strong>`, `<em>`, `<s>`,
 * `<u>` and `<a>`. Nothing here produces or reads HTML, so a text of `<b>x</b>` or `**x**` stays
 * literal.
 *
 * Five marks are inline (bold, italic, strike, underline and link: any range of the text). The
 * sixth, `align`, is a paragraph mark: it covers exactly one paragraph, meaning one line of the text
 * (the characters between two line breaks), and sets that paragraph's alignment to `left`,
 * `center` or `right`. No `align` mark means "follow the page's alignment".
 *
 * Offsets in a DRAFT count into the text as typed. `toPublishForm` trims the text and shifts the
 * marks with it (`publishTextAndMarks`); the published form counts into the trimmed text,
 * `0 <= start < end <= length`, and every `align` mark is a whole line.
 */

export type BoldMark = { type: "bold"; start: number; end: number };
export type ItalicMark = { type: "italic"; start: number; end: number };
export type StrikeMark = { type: "strike"; start: number; end: number };
export type UnderlineMark = { type: "underline"; start: number; end: number };
export type LinkMark = { type: "link"; start: number; end: number; id: string; url: string };
export type InlineMark = BoldMark | ItalicMark | StrikeMark | UnderlineMark | LinkMark;

export const ALIGN_VALUES = ["left", "center", "right"] as const;
export type AlignValue = (typeof ALIGN_VALUES)[number];
export type AlignMark = { type: "align"; start: number; end: number; align: AlignValue };
export type Mark = InlineMark | AlignMark;

export const isAlignValue = (value: unknown): value is AlignValue =>
  typeof value === "string" && (ALIGN_VALUES as readonly string[]).includes(value);

export const MARK_MESSAGES = {
  tooMany: "This text has too much formatting.",
  tooManyLinks: "Use up to 10 links in one text block.",
  overlap: "Links can’t overlap. Remove the other link first.",
  unsupported: "This text has formatting that can’t be published.",
  /** Editor only: a change that would leave more than `LIMITS.textMarks` marks or `LIMITS.textAligns` alignments. */
  editorTooMany: "This block has too much formatting. Remove some of it.",
  /** Editor only: the 11th link. */
  editorTooManyLinks: "You can add up to 10 links to one text block.",
} as const;

/** Orders marks by position, then bold, italic, strike, underline, link, align; a link's id breaks the last tie. */
const TYPE_ORDER = { bold: 0, italic: 1, strike: 2, underline: 3, link: 4, align: 5 } as const;
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

/** Whether a mark is a paragraph alignment (the others are inline). */
export const isAlignMark = (mark: { type: string }): mark is AlignMark => mark.type === "align";

/**
 * The count rule of a marks list, in both the draft and Publish: at most `LIMITS.textMarks` inline
 * marks and at most `LIMITS.textAligns` alignments.
 */
export function checkMarkCounts(
  marks: readonly { type: string }[],
  ctx: z.core.$RefinementCtx,
): void {
  const aligns = marks.filter(isAlignMark).length;
  if (marks.length - aligns > LIMITS.textMarks || aligns > LIMITS.textAligns) {
    ctx.addIssue({ code: "custom", message: MARK_MESSAGES.tooMany });
  }
}

/**
 * The link rule of a marks list at Publish: at most `LIMITS.textLinks` links, and no two links
 * overlap (the later one, in text order, is named).
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

/** Every alignment mark of a block's marks. */
export function alignMarksOf(marks: readonly Mark[] | undefined): AlignMark[] {
  return (marks ?? []).filter(isAlignMark);
}

// Normalizing -----------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The lines of a text: where each starts and ends (code point offsets, the line break itself
 * excluded). A text without line breaks is one line; `chars` undefined stands for such a text of
 * `length` code points.
 */
function lineBounds(
  length: number,
  chars: readonly string[] | undefined,
): { start: number; end: number }[] {
  if (chars === undefined) return [{ start: 0, end: length }];
  const lines: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\n") {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  lines.push({ start, end: chars.length });
  return lines;
}

/**
 * Alignments snapped to whole lines: each one becomes the line that holds its start (a position
 * just before a line break belongs to the line that break ends), two on one line become one (the
 * later in `aligns` wins), one on an empty line is dropped, and the result is in text order and
 * capped at `LIMITS.textAligns`.
 */
function snapAligns(
  aligns: readonly AlignMark[],
  length: number,
  chars: readonly string[] | undefined,
): AlignMark[] {
  if (aligns.length === 0) return [];
  const lines = lineBounds(length, chars);
  const byLine = new Map<number, AlignValue>();
  for (const mark of aligns) {
    // The last line that starts at or before the mark's start.
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lines[mid]!.start <= mark.start) low = mid;
      else high = mid - 1;
    }
    const line = lines[low]!;
    if (line.start >= line.end) continue;
    byLine.set(low, mark.align);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, LIMITS.textAligns)
    .map(([index, align]) => ({
      type: "align" as const,
      start: lines[index]!.start,
      end: lines[index]!.end,
      align,
    }));
}

/**
 * Marks clipped to a text of `length` code points, defensively: `marks` may be anything (a stored
 * document is JSON from the database, a draft may come straight from PostgREST). `lead` code
 * points are removed from the front first, so offsets shift with a trimmed text. Entries that are
 * not a complete mark of one of the six types are dropped; offsets are truncated to whole numbers
 * and clipped to `[0, length]`; empty marks are dropped; the later of two overlapping links is
 * dropped; the inline marks are capped at `LIMITS.textMarks` (links at `LIMITS.textLinks`); the
 * alignments are snapped to whole lines of `chars` (the text, one entry per code point; omitted:
 * a text of one line) and capped at `LIMITS.textAligns`; the result is sorted. Never throws.
 */
export function clipMarks(
  marks: unknown,
  length: number,
  lead = 0,
  chars?: readonly string[],
): Mark[] {
  if (!Array.isArray(marks)) return [];
  const kept: InlineMark[] = [];
  const aligns: AlignMark[] = [];
  for (const raw of marks) {
    if (!isRecord(raw)) continue;
    const { type, start, end } = raw;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const s = Math.max(0, Math.trunc(start) - lead);
    const e = Math.min(length, Math.trunc(end) - lead);
    if (!(s < e)) continue;
    if (type === "bold" || type === "italic" || type === "strike" || type === "underline") {
      kept.push({ type, start: s, end: e });
    } else if (type === "link" && typeof raw.id === "string" && typeof raw.url === "string") {
      kept.push({ type: "link", start: s, end: e, id: raw.id, url: raw.url.trim() });
    } else if (type === "align" && isAlignValue(raw.align)) {
      aligns.push({ type: "align", start: s, end: e, align: raw.align });
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
  return sortMarks([...result, ...snapAligns(aligns, length, chars)]);
}

/**
 * The marks of a stored draft block that the draft schema can read, for the editor's repair of a
 * draft something else wrote (M2-03): each complete mark keeps only its own keys, offsets stay as
 * they are (a draft is lenient about positions), and the first `LIMITS.textMarks` inline marks and
 * `LIMITS.textAligns` alignments are kept. Never throws.
 */
export function salvageMarks(marks: unknown): Mark[] {
  if (!Array.isArray(marks)) return [];
  const result: Mark[] = [];
  let inline = 0;
  let aligns = 0;
  for (const raw of marks) {
    if (!isRecord(raw)) continue;
    const { type, start, end } = raw;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (type === "align") {
      if (!isAlignValue(raw.align) || aligns >= LIMITS.textAligns) continue;
      aligns += 1;
      result.push({ type, start, end, align: raw.align });
      continue;
    }
    if (inline >= LIMITS.textMarks) continue;
    if (type === "bold" || type === "italic" || type === "strike" || type === "underline") {
      inline += 1;
      result.push({ type, start, end });
    } else if (
      type === "link" &&
      typeof raw.id === "string" &&
      BLOCK_ID_PATTERN.test(raw.id) &&
      typeof raw.url === "string" &&
      raw.url.length <= LIMITS.draftUrl
    ) {
      inline += 1;
      result.push({ type, start, end, id: raw.id, url: raw.url });
    }
  }
  return result;
}

/**
 * The publish form of a text block's text and marks (M6-28): the text with CRLF as LF and trimmed,
 * and the marks shifted by the trimmed whitespace and clipped to what is left (see `clipMarks`;
 * alignments become whole lines of the trimmed text). Offsets count code points, so an emoji is one
 * position.
 */
export function publishTextAndMarks(
  rawText: string,
  marks: unknown,
): { text: string; marks: Mark[] } {
  const unified = rawText.replace(/\r\n?/g, "\n");
  const text = unified.trim();
  if (text === "") return { text, marks: [] };
  const lead = unified.length - unified.trimStart().length;
  const chars = Array.from(text);
  return { text, marks: clipMarks(marks, chars.length, lead, chars) };
}

// Segments --------------------------------------------------------------------------------------

export interface TextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  link: { id: string; url: string } | null;
}

/** One line of a text that has alignments: its pieces, and its alignment (null: the page's). */
export interface TextLine {
  align: AlignValue | null;
  segments: TextSegment[];
}

function segmentsOf(chars: readonly string[], inline: readonly Mark[]): TextSegment[] {
  const cuts = new Set<number>([0, chars.length]);
  for (const mark of inline) {
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
    let strike = false;
    let underline = false;
    let link: TextSegment["link"] = null;
    for (const mark of inline) {
      if (mark.start > from || mark.end < to) continue;
      if (mark.type === "bold") bold = true;
      else if (mark.type === "italic") italic = true;
      else if (mark.type === "strike") strike = true;
      else if (mark.type === "underline") underline = true;
      else if (mark.type === "link") link ??= { id: mark.id, url: mark.url };
    }
    const piece = chars.slice(from, to).join("");
    const last = segments[segments.length - 1];
    if (
      last &&
      last.bold === bold &&
      last.italic === italic &&
      last.strike === strike &&
      last.underline === underline &&
      last.link?.id === link?.id
    ) {
      last.text += piece;
    } else {
      segments.push({ text: piece, bold, italic, strike, underline, link });
    }
  }
  return segments;
}

/**
 * The text cut at every inline mark boundary, for the renderer: each piece with the formatting that
 * covers it. Neighbours with the same formatting are one piece. Marks are clipped first, so a
 * range past the end or a negative offset never throws and never draws anything. A text without
 * inline marks is one plain piece. Alignments do not cut the text here: see `textLines`.
 */
export function textSegments(text: string, marks: unknown): TextSegment[] {
  const chars = Array.from(text);
  const inline = clipMarks(marks, chars.length, 0, chars).filter((mark) => !isAlignMark(mark));
  if (inline.length === 0) {
    return [{ text, bold: false, italic: false, strike: false, underline: false, link: null }];
  }
  return segmentsOf(chars, inline);
}

/**
 * The text as lines, for a block that has at least one alignment (M9-11); null when it has none,
 * and the renderer draws the text as one run (`textSegments`). Each line is the text between two
 * line breaks, with the pieces of formatting that cover it (a mark that runs over a line break is
 * cut at it), and the alignment of the `align` mark that covers it. An empty line has no pieces.
 * The line-break characters are not part of any piece.
 */
export function textLines(text: string, marks: unknown): TextLine[] | null {
  const chars = Array.from(text);
  const clipped = clipMarks(marks, chars.length, 0, chars);
  const aligns = alignMarksOf(clipped);
  if (aligns.length === 0) return null;
  const alignAt = new Map(aligns.map((mark) => [mark.start, mark.align]));
  const inline = clipped.filter((mark) => !isAlignMark(mark));
  const segments =
    inline.length === 0
      ? [
          {
            text,
            bold: false,
            italic: false,
            strike: false,
            underline: false,
            link: null,
          } satisfies TextSegment,
        ]
      : segmentsOf(chars, inline);
  let current: TextLine = { align: alignAt.get(0) ?? null, segments: [] };
  const lines: TextLine[] = [current];
  let position = 0;
  for (const segment of segments) {
    segment.text.split("\n").forEach((part, index) => {
      if (index > 0) {
        position += 1;
        current = { align: alignAt.get(position) ?? null, segments: [] };
        lines.push(current);
      }
      if (part !== "") {
        current.segments.push({ ...segment, text: part });
        position += codePointLength(part);
      }
    });
  }
  return lines;
}

/**
 * The published document's own check on marks (the stored form must already be what `clipMarks`
 * returns): whole-number offsets with `0 <= start < end <= length`, and every alignment a whole
 * line, one per line. Used by `publishedDocSchema`.
 */
export function requireMarkRanges(
  doc: { blocks: readonly { type: string; text?: unknown; marks?: unknown }[] },
  ctx: z.core.$RefinementCtx,
): void {
  doc.blocks.forEach((block, index) => {
    if (block.type !== "text" || !Array.isArray(block.marks)) return;
    const text = typeof block.text === "string" ? block.text : "";
    const length = codePointLength(text);
    // The characters are needed only to check where a line starts and ends.
    const chars = block.marks.some((mark) => isRecord(mark) && mark.type === "align")
      ? Array.from(text)
      : [];
    const alignedFrom = new Set<number>();
    block.marks.forEach((mark, i) => {
      const { start, end, type } = (isRecord(mark) ? mark : {}) as {
        start?: unknown;
        end?: unknown;
        type?: unknown;
      };
      let ok =
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        (start as number) >= 0 &&
        (start as number) < (end as number) &&
        (end as number) <= length;
      if (ok && type === "align") {
        const from = start as number;
        const to = end as number;
        ok =
          (from === 0 || chars[from - 1] === "\n") &&
          (to === length || chars[to] === "\n") &&
          !chars.slice(from, to).includes("\n") &&
          !alignedFrom.has(from);
        alignedFrom.add(from);
      }
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
