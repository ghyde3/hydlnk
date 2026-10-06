import {
  clipMarks,
  isAlignMark,
  isAlignValue,
  newBlockId,
  sortMarks,
  type AlignMark,
  type InlineMark,
  type Mark,
} from "@/lib/document";

/**
 * The boundary between the text editor and the page document (M9-12).
 *
 * The editor is ProseMirror, whose document is a tree of paragraphs with marks on text. The page
 * document stays what M9-11 defined: the plain `text` (one line per paragraph, joined by `\n`) and a
 * flat list of marks, each a range of code point offsets into it. Two pure functions convert at the
 * edge, over plain JSON (no editor is imported here, so they run in Node and in the tests):
 *
 *   `marksToTiptapDoc(text, marks)`      the document the editor opens with
 *   `tiptapDocToTextAndMarks(doc)`       the `{ text, marks }` the draft stores
 *
 * Nothing is ever stored as HTML or as the editor's own JSON, and the editor's HTML helpers are
 * never called (a static scan holds that line).
 *
 * Offsets count code points; ProseMirror counts UTF-16 units, so an emoji is one position for the
 * document and two for the editor. `pmPositionOf` converts one way at the selection edge, and the
 * editor's own `textBetween` the other way.
 *
 * What a round trip normalizes (the marks `marksToTiptapDoc` shows are the clipped ones of
 * `clipMarks`):
 *   - a mark never starts or ends on a line break; it covers line breaks only when the nearest text
 *     on both sides has the same mark (the same link id for a link), so a bold range across two
 *     paragraphs, or across an empty one, is one mark;
 *   - touching or overlapping marks of one type are one mark;
 *   - an alignment is a whole line and an empty line has none; no alignment on a paragraph means
 *     none (the page's), never `left`;
 *   - marks come back sorted (`sortMarks`).
 */

export interface PmMarkJson {
  type: string;
  attrs?: Record<string, unknown> | undefined;
}
export interface PmTextJson {
  type: "text";
  text: string;
  marks?: PmMarkJson[];
}
export interface PmParagraphJson {
  type: "paragraph";
  attrs?: { textAlign?: string | null };
  content?: PmTextJson[];
}
export interface PmDocJson {
  type: "doc";
  content: PmParagraphJson[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const utf16Length = (chars: readonly string[]): number => chars.join("").length;

/** The lines of a text: LF line breaks (CRLF and CR read as LF), one entry per paragraph. */
export function linesOf(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

// Marks -> document -----------------------------------------------------------------------------

function pmMarkOf(mark: InlineMark): PmMarkJson {
  if (mark.type === "link") return { type: "link", attrs: { href: mark.url, id: mark.id } };
  return { type: mark.type };
}

/** The editor's document for a block's text and marks. Never throws: bad marks are clipped away. */
export function marksToTiptapDoc(text: string, marks: unknown): PmDocJson {
  const lines = linesOf(text);
  const chars = Array.from(lines.join("\n"));
  const clipped = clipMarks(marks, chars.length, 0, chars);
  const inline = clipped.filter((mark): mark is InlineMark => !isAlignMark(mark));
  const alignAt = new Map(clipped.filter(isAlignMark).map((mark) => [mark.start, mark.align]));
  const content: PmParagraphJson[] = [];
  let lineStart = 0;
  for (const line of lines) {
    const lineChars = Array.from(line);
    const lineEnd = lineStart + lineChars.length;
    const cuts = new Set<number>([lineStart, lineEnd]);
    for (const mark of inline) {
      if (mark.start > lineStart && mark.start < lineEnd) cuts.add(mark.start);
      if (mark.end > lineStart && mark.end < lineEnd) cuts.add(mark.end);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const nodes: PmTextJson[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i]!;
      const to = points[i + 1]!;
      const covering = inline.filter((mark) => mark.start <= from && mark.end >= to);
      const piece = lineChars.slice(from - lineStart, to - lineStart).join("");
      nodes.push({
        type: "text",
        text: piece,
        ...(covering.length > 0 ? { marks: covering.map(pmMarkOf) } : {}),
      });
    }
    const align = alignAt.get(lineStart);
    content.push({
      type: "paragraph",
      ...(align ? { attrs: { textAlign: align } } : {}),
      ...(nodes.length > 0 ? { content: nodes } : {}),
    });
    lineStart = lineEnd + 1;
  }
  return { type: "doc", content };
}

/**
 * The editor position that sits `offset` code points into `text` (paragraphs open and close with one
 * position each, text counts UTF-16 units). An offset at the end of a line is the end of that line.
 */
export function pmPositionOf(text: string, offset: number): number {
  const lines = linesOf(text);
  let position = 0;
  let remaining = Math.max(0, offset);
  for (const line of lines) {
    const lineChars = Array.from(line);
    position += 1;
    if (remaining <= lineChars.length) return position + utf16Length(lineChars.slice(0, remaining));
    position += line.length + 1;
    remaining -= lineChars.length + 1;
  }
  return position;
}

// Document -> marks -----------------------------------------------------------------------------

interface Run {
  start: number;
  end: number;
}
interface LinkRun extends Run {
  id: string | null;
  href: string;
}

const INLINE_TYPES = ["bold", "italic", "strike", "underline"] as const;
type InlineType = (typeof INLINE_TYPES)[number];

/**
 * `runs` (in text order) merged where they touch, and where they meet across line breaks: one ends
 * at the end of a line and the next starts at the start of a later line with nothing but empty lines
 * (line breaks) between, so a range across two paragraphs, or across an empty one, is one range.
 */
function mergeRuns<T extends Run>(runs: readonly T[], lineEnds: ReadonlySet<number>): T[] {
  const breaksBetween = (from: number, to: number): boolean => {
    for (let position = from; position < to; position++) {
      if (!lineEnds.has(position)) return false;
    }
    return true;
  };
  const merged: T[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && (run.start <= last.end || breaksBetween(last.end, run.start))) {
      last.end = Math.max(last.end, run.end);
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/**
 * The `{ text, marks }` an editor document stands for. `newId` makes the id of a link that has
 * none, or whose id an earlier, separate range already holds (a paste, a link split in two); the
 * editor keeps ids unique itself, so this is a safety net.
 */
export function tiptapDocToTextAndMarks(
  doc: unknown,
  options: { newId?: () => string } = {},
): { text: string; marks: Mark[] } {
  const newId = options.newId ?? newBlockId;
  const paragraphs = isRecord(doc) && Array.isArray(doc.content) ? doc.content : [];
  const lines: string[] = [];
  const lineEnds = new Set<number>();
  const byType: Record<InlineType, Run[]> = { bold: [], italic: [], strike: [], underline: [] };
  const linkRuns: LinkRun[] = [];
  const aligns: AlignMark[] = [];
  let offset = 0;
  const blocks = paragraphs.filter(
    (block) => isRecord(block) && block.type === "paragraph",
  ) as Record<string, unknown>[];
  blocks.forEach((paragraph, index) => {
    if (index > 0) offset += 1;
    const lineStart = offset;
    let line = "";
    const children = Array.isArray(paragraph.content) ? paragraph.content : [];
    for (const child of children) {
      if (!isRecord(child) || child.type !== "text" || typeof child.text !== "string") continue;
      const length = Array.from(child.text).length;
      if (length === 0) continue;
      const run = { start: offset, end: offset + length };
      for (const mark of Array.isArray(child.marks) ? child.marks : []) {
        if (!isRecord(mark)) continue;
        const type = mark.type;
        if (type === "bold" || type === "italic" || type === "strike" || type === "underline") {
          byType[type].push(run);
        } else if (type === "link") {
          const attrs = isRecord(mark.attrs) ? mark.attrs : {};
          if (typeof attrs.href === "string") {
            linkRuns.push({
              ...run,
              href: attrs.href,
              id: typeof attrs.id === "string" && attrs.id !== "" ? attrs.id : null,
            });
          }
        }
      }
      line += child.text;
      offset += length;
    }
    lines.push(line);
    lineEnds.add(offset);
    const attrs = isRecord(paragraph.attrs) ? paragraph.attrs : {};
    if (isAlignValue(attrs.textAlign) && offset > lineStart) {
      aligns.push({ type: "align", start: lineStart, end: offset, align: attrs.textAlign });
    }
  });

  const marks: Mark[] = [];
  for (const type of INLINE_TYPES) {
    for (const run of mergeRuns(byType[type], lineEnds)) {
      marks.push({ type, start: run.start, end: run.end });
    }
  }
  // Links: ranges of one id and one address merge; a second range holding an id already used gets
  // a fresh one, and so does a range with no id.
  const seenIds = new Set<string>();
  const linkGroups = new Map<string, LinkRun[]>();
  for (const run of linkRuns) {
    const key = run.id === null ? "" : `${run.id}\u0000${run.href}`;
    const list = linkGroups.get(key);
    if (list && key !== "") list.push(run);
    else linkGroups.set(key === "" ? `\u0001${linkGroups.size}` : key, [run]);
  }
  const merged = [...linkGroups.values()].flatMap((runs) => mergeRuns(runs, lineEnds));
  merged.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const run of merged) {
    let id = run.id;
    if (id === null || seenIds.has(id)) {
      do id = newId();
      while (seenIds.has(id));
    }
    seenIds.add(id);
    marks.push({ type: "link", start: run.start, end: run.end, id, url: run.href });
  }
  marks.push(...aligns);
  return { text: lines.join("\n"), marks: sortMarks(marks) };
}
