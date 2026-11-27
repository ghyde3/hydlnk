import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * A small TypeScript-AST reader for the static guards (m19-access-static, m19t-activity-limit-static):
 * which named function a call sits in, and whether that same function calls something. Comments and
 * `import type` never count, because only real call expressions are read.
 */

export const ROOT = process.cwd();

/** Every .ts/.tsx file under src/, as a path relative to the repo root (generated types left out). */
export function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  return walk(join(ROOT, "src"))
    .map((file) => relative(ROOT, file))
    .filter((file) => !file.endsWith("database.types.ts"));
}

export const readSource = (file: string) => readFileSync(join(ROOT, file), "utf8");

export function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function unwrap(node: ts.Expression): ts.Expression {
  let e = node;
  while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

/**
 * A named function: a declaration or method with a name, an arrow / function expression assigned to
 * a variable or an object property, or one passed straight to a call that initializes a variable
 * (`const suspendAccount = defineAction("x", async () => ...)`, named suspendAccount). Any other
 * anonymous callback (`.map(async (x) => ...)`) belongs to the named function around it.
 */
function wrapperVariable(node: ts.Node): ts.VariableDeclaration | null {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.includes(node as ts.Expression)) return null;
  const decl = call.parent;
  return decl && ts.isVariableDeclaration(decl) && decl.initializer === call ? decl : null;
}

function isNamedFunction(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    return node.name !== undefined;
  }
  if (ts.isConstructorDeclaration(node)) return true;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (wrapperVariable(node)) return true;
    return (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.name !== undefined;
  }
  return false;
}

function ownName(node: ts.Node, sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const wrapper = wrapperVariable(node);
    if (wrapper) return wrapper.name.getText(sf);
    return (node.parent as ts.VariableDeclaration | ts.PropertyAssignment).name.getText(sf);
  }
  return (node as ts.FunctionDeclaration).name!.getText(sf);
}

/** The nearest named function around `node`, or the source file (module scope). */
export function enclosingFunction(node: ts.Node): ts.Node {
  for (let p = node.parent; p; p = p.parent) if (isNamedFunction(p)) return p;
  return node.getSourceFile();
}

/** `outer.inner` for nested named functions, `<module>` at the top level. */
export function functionName(fn: ts.Node, sf: ts.SourceFile): string {
  if (ts.isSourceFile(fn)) return "<module>";
  const names: string[] = [];
  for (let p: ts.Node | undefined = fn; p; p = p.parent) if (isNamedFunction(p)) names.unshift(ownName(p, sf));
  return names.join(".");
}

/** The name a call is made by: `f(...)` is f, `a.b.f(...)` is f. */
export function calleeName(call: ts.CallExpression): string | null {
  const e = unwrap(call.expression);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

/** Every call expression in the file. */
export function calls(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** True when `fn` itself (not a named function inside it) calls one of `names`. */
export function functionCalls(fn: ts.Node, all: readonly ts.CallExpression[], names: ReadonlySet<string>): boolean {
  return all.some((call) => {
    const name = calleeName(call);
    return name !== null && names.has(name) && enclosingFunction(call) === fn;
  });
}
