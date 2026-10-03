import { codePointLength } from "./limits";
import { sortMarks, rangesOverlap, type LinkMark, type Mark } from "./marks";

/**
 * Editing marks (M6-30): pure functions the text block's toolbar and textarea use. Every offset is
 * a code point offset (an emoji is one position), never a UTF-16 index; `toCodePointOffset` and
 * `toUtf16Index` convert at the textarea's edge.
 */

/** The code point offset of a UTF-16 string index (what `selectionStart` returns). */
export function toCodePointOffset(text: string, index: number): number {
  return codePointLength(text.slice(0, Math.max(0, index)));
}

/** The UTF-16 string index after `offset` code points (what `setSelectionRange` takes). */
export function toUtf16Index(text: string, offset: number): number {
  let units = 0;
  let count = 0;
  for (const char of text) {
    if (count >= offset) break;
    units += char.length;
    count += 1;
  }
  return units;
}

/** The text of `[start, end)` in code points. */
export function textBetween(text: string, start: number, end: number): string {
  return Array.from(text).slice(Math.max(0, start), Math.max(0, end)).join("");
}

// Marks follow the text ---------------------------------------------------------------------------

/**
 * One mark after the change: `[from, to)` of the old text was replaced by `inserted` code points
 * (`delta` longer or shorter in all).
 */
function moveMark(
  mark: Mark,
  from: number,
  to: number,
  inserted: number,
  delta: number,
): Mark | null {
  const { start, end } = mark;
  let s = start;
  let e = end;
  if (from === to) {
    // Typing or pasting at one point.
    if (end <= from) return mark; // right after the end, or before it: unchanged
    if (start >= from) {
      // before the mark (or at its start): the mark moves right
      s += inserted;
      e += inserted;
    } else {
      e += inserted; // inside the mark: it grows with the text
    }
  } else {
    // A deletion or a replacement of `[from, to)`.
    if (end <= from) return mark;
    if (start >= to) {
      s += delta;
      e += delta;
    } else if (start < from && end > to) {
      e += delta; // the change is inside the mark: it grows or shrinks
    } else if (start >= from && end <= to) {
      return null; // all of its text is gone
    } else if (start < from) {
      e = from; // the change cuts its end: only the part before survives
    } else {
      s = from + inserted; // the change cuts its start: only the part after survives
      e += delta;
    }
  }
  return s < e ? ({ ...mark, start: s, end: e } as Mark) : null;
}

/**
 * The marks after the text changed from `oldText` to `newText`. The changed middle is found by the
 * common prefix and suffix (so it runs on every input event, undo and redo of the textarea
 * included). Typing inside a range extends it, typing right after its end does not, typing before it
 * moves it, deleting all of its text removes it, and replacing a selection that spans its edge
 * shortens it. Marks that end up empty are dropped. Never adds a mark.
 */
export function adjustMarks(oldText: string, newText: string, marks: readonly Mark[]): Mark[] {
  if (oldText === newText || marks.length === 0) return marks.slice();
  const before = Array.from(oldText);
  const after = Array.from(newText);
  const shortest = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const from = prefix;
  const to = before.length - suffix;
  const inserted = after.length - suffix - prefix;
  const delta = inserted - (to - from);
  const result: Mark[] = [];
  for (const mark of marks) {
    const next = moveMark(mark, from, to, inserted, delta);
    if (next) result.push(next);
  }
  return result;
}

// Bold and italic ---------------------------------------------------------------------------------

export type FormatType = "bold" | "italic";

/** Whether `[start, end)` is covered, end to end, by marks of `type` (what `aria-pressed` shows). */
export function isFormatted(
  marks: readonly Mark[],
  type: FormatType,
  start: number,
  end: number,
): boolean {
  if (!(start < end)) return false;
  const ranges = marks.filter((mark) => mark.type === type).sort((a, b) => a.start - b.start);
  let position = start;
  for (const mark of ranges) {
    if (mark.end <= position) continue;
    if (mark.start > position) return false;
    position = mark.end;
    if (position >= end) return true;
  }
  return position >= end;
}

/**
 * Bold or italic on `[start, end)`: removed when the whole selection already has it (a mark
 * the selection sits inside is split in two), added otherwise, merged with every mark of that
 * type it touches so there is one mark where there was a run. The result is sorted.
 */
export function toggleFormat(
  marks: readonly Mark[],
  type: FormatType,
  start: number,
  end: number,
): Mark[] {
  if (!(start < end)) return marks.slice();
  if (isFormatted(marks, type, start, end)) {
    const next: Mark[] = [];
    for (const mark of marks) {
      if (mark.type !== type || !rangesOverlap(mark, { start, end })) {
        next.push(mark);
        continue;
      }
      if (mark.start < start) next.push({ type, start: mark.start, end: start });
      if (mark.end > end) next.push({ type, start: end, end: mark.end });
    }
    return sortMarks(next);
  }
  let mergedStart = start;
  let mergedEnd = end;
  const next: Mark[] = [];
  for (const mark of marks) {
    if (mark.type === type && mark.start <= end && mark.end >= start) {
      mergedStart = Math.min(mergedStart, mark.start);
      mergedEnd = Math.max(mergedEnd, mark.end);
    } else {
      next.push(mark);
    }
  }
  next.push({ type, start: mergedStart, end: mergedEnd });
  return sortMarks(next);
}

// Links -------------------------------------------------------------------------------------------

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

/** `marks` plus a link on `[start, end)`. The caller has checked that no link overlaps it. */
export function addLinkMark(
  marks: readonly Mark[],
  start: number,
  end: number,
  id: string,
  url: string,
): Mark[] {
  return sortMarks([...marks, { type: "link", start, end, id, url }]);
}

/** The link `id` with a new address. */
export function setLinkUrl(marks: readonly Mark[], id: string, url: string): Mark[] {
  return marks.map((mark) => (mark.type === "link" && mark.id === id ? { ...mark, url } : mark));
}

/** `marks` without the link `id`. */
export function removeLinkMark(marks: readonly Mark[], id: string): Mark[] {
  return marks.filter((mark) => !(mark.type === "link" && mark.id === id));
}
