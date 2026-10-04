import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Gary's copy rules (2026-10-03) for everything the connector says to a person or to the AI that
 * works for them: American English, no exclamation marks, no em dashes, no hype words, plain words
 * ("please" and "successfully" are not used). `src/lib/mcp/` is guarded here, the way the app's own
 * copy is in marketing-copy.test.ts. The strings are read with the TypeScript parser, so an
 * identifier such as `cancelled` is never flagged.
 */

const ROOT = process.cwd();
const DIR = "src/lib/mcp";

function walk(path: string, out: string[] = []): string[] {
  const full = resolve(ROOT, path);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path)) out.push(path);
  return out;
}

interface Copy {
  file: string;
  line: number;
  text: string;
}

function copyIn(file: string): Copy[] {
  const source = readFileSync(resolve(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Copy[] = [];
  const add = (raw: string, node: ts.Node) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{3}/.test(text)) return;
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      add(node.text, node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const files = walk(DIR);
const copy = files.flatMap(copyIn);
const where = (items: Copy[]) =>
  items.map((item) => `${item.file}:${item.line}: ${item.text.slice(0, 100)}`);

const BRITISH = new RegExp(
  [
    String.raw`\b\w*(colour|favour|behaviour|neighbour|honour|humour|flavour)\w*\b`,
    String.raw`\b(centre|centres|centred|centring)\b`,
    String.raw`\b(organis|customis|personalis|optimis|recognis|summaris|initialis|authoris|normalis|serialis|minimis|maximis|categoris|prioritis|utilis|specialis|synchronis)(e|ed|es|ing|ation|ations|er|ers|able)\b`,
    String.raw`\b(analyse|analysed|analysing|cancelled|cancelling|labelled|labelling|travelled|travelling|modelled|modelling|grey|greys|licence|licences|pretence|pretences|defence|offence|practise|catalogue|dialogue|programme|whilst|amongst|towards|learnt|judgement|ageing|instalment)\b`,
  ].join("|"),
  "i",
);
const HYPE =
  /amazing|powerful|seamless|revolutionary|game-?chang|supercharge|unlock|effortless|stunning|ultimate|best-in-class|cutting-edge|10x/i;

describe("copy rules for src/lib/mcp", () => {
  it("finds the strings of the connector", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(copy.length).toBeGreaterThan(100);
    expect(copy.some((item) => item.text.includes("Changes the draft only."))).toBe(true);
  });

  it("uses American English", () => {
    expect(where(copy.filter((item) => BRITISH.test(item.text)))).toEqual([]);
  });

  it("has no exclamation marks and no em dashes", () => {
    expect(where(copy.filter((item) => /!/.test(item.text)))).toEqual([]);
    expect(where(copy.filter((item) => /—/.test(item.text)))).toEqual([]);
  });

  it("has no hype words, no please and no successfully", () => {
    expect(where(copy.filter((item) => HYPE.test(item.text)))).toEqual([]);
    expect(where(copy.filter((item) => /\bplease\b|\bsuccessfully\b/i.test(item.text)))).toEqual(
      [],
    );
  });
});
