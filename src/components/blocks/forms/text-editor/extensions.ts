import { Extension } from "@tiptap/react";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { Underline } from "@tiptap/extension-underline";
import { Fragment, Slice, type Node as PmNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import {
  LIMITS,
  MARK_MESSAGES,
  codePointLength,
  isAlignValue,
  isHttpUrl,
  newBlockId,
} from "@/lib/document";
import { tiptapDocToTextAndMarks } from "./convert";

/**
 * The text editor's schema, keys and guards (M9-12). Everything the page document does not know is
 * switched off, so what the editor can hold is exactly what the document can store:
 *
 *   doc > paragraph > text, marks bold, italic, strike, underline and link (http or https only),
 *   and an alignment (left, center, right) on a paragraph. No headings, lists, quotes, code, rules,
 *   hard breaks, drop or gap cursors, trailing node, no autolink and no link on paste.
 *
 * Imported only by the editor module: the public page never reaches this file (a module-graph scan
 * holds that line). Nothing here reads the document as HTML.
 */

/** What the editor tells the component when it refuses a change. */
export interface EditorHooks {
  refuse: (message: string) => void;
}

/** Ctrl or Cmd+K fires this event on the editor's element; the component opens the link panel. */
export const LINK_REQUEST_EVENT = "hydlnk:text-link";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** A fresh stand-in id for a count that never keeps its result. */
const counting = () => {
  let n = 0;
  return () => `count-${++n}`;
};

// Measuring -------------------------------------------------------------------------------------

export interface Measure {
  length: number;
  inline: number;
  aligns: number;
  links: number;
}

const measures = new WeakMap<PmNode, Measure>();

/** The text length (code points, line breaks included) and the mark counts of an editor document. */
export function measureDoc(doc: PmNode): Measure {
  const cached = measures.get(doc);
  if (cached) return cached;
  const { text, marks } = tiptapDocToTextAndMarks(doc.toJSON(), { newId: counting() });
  const aligns = marks.filter((mark) => mark.type === "align").length;
  const result: Measure = {
    length: codePointLength(text),
    inline: marks.length - aligns,
    aligns,
    links: marks.filter((mark) => mark.type === "link").length,
  };
  measures.set(doc, result);
  return result;
}

/** The code points the selection replaces (line breaks between paragraphs count as one). */
function selectedLength(state: EditorState, from = state.selection.from, to = state.selection.to) {
  return codePointLength(state.doc.textBetween(from, to, "\n"));
}

// Limits ----------------------------------------------------------------------------------------

/**
 * A change that would leave more than 600 code points, 30 inline marks, 20 alignments or 10 links
 * is refused (the transaction is dropped, nothing changes), but only when it makes the count
 * bigger: a block that is already over a limit (written by something else) can still be edited down.
 */
function limitsPlugin(hooks: EditorHooks): Plugin {
  return new Plugin({
    key: new PluginKey("textLimits"),
    filterTransaction(transaction, state) {
      if (!transaction.docChanged) return true;
      const before = measureDoc(state.doc);
      const after = measureDoc(transaction.doc);
      if (after.length > LIMITS.text && after.length > before.length) return false;
      if (
        (after.inline > LIMITS.textMarks && after.inline > before.inline) ||
        (after.aligns > LIMITS.textAligns && after.aligns > before.aligns)
      ) {
        hooks.refuse(MARK_MESSAGES.editorTooMany);
        return false;
      }
      if (after.links > LIMITS.textLinks && after.links > before.links) {
        hooks.refuse(MARK_MESSAGES.editorTooManyLinks);
        return false;
      }
      return true;
    },
    props: {
      // Typing past the limit inserts nothing; a longer insertion (dictation, a replaced word, a
      // fill) is cut to what the block has room for, as a paste is (the transaction filter above is
      // the backstop).
      handleTextInput(view, from, to, text) {
        const current = measureDoc(view.state.doc).length;
        const kept = current - selectedLength(view.state, from, to);
        const room = LIMITS.text - kept;
        if (codePointLength(text) <= room || codePointLength(text) <= selectedLength(view.state, from, to)) {
          return false;
        }
        const cut = Array.from(text).slice(0, Math.max(0, room)).join("");
        if (cut === "") {
          // Nothing fits: the document stays as it is, and the view is redrawn from it.
          view.updateState(view.state);
        } else {
          view.dispatch(view.state.tr.insertText(cut, from, to));
        }
        return true;
      },
    },
  });
}

// Paste and drop --------------------------------------------------------------------------------

/** `slice` cut to `room` code points (a line break between paragraphs costs one). */
export function fitSlice(slice: Slice, room: number): Slice {
  const kept: PmNode[] = [];
  let left = Math.max(0, room);
  let done = false;
  slice.content.forEach((block, _offset, index) => {
    if (done) return;
    if (index > 0) {
      if (left < 1) {
        done = true;
        return;
      }
      left -= 1;
    }
    const children: PmNode[] = [];
    block.forEach((child) => {
      if (done || !child.isText) return;
      const chars = Array.from(child.text ?? "");
      if (chars.length <= left) {
        children.push(child);
        left -= chars.length;
      } else {
        if (left > 0) children.push(child.cut(0, chars.slice(0, left).join("").length));
        left = 0;
        done = true;
      }
    });
    kept.push(block.copy(Fragment.from(children)));
  });
  if (kept.length === 0) return Slice.empty;
  const cutShort = kept.length < slice.content.childCount || done;
  return new Slice(Fragment.from(kept), slice.openStart, cutShort ? 1 : slice.openEnd);
}

/** `slice` with every text node mapped by `change` (marks kept unless `change` returns them). */
function mapText(slice: Slice, change: (node: PmNode) => PmNode | null): Slice {
  const map = (fragment: Fragment): Fragment => {
    const nodes: PmNode[] = [];
    fragment.forEach((node) => {
      if (node.isText) {
        const next = change(node);
        if (next) nodes.push(next);
      } else {
        nodes.push(node.copy(map(node.content)));
      }
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(map(slice.content), slice.openStart, slice.openEnd);
}

function linkCountOf(slice: Slice): number {
  const doc = { type: "doc", content: slice.content.toJSON() as unknown };
  return tiptapDocToTextAndMarks(doc, { newId: counting() }).marks.filter(
    (mark) => mark.type === "link",
  ).length;
}

/**
 * Paste and drop keep only what the document can hold: the schema drops every other mark and node
 * as the content is parsed, and here the text loses its control characters, links over the limit
 * of ten lose their link (the text stays), and the whole is cut to what the block has room for.
 * A plain-text paste keeps every line, an empty one included.
 */
function pastePlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("textPaste"),
    props: {
      clipboardTextParser(text, $context, _plain, view) {
        const { schema } = view.state;
        const marks = $context.marks();
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        const paragraphs = lines.map((raw) => {
          const line = raw.replace(CONTROL_CHARACTERS, "");
          return schema.nodes.paragraph!.create(null, line === "" ? null : schema.text(line, marks));
        });
        return new Slice(Fragment.from(paragraphs), 1, 1);
      },
      transformPasted(slice, view) {
        const { state } = view;
        const linkType = state.schema.marks.link;
        let next = mapText(slice, (node) => {
          const clean = node.text!.replace(CONTROL_CHARACTERS, "");
          return clean === ""
            ? null
            : clean === node.text
              ? node
              : state.schema.text(clean, node.marks);
        });
        if (linkType) {
          const existing = measureDoc(state.doc).links;
          if (existing + linkCountOf(next) > LIMITS.textLinks) {
            next = mapText(next, (node) =>
              node.mark(node.marks.filter((m) => m.type !== linkType)),
            );
          }
        }
        const room = LIMITS.text - (measureDoc(state.doc).length - selectedLength(state));
        return fitSlice(next, room);
      },
      // A link inside the editor is text, not a door: a click never leaves the page.
      handleDOMEvents: {
        click(_view, event) {
          const target = event.target;
          if (target instanceof Element && target.closest("a")) event.preventDefault();
          return false;
        },
      },
    },
  });
}

// Link ids --------------------------------------------------------------------------------------

/**
 * Every link keeps one id of its own (the click counter and the blocklist name a link by it). A
 * link pasted in has none, and a link split in two keeps the same id on both parts: the later range
 * gets a fresh one, so the editor's document never holds an id twice.
 */
function linkIdsPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("textLinkIds"),
    appendTransaction(transactions, _before, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const linkType = (state.schema as Schema).marks.link;
      if (!linkType) return null;
      interface Run {
        from: number;
        to: number;
        id: string | null;
        href: string;
        attrs: Record<string, unknown>;
      }
      interface Group {
        id: string | null;
        href: string;
        to: number;
        runs: Run[];
      }
      const groups: Group[] = [];
      state.doc.descendants((node, position) => {
        if (!node.isText) return;
        const mark = node.marks.find((candidate) => candidate.type === linkType);
        if (!mark) return;
        const id = typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null;
        const href = typeof mark.attrs.href === "string" ? mark.attrs.href : "";
        const run: Run = {
          from: position,
          to: position + node.nodeSize,
          id,
          href,
          attrs: mark.attrs,
        };
        const group =
          id === null
            ? undefined
            : groups.find(
                (candidate) =>
                  candidate.id === id &&
                  candidate.href === href &&
                  /^\n*$/.test(state.doc.textBetween(candidate.to, run.from, "\n")),
              );
        if (group) {
          group.runs.push(run);
          group.to = run.to;
        } else {
          groups.push({ id, href, to: run.to, runs: [run] });
        }
      });
      const seen = new Set<string>();
      const transaction = state.tr;
      let changed = false;
      for (const group of groups) {
        let id = group.id;
        if (id === null || seen.has(id)) {
          do id = newBlockId();
          while (seen.has(id));
          for (const run of group.runs) {
            transaction.addMark(run.from, run.to, linkType.create({ ...run.attrs, id }));
          }
          changed = true;
        }
        seen.add(id);
      }
      return changed ? transaction : null;
    },
  });
}

// The extensions --------------------------------------------------------------------------------

/** The link mark: a stable id, no autolink, no link on paste, nothing but http and https. */
const EditorLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Never read from or written to HTML: a pasted link gets a fresh id from `linkIdsPlugin`.
      id: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    };
  },
}).configure({
  autolink: false,
  linkOnPaste: false,
  openOnClick: false,
  markdownLinks: false,
  protocols: [],
  HTMLAttributes: { target: null, rel: null, class: "tt-link" },
  isAllowedUri: (url) => typeof url === "string" && isHttpUrl(url),
});

// A web address is never made a link for the person, typed or pasted (M2-16: formatting is explicit).
const EditorLinkWithoutPasteRules = EditorLink.extend({
  addPasteRules() {
    return [];
  },
});

/**
 * The alignment attribute of a paragraph: `null` (the page's alignment) unless the person chose one,
 * and never read from pasted HTML. It shows as `data-align`, so the editor sets no inline style.
 */
const EditorTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: () => null,
            renderHTML: (attributes: Record<string, unknown>) =>
              isAlignValue(attributes.textAlign) ? { "data-align": attributes.textAlign } : {},
          },
        },
      },
    ];
  },
}).configure({
  types: ["paragraph"],
  alignments: ["left", "center", "right"],
  defaultAlignment: null,
});

/** Shift+Enter starts a paragraph too; Ctrl or Cmd+K asks for the link panel. */
const textKeys = () =>
  Extension.create({
    name: "textKeys",
    addKeyboardShortcuts() {
      return {
        "Shift-Enter": () => this.editor.commands.splitBlock(),
        "Mod-k": () => {
          this.editor.view.dom.dispatchEvent(new CustomEvent(LINK_REQUEST_EVENT));
          return true;
        },
      };
    },
  });

const guards = (hooks: EditorHooks) =>
  Extension.create({
    name: "textGuards",
    addProseMirrorPlugins() {
      return [limitsPlugin(hooks), pastePlugin(), linkIdsPlugin()];
    },
  });

/** The marks that would otherwise turn typed or pasted Markdown (`**b**`, `_i_`, `~~s~~`) into formatting. */
const MARKDOWN_MARKS = new Set(["bold", "italic", "strike"]);

/**
 * StarterKit with no Markdown shortcuts: typing `**b**` or pasting `~~s~~` stays literal text, as in
 * the page itself (M2-16: formatting is explicit, made with the toolbar or a key).
 */
const Kit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      MARKDOWN_MARKS.has(extension.name)
        ? extension.extend({
            addInputRules() {
              return [];
            },
            addPasteRules() {
              return [];
            },
          })
        : extension,
    );
  },
});

/** The extensions of one editor, each registered once. */
export function buildExtensions(hooks: EditorHooks) {
  return [
    Kit.configure({
      blockquote: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      trailingNode: false,
      // Registered once, below, with the editor's own options.
      link: false,
      underline: false,
      undoRedo: { depth: 100, newGroupDelay: 500 },
    }),
    Underline,
    EditorLinkWithoutPasteRules,
    EditorTextAlign,
    textKeys(),
    guards(hooks),
  ];
}
