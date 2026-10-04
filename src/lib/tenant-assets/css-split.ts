/**
 * A small CSS reader, splitter and minifier for the live page's inline stylesheet (M8-02). It
 * exists so the page can carry only the rules it needs, from the same two source files the editor
 * preview imports (`src/app/(tenant)/tenant.css`, `src/components/page/page-renderer.css`), with no
 * second copy to keep in step.
 *
 * It reads what those files contain and nothing more: comments, qualified rules with a flat list of
 * declarations, and the group at-rules (`@container`, `@media`, `@supports`), `@keyframes` and bare
 * statements. CSS nesting, `@font-face` and `@import` are not used there, so the parser refuses
 * nesting loudly instead of guessing.
 */

export type CssNode =
  | { kind: "rule"; selectors: string[]; decls: string }
  | { kind: "group"; name: string; prelude: string; children: CssNode[] }
  | { kind: "statement"; text: string };

interface Cursor {
  src: string;
  i: number;
}

function skipTrivia(c: Cursor): void {
  for (;;) {
    while (c.i < c.src.length && /\s/.test(c.src[c.i]!)) c.i++;
    if (c.src.startsWith("/*", c.i)) {
      const end = c.src.indexOf("*/", c.i + 2);
      c.i = end < 0 ? c.src.length : end + 2;
    } else return;
  }
}

/** Copies a quoted string starting at `c.i` (the opening quote), escapes included. */
function readString(c: Cursor): string {
  const quote = c.src[c.i]!;
  let out = quote;
  c.i++;
  while (c.i < c.src.length) {
    const char = c.src[c.i]!;
    out += char;
    c.i++;
    if (char === "\\" && c.i < c.src.length) {
      out += c.src[c.i]!;
      c.i++;
    } else if (char === quote) break;
  }
  return out;
}

/**
 * Reads text up to the first of `stops` outside parentheses, brackets, strings and comments.
 * Comments are dropped. The stop character is left unread.
 */
function readUntil(c: Cursor, stops: string): string {
  let out = "";
  let depth = 0;
  while (c.i < c.src.length) {
    const char = c.src[c.i]!;
    if (char === "/" && c.src[c.i + 1] === "*") {
      const end = c.src.indexOf("*/", c.i + 2);
      c.i = end < 0 ? c.src.length : end + 2;
      out += " ";
      continue;
    }
    if (char === '"' || char === "'") {
      out += readString(c);
      continue;
    }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth <= 0 && stops.includes(char)) break;
    out += char;
    c.i++;
  }
  return out;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Splits at top-level commas (not inside parentheses, brackets or strings). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"' || char === "'") {
      const c: Cursor = { src: text, i };
      readString(c);
      i = c.i - 1;
    } else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function minifySelector(selector: string): string {
  return collapse(selector).replace(/ ?> ?/g, ">");
}

/**
 * A declaration value with its whitespace squeezed: one space between words, none after `(` or a
 * comma or before `)` or a comma, strings left exactly as written.
 */
function minifyValue(value: string): string {
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === '"' || char === "'") {
      const c: Cursor = { src: value, i };
      const text = readString(c);
      if (pendingSpace && out !== "" && !/[(,]$/.test(out)) out += " ";
      pendingSpace = false;
      out += text;
      i = c.i - 1;
    } else if (/\s/.test(char)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && out !== "" && !/[(,]$/.test(out) && char !== ")" && char !== ",") {
        out += " ";
      }
      pendingSpace = false;
      out += char;
    }
  }
  return out.replace(/ ?!important$/i, "!important");
}

function minifyDecls(body: string): string {
  const out: string[] = [];
  for (const raw of splitTopLevel(body, ";")) {
    const decl = raw.trim();
    if (decl === "") continue;
    const colon = decl.indexOf(":");
    if (colon < 0) throw new Error(`Not a declaration: ${collapse(decl)}`);
    out.push(`${collapse(decl.slice(0, colon))}:${minifyValue(decl.slice(colon + 1))}`);
  }
  return out.join(";");
}

function parseNodes(c: Cursor, nested: boolean): CssNode[] {
  const nodes: CssNode[] = [];
  for (;;) {
    skipTrivia(c);
    if (c.i >= c.src.length) {
      if (nested) throw new Error("Unclosed block in CSS");
      return nodes;
    }
    if (c.src[c.i] === "}") {
      if (!nested) throw new Error("Unexpected } in CSS");
      c.i++;
      return nodes;
    }
    const prelude = collapse(readUntil(c, "{;}"));
    const stop = c.src[c.i];
    if (stop === ";") {
      c.i++;
      nodes.push({ kind: "statement", text: prelude });
      continue;
    }
    if (stop !== "{") throw new Error(`Unexpected end of rule: ${prelude}`);
    c.i++;
    if (prelude.startsWith("@")) {
      const name = /^@([a-z-]+)/i.exec(prelude)?.[1]?.toLowerCase() ?? "";
      if (name === "font-face" || name === "property" || name === "page") {
        throw new Error(`@${name} is not supported by the inline CSS splitter`);
      }
      nodes.push({ kind: "group", name, prelude, children: parseNodes(c, true) });
      continue;
    }
    const body = readUntil(c, "{}");
    if (c.src[c.i] === "{") throw new Error(`CSS nesting is not supported: ${prelude}`);
    c.i++;
    nodes.push({
      kind: "rule",
      selectors: splitTopLevel(prelude, ",").map(minifySelector).filter(Boolean),
      decls: minifyDecls(body),
    });
  }
}

export function parseCss(css: string): CssNode[] {
  return parseNodes({ src: css, i: 0 }, false);
}

/** Keeps the selectors `keepSelector` accepts; a rule left with none, and a group left empty, go. */
export function filterCss(
  nodes: readonly CssNode[],
  keepSelector: (selector: string) => boolean,
): CssNode[] {
  return pruneKeyframes(filterNodes(nodes, keepSelector));
}

function filterNodes(
  nodes: readonly CssNode[],
  keepSelector: (selector: string) => boolean,
): CssNode[] {
  const out: CssNode[] = [];
  for (const node of nodes) {
    if (node.kind === "statement") out.push(node);
    else if (node.kind === "rule") {
      const selectors = node.selectors.filter(keepSelector);
      if (selectors.length > 0) out.push({ ...node, selectors });
    } else if (node.name === "keyframes") {
      out.push(node);
    } else {
      const children = filterNodes(node.children, keepSelector);
      if (children.length > 0) out.push({ ...node, children });
    }
  }
  return out;
}

/** Drops `@keyframes` that no kept declaration names (the animations of a block the page lacks). */
function pruneKeyframes(nodes: CssNode[]): CssNode[] {
  const used = new Set<string>();
  const collect = (list: readonly CssNode[]) => {
    for (const node of list) {
      if (node.kind === "rule") {
        for (const match of node.decls.matchAll(/animation(?:-name)?:([^;]*)/g)) {
          for (const word of match[1]!.split(/[\s,]+/)) used.add(word);
        }
      } else if (node.kind === "group" && node.name !== "keyframes") collect(node.children);
    }
  };
  collect(nodes);
  const prune = (list: readonly CssNode[]): CssNode[] => {
    const kept: CssNode[] = [];
    for (const node of list) {
      if (node.kind === "group" && node.name === "keyframes") {
        const name = node.prelude.replace(/^@keyframes\s+/i, "");
        if (used.has(name)) kept.push(node);
      } else if (node.kind === "group") {
        const children = prune(node.children);
        if (children.length > 0) kept.push({ ...node, children });
      } else kept.push(node);
    }
    return kept;
  };
  return prune(nodes);
}

export function serializeCss(nodes: readonly CssNode[]): string {
  let css = "";
  for (const node of nodes) {
    if (node.kind === "statement") css += `${node.text};`;
    else if (node.kind === "rule") css += `${node.selectors.join(",")}{${node.decls}}`;
    else {
      const prelude = node.prelude.replace(/:\s+/g, ":");
      css += `${prelude}{${serializeCss(node.children)}}`;
    }
  }
  return css;
}
