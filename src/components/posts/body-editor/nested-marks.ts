import type { JSONContent } from "@tiptap/core";

/**
 * Inline content whose marks overlap without nesting (bold `a`, bold and italic `b`, italic `c`),
 * written as nested Markdown that reads back to the same marks (M16-13). The library reopens such a
 * mark as HTML (`**a*b***<em>c</em>`), which the live page draws as text; Markdown has no overlap,
 * so a mark is closed where another closes over it and opened again after: `**a*b***_c_`.
 *
 * The marks are kept on a stack: at each text node, the marks it does not carry are closed (with
 * every mark opened after them, which is reopened if the node carries it), then the marks it adds
 * are opened, the one that runs furthest first (outermost). A mark reopened right after a closing
 * `*` run would join it (`****`), so it is written with `_` (`_`, `__`) there; and `_` cannot close
 * before a letter, so a plan may write bold or italic with `_` throughout (`x __a*b*__*c*d`).
 *
 * Marks that nest are written by the library as before, when its Markdown reads back as the nodes
 * do (`readsBack`: the same text with the same marks). When it does not (crossing marks, or a run
 * the library closes where it cannot close: `**.**z`), delimiter choice and nesting order are tried
 * in a fixed order of plans (18), and the first that reads back is written; when none does, the
 * library's Markdown (or, for crossing marks, the first plan's: never HTML). Linear: a fixed number
 * of plans, each one pass over the nodes and one lex of its Markdown.
 */

type Mark = NonNullable<JSONContent["marks"]>[number];

/** The parts of the library's serializer this writer uses (private methods of `MarkdownManager`). */
export interface InlineWriter {
  encodeTextForMarkdown(text: string, node: JSONContent, parentNode?: JSONContent): string;
  getMarkOpening(type: string, mark: Mark): string;
  getMarkClosing(type: string, mark: Mark): string;
  getHtmlReopenTags(type: string): { open: string; close: string } | undefined;
  renderNodeToMarkdown(
    node: JSONContent,
    parentNode?: JSONContent,
    index?: number,
    level?: number,
  ): string;
}

/** The marks written with a delimiter of our choosing; the others (link, code) as the library writes them. */
const DELIMITERS: Record<string, { usual: string; other: string }> = {
  bold: { usual: "**", other: "__" },
  italic: { usual: "*", other: "_" },
};

/** When a mark is written with `_`: right after a `*` run (`adjacent`), always, or never. */
type Underscore = "adjacent" | "always" | "never";

/** What the plans vary: which of two marks opened at one node is outer, and when bold and italic use `_`. */
interface Plan {
  outer: "longest" | "shortest";
  underscore: Record<string, Underscore>;
}
const CHOICES: readonly Underscore[] = ["adjacent", "always", "never"];
const PLANS: readonly Plan[] = (["longest", "shortest"] as const).flatMap((outer) =>
  CHOICES.flatMap((bold) => CHOICES.map((italic) => ({ outer, underscore: { bold, italic } }))),
);

const key = (mark: Mark) => `${mark.type}${JSON.stringify(mark.attrs ?? {})}`;
const isText = (node: JSONContent) => node.type === "text";
/** A node's marks with each mark once (a document may repeat one; Markdown cannot). */
const distinct = (marks: Mark[]) => marks.filter((mark, k) => marks.findIndex((other) => key(other) === key(mark)) === k);

interface Open {
  mark: Mark;
  close: string;
}

/**
 * The nodes' Markdown when their marks cross (null when they nest, or the library writes them with
 * no HTML: the library's own output is kept). `readsBack` says whether some Markdown reads back as
 * the nodes' text and marks.
 */
export function nestedInline(
  writer: InlineWriter,
  nodes: JSONContent[],
  parentNode: JSONContent | undefined,
  level: number,
  library: () => string,
  readsBack: (markdown: string, nodes: JSONContent[]) => boolean,
): string | null {
  if (!nodes.some((node) => (node.marks?.length ?? 0) > 0)) return null;
  const ends = spanEnds(nodes);
  let fallback: string | null = null;
  if (!crosses(nodes, ends)) {
    const written = library();
    const html = ["bold", "italic", "strike"].some((type) => {
      const tags = writer.getHtmlReopenTags(type);
      return tags !== undefined && written.includes(tags.open);
    });
    if (!html && readsBack(written, nodes)) return written;
    if (!html) fallback = written;
  }
  // Each node's text is encoded once for every plan; plans that write the same Markdown (a choice
  // for a mark the nodes do not carry) are read once.
  const encoded = nodes.map((node) => (isText(node) ? writer.encodeTextForMarkdown(node.text ?? "", node, parentNode) : ""));
  const tried = new Set<string>(fallback === null ? [] : [fallback]);
  let first: string | null = null;
  for (const plan of PLANS) {
    const out = write(writer, nodes, encoded, parentNode, level, ends, plan);
    first ??= out;
    if (tried.has(out)) continue;
    tried.add(out);
    if (readsBack(out, nodes)) return out;
  }
  return fallback ?? first!;
}

/** For each node and each of its marks, the last node of the run of nodes that carry it. */
function spanEnds(nodes: JSONContent[]): Array<Map<string, number>> {
  const ends = nodes.map(() => new Map<string, number>());
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (!isText(nodes[i]!)) continue;
    for (const mark of nodes[i]!.marks ?? []) {
      const k = key(mark);
      ends[i]!.set(k, ends[i + 1]?.get(k) ?? i);
    }
  }
  return ends;
}

/**
 * Whether the marks cross: some node drops a mark while it keeps one opened after it, with each
 * node opening its marks outermost-longest (`write`'s stack, its marks only).
 */
function crosses(nodes: JSONContent[], ends: Array<Map<string, number>>): boolean {
  const stack: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    if (!isText(node)) {
      stack.length = 0;
      continue;
    }
    const held = new Set((node.marks ?? []).map(key));
    const below = stack.findIndex((k) => !held.has(k));
    if (below !== -1) {
      for (let k = below; k < stack.length; k += 1) if (held.has(stack[k]!)) return true;
      stack.length = below;
    }
    if ((node.text ?? "").trim() === "") continue;
    const adding = [...held].filter((k) => !stack.includes(k));
    adding.sort((a, b) => ends[i]!.get(b)! - ends[i]!.get(a)!);
    stack.push(...adding);
  }
  return false;
}

function write(
  writer: InlineWriter,
  nodes: JSONContent[],
  encoded: string[],
  parentNode: JSONContent | undefined,
  level: number,
  ends: Array<Map<string, number>>,
  plan: Plan,
): string {
  // The Markdown in pieces: each piece is read at its ends only, so writing stays linear.
  const out: string[] = [];
  const stack: Open[] = [];
  /** Closes the stack down to `depth`, moving trailing whitespace outside the closers. */
  const closeTo = (depth: number) => {
    if (stack.length <= depth) return;
    let trailing = "";
    while (out.length > 0) {
      const last = out[out.length - 1]!;
      let cut = last.length;
      while (cut > 0 && /\s/.test(last[cut - 1]!)) cut -= 1;
      trailing = last.slice(cut) + trailing;
      if (cut > 0) {
        out[out.length - 1] = last.slice(0, cut);
        break;
      }
      out.pop();
    }
    while (stack.length > depth) out.push(stack.pop()!.close);
    if (trailing !== "") out.push(trailing);
  };
  const open = (mark: Mark) => {
    const delimiter = DELIMITERS[mark.type];
    if (delimiter) {
      const choice = plan.underscore[mark.type];
      const underscore = choice === "always" || (choice === "adjacent" && (out.at(-1) ?? "").endsWith("*"));
      const run = underscore ? delimiter.other : delimiter.usual;
      out.push(run);
      stack.push({ mark, close: run });
    } else {
      out.push(writer.getMarkOpening(mark.type, mark));
      stack.push({ mark, close: writer.getMarkClosing(mark.type, mark) });
    }
  };

  nodes.forEach((node, i) => {
    if (!isText(node)) {
      closeTo(0);
      out.push(writer.renderNodeToMarkdown(node, parentNode, i, level));
      return;
    }
    const text = encoded[i]!;
    const held = new Set((node.marks ?? []).map(key));
    // Whitespace alone opens no mark (the library drops it there too).
    const blank = text.trim() === "";
    const below = stack.findIndex((entry) => !held.has(key(entry.mark)));
    if (below !== -1) closeTo(below);
    const onStack = new Set(stack.map((entry) => key(entry.mark)));
    const adding = blank ? [] : distinct(node.marks ?? []).filter((mark) => !onStack.has(key(mark)));
    const sign = plan.outer === "longest" ? -1 : 1;
    adding.sort((a, b) => sign * (ends[i]!.get(key(a))! - ends[i]!.get(key(b))!));
    let body = text;
    if (adding.length > 0) {
      const leading = /^\s*/.exec(body)![0];
      if (leading !== "") out.push(leading);
      body = body.slice(leading.length);
      for (const mark of adding) open(mark);
    }
    if (body !== "") out.push(body);
  });
  closeTo(0);
  return out.join("");
}
