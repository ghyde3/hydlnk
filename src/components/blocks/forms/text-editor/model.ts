import type { Editor } from "@tiptap/react";
import {
  codePointLength,
  singleLine,
  textBetween,
  truncateToCodePoints,
  type AlignValue,
  type LinkMark,
  type Mark,
  type TextBlock,
} from "@/lib/document";
import { tiptapDocToTextAndMarks } from "./convert";

/**
 * What the editor's chrome reads from the editor: the text and marks it stands for, the selection in
 * code points, which buttons are pressed and whether undo and redo have anything to do. One snapshot
 * per transaction (`useEditorState`), so the toolbar, the counter, the link list and the link panel
 * all agree with each other and with what was last written to the draft.
 */
export interface EditorModel {
  text: string;
  marks: Mark[];
  /** The selection as code point offsets into `text`. */
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  align: AlignValue | null;
  canUndo: boolean;
  canRedo: boolean;
}

export const EMPTY_MODEL: EditorModel = {
  text: "",
  marks: [],
  start: 0,
  end: 0,
  bold: false,
  italic: false,
  strike: false,
  underline: false,
  align: null,
  canUndo: false,
  canRedo: false,
};

/** A stand-in id counter, so a read of the model is the same every time (it never keeps the result). */
const stable = () => {
  let n = 0;
  return () => `read-${++n}`;
};

/** The editor's current model. */
export function readModel(editor: Editor): EditorModel {
  const { text, marks } = tiptapDocToTextAndMarks(editor.getJSON(), { newId: stable() });
  const { from, to } = editor.state.selection;
  const offset = (position: number) =>
    codePointLength(editor.state.doc.textBetween(0, position, "\n"));
  return {
    text,
    marks,
    start: offset(from),
    end: offset(to),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    underline: editor.isActive("underline"),
    align:
      (["left", "center", "right"] as const).find((value) =>
        editor.isActive({ textAlign: value }),
      ) ?? null,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

/** `block` with `marks`, or without the key when there are none: a plain block stays byte-identical. */
export function withMarks(block: TextBlock, marks: readonly Mark[]): TextBlock {
  const next: TextBlock = { ...block };
  if (marks.length > 0) next.marks = marks.slice() as NonNullable<TextBlock["marks"]>;
  else delete next.marks;
  return next;
}

/** The first 60 characters of the text a link covers, on one line. */
export function linkedText(text: string, link: LinkMark): string {
  return truncateToCodePoints(singleLine(textBetween(text, link.start, link.end)).trim(), 60);
}

/** A key for a block's text and marks: equal keys are the same content. */
export const contentKey = (text: string, marks: readonly Mark[] | undefined): string =>
  JSON.stringify([text, marks ?? []]);
