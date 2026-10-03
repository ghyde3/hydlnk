import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Gary's copy rules (2026-10-03), enforced on the source. Everything a visitor can read on the
 * marketing site, and the user-facing strings of the editor, design, themes, blocks, billing and
 * auth UI, must be American English, free of exclamation marks and em dashes, and (on the
 * marketing site) free of the product's insides: tokens, renderers, schemas and the like.
 *
 * The strings are read with the TypeScript parser (string literals, template text and JSX text),
 * so identifiers such as `aria-labelledby` or a variable called `cancelled` are never flagged.
 */

const ROOT = process.cwd();

const MARKETING = ["src/app/(marketing)", "src/components/marketing"];
const APP_UI = [
  "src/components/editor",
  "src/components/design",
  "src/components/themes",
  "src/components/blocks",
  "src/components/billing",
  "src/components/auth",
  "src/lib/themes",
  "src/lib/design",
  "src/lib/media",
  "src/lib/publish",
  "src/lib/error-copy.ts",
];

/** Legal text names real mechanisms (a cookie called sb-...-auth-token, a one-way hash). */
const LEGAL = ["privacy/page.tsx", "terms/page.tsx"];

function walk(path: string, out: string[]): string[] {
  const stat = statSync(resolve(ROOT, path));
  if (stat.isDirectory()) {
    for (const name of readdirSync(resolve(ROOT, path))) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path)) {
    out.push(path);
  }
  return out;
}

const marketingFiles = MARKETING.flatMap((root) => walk(root, []));
const appFiles = APP_UI.flatMap((root) => walk(root, []));

/** Text-like strings in a source file: what a person might read, not class lists or ids. */
const CLASS_NAME_CHARS = /^[\w\-:[\]/.()#%@!>&*+~=,|^$ '"]+$/;
const TAILWIND =
  /(^| )(flex|grid|text-|bg-|border|min-|max-|px-|py-|mt-|mb-|ml-|mr-|gap-|items-|justify-|rounded|font-|w-|h-|size-|overflow|absolute|relative|sr-only|inline|block|hidden|shrink|col-|row-|hl:|group|hover:|focus|motion-|aria-|whitespace|leading-|tracking-|underline|decoration|self-|place-|order-|z-|inset-|top-|left-|right-|bottom-|opacity|shadow|ring|outline|transition|cursor|pointer|select|list-|space-|divide|break-|truncate|uppercase|lowercase|capitalize|normal|italic|not-|prose|first:|last:|odd:|even:)/;
const TEXT_ATTRIBUTES = new Set(["alt", "aria-label", "title", "placeholder", "label", "hint"]);

interface Copy {
  file: string;
  line: number;
  text: string;
}

function copyIn(file: string): Copy[] {
  const source = readFileSync(resolve(ROOT, file), "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Copy[] = [];
  const add = (raw: string, node: ts.Node) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{2}/.test(text)) return;
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      add(node.text, node);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const skip =
        (ts.isJsxAttribute(parent) && !TEXT_ATTRIBUTES.has(parent.name.getText())) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        ts.isElementAccessExpression(parent) ||
        ts.isCaseClause(parent) ||
        ts.isLiteralTypeNode(parent) ||
        /^(use client|use server)$/.test(node.text) ||
        // A single word with no capital or sentence mark is an id, a key or a path, not copy.
        (!/\s/.test(node.text) && node.text.length < 40 && !/^[A-Z]/.test(node.text)) ||
        (CLASS_NAME_CHARS.test(node.text) && TAILWIND.test(node.text) && !/[.!?]$/.test(node.text));
      if (!skip) add(node.text, node);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const classes = CLASS_NAME_CHARS.test(node.text) && TAILWIND.test(node.text);
      if (!classes) add(node.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const marketingCopy = marketingFiles.flatMap(copyIn);
const appCopy = appFiles.flatMap(copyIn);
const allCopy = [...marketingCopy, ...appCopy];

const where = (items: Copy[]) => items.map((c) => `${c.file}:${c.line}: ${c.text.slice(0, 120)}`);

/** British spellings, matched as whole words so identifiers like labelledBy never trip it. */
const BRITISH = new RegExp(
  [
    String.raw`\b\w*(colour|favour|behaviour|neighbour|honour|humour|flavour)\w*\b`,
    String.raw`\b(centre|centres|centred|centring)\b`,
    String.raw`\b(organis|customis|personalis|optimis|recognis|summaris|initialis|authoris|normalis|serialis|minimis|maximis|categoris|prioritis|utilis|specialis|synchronis)(e|ed|es|ing|ation|ations|er|ers|able)\b`,
    String.raw`\b(analyse|analysed|analysing|cancelled|cancelling|labelled|labelling|travelled|travelling|modelled|modelling|grey|greys|licence|licences|pretence|pretences|defence|offence|practise|catalogue|dialogue|programme|whilst|amongst|towards|learnt|judgement|ageing|instalment)\b`,
  ].join("|"),
  "i",
);

/** What the marketing site must not say: the product's insides, in words nobody asked for. */
const JARGON =
  /\btokens?\b|\bschema\b|\brenderer?\b|\brenders?\b|\bCSS\b|\bRLS\b|\bJSON\b|hydrat|\bresolv|theme system|\bAPI\b|\bbeacon\b|user agent|\bhash\b|cached at the edge|commerce fees/i;

const HYPE =
  /amazing|powerful|seamless|revolutionary|game-?chang|supercharge|unlock|effortless|stunning|ultimate|best-in-class|cutting-edge|10x/i;

describe("copy rules: what is scanned", () => {
  it("finds the copy of the marketing site and the app UI", () => {
    expect(marketingFiles.length).toBeGreaterThan(40);
    expect(appFiles.length).toBeGreaterThan(40);
    expect(marketingCopy.length).toBeGreaterThan(1000);
    expect(appCopy.length).toBeGreaterThan(200);
    // A string the rules below must be able to see: the headline of the home page.
    expect(allCopy.some((c) => c.text.includes("Designed like"))).toBe(true);
  });
});

describe("copy rules: American English", () => {
  it("has no British spellings in any source file's comments or text", () => {
    const hits: string[] = [];
    for (const file of [...marketingFiles, ...appFiles]) {
      readFileSync(resolve(ROOT, file), "utf8")
        .split("\n")
        // sharp's gravity name is "centre" (a library value, not copy).
        .filter((line) => !line.includes('position: "centre"'))
        .forEach((line, index) => {
          if (BRITISH.test(line)) hits.push(`${relative(".", file)}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("writes dates the American way (October 2, 2026)", () => {
    const day =
      /\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/;
    expect(where(allCopy.filter((c) => day.test(c.text)))).toEqual([]);
  });
});

describe("copy rules: tone", () => {
  it("has no exclamation marks, and no em dashes except the pinned page title", () => {
    expect(where(allCopy.filter((c) => /!/.test(c.text)))).toEqual([]);
    const dashes = allCopy.filter((c) => /—/.test(c.text) && !/^HYDLNK — Link in bio/.test(c.text));
    // A lone dash is a table cell that means "none".
    expect(where(dashes.filter((c) => c.text !== "—"))).toEqual([]);
  });

  it("has no hype words", () => {
    expect(where(allCopy.filter((c) => HYPE.test(c.text)))).toEqual([]);
  });
});

describe("copy rules: plain words on the marketing site", () => {
  it("does not talk about tokens, renderers, schemas or the like", () => {
    const pages = marketingCopy.filter((c) => !LEGAL.some((legal) => c.file.endsWith(legal)));
    expect(where(pages.filter((c) => JARGON.test(c.text)))).toEqual([]);
  });

  it("never says the Design screen's tab is called Tokens", () => {
    expect(
      where(appCopy.filter((c) => /^Tokens$|Theme tokens|page-level tokens/i.test(c.text))),
    ).toEqual([]);
  });
});
