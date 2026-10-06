import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Source scans of the authorization server (Wave L): rules that hold across files and that a single
 * unit test cannot see. Each reads the TypeScript with the compiler's parser, so a word in a comment or
 * a string is never mistaken for code.
 */

const ROOT = process.cwd();

function walk(path: string, out: string[] = []): string[] {
  let stat;
  try {
    stat = statSync(resolve(ROOT, path));
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    for (const name of readdirSync(resolve(ROOT, path))) walk(join(path, name), out);
  } else if (/\.tsx?$/.test(path)) {
    out.push(path);
  }
  return out;
}

const OAUTH_LIB = walk("src/lib/oauth");
const MCP_LIB = walk("src/lib/mcp");
const OAUTH_ROUTES = [
  ...walk("src/app/(editor)/app/oauth"),
  ...walk("src/app/(editor)/app/.well-known"),
  ...walk("src/app/(editor)/app/mcp"),
];
const OAUTH_UI = [
  ...walk("src/components/oauth"),
  ...walk("src/components/settings").filter((file) => /connected-apps/.test(file)),
];
const WAVE_FILES = [...OAUTH_LIB, ...MCP_LIB, ...OAUTH_ROUTES, ...OAUTH_UI];
const ALL_SRC = walk("src");

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(resolve(ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, fn: (node: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

/** The source of a file with its comments removed (a word in a comment is not code). */
function code(file: string): string {
  const source = readFileSync(resolve(ROOT, file), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const SAFE_FETCH = "src/lib/oauth/safe-fetch.ts";

describe("M10-07 the one fetch", () => {
  it("finds the wave's modules", () => {
    expect(OAUTH_LIB.length).toBeGreaterThan(15);
    expect(OAUTH_LIB).toContain(SAFE_FETCH);
  });

  it("only safe-fetch.ts calls fetch, https.request, http.request or dns in src/lib/oauth and src/lib/mcp", () => {
    const offenders: string[] = [];
    for (const file of [...OAUTH_LIB, ...MCP_LIB].filter((f) => f !== SAFE_FETCH)) {
      const sf = parse(file);
      visit(sf, (node) => {
        if (ts.isCallExpression(node)) {
          const text = node.expression.getText(sf);
          if (/^(globalThis\.|window\.)?fetch$/.test(text)) offenders.push(`${file}: ${text}(`);
          if (/^(https?|http2)\.(request|get)$/.test(text)) offenders.push(`${file}: ${text}(`);
          if (/^dns(\.|$)/.test(text)) offenders.push(`${file}: ${text}(`);
        }
        if (ts.isImportDeclaration(node)) {
          const name = (node.moduleSpecifier as ts.StringLiteral).text;
          if (/^node:(https?|http2|dns|tls)$/.test(name)) offenders.push(`${file}: import ${name}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the OAuth routes and components never fetch a URL either", () => {
    const offenders: string[] = [];
    for (const file of [...OAUTH_ROUTES, ...OAUTH_UI]) {
      const sf = parse(file);
      visit(sf, (node) => {
        if (
          ts.isCallExpression(node) &&
          /^(globalThis\.)?fetch$/.test(node.expression.getText(sf))
        ) {
          offenders.push(file);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the token, refresh and revoke paths do not import the fetch module", () => {
    for (const file of [
      "src/lib/oauth/token.ts",
      "src/lib/oauth/revoke.ts",
      "src/lib/oauth/register.ts",
      "src/lib/oauth/consent.ts",
      "src/lib/oauth/verify.ts",
    ]) {
      expect(readFileSync(resolve(ROOT, file), "utf8"), file).not.toMatch(/safe-fetch|cimd|logo/);
    }
  });

  it("certificate checking is never switched off anywhere in src", () => {
    const offenders = ALL_SRC.filter((file) =>
      /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(code(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("the end-to-end stub exception exists in exactly one place, and the fetch gate reads testHooksEnabled", () => {
    const places = ALL_SRC.filter((file) =>
      /12113/.test(readFileSync(resolve(ROOT, file), "utf8")),
    );
    expect(places).toEqual(["src/lib/oauth/ssrf.ts"]);
    expect(code(SAFE_FETCH)).toContain("testHooksEnabled");
    expect(code("src/lib/oauth/cimd.ts")).toContain("testHooksEnabled");
  });
});

describe("M10-06 one redirect comparison", () => {
  /** A side that is no address: null, undefined, a number or a string that is not a URL. */
  const literal = (side: ts.Expression) =>
    side.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(side) && side.text === "undefined") ||
    (ts.isStringLiteral(side) && !/^https?:/.test(side.text)) ||
    ts.isNumericLiteral(side);

  it("nothing in src/lib/oauth or src/app compares a redirect URI but redirect-uri.ts", () => {
    const files = [...OAUTH_LIB, ...walk("src/app")].filter(
      (f) => f !== "src/lib/oauth/redirect-uri.ts",
    );
    const offenders: string[] = [];
    for (const file of files) {
      const sf = parse(file);
      visit(sf, (node) => {
        if (
          ts.isBinaryExpression(node) &&
          /^(===|!==|==|!=)$/.test(node.operatorToken.getText(sf))
        ) {
          const text = `${node.left.getText(sf)} ${node.right.getText(sf)}`;
          const names =
            /redirect[_]?uri|redirectUri/i.test(text) && !/redirect_?uris?\.length/i.test(text);
          // Existence checks against null, undefined or a marker string are not comparisons of two addresses.
          const twoAddresses = !literal(node.left) && !literal(node.right);
          const againstUrl = [node.left, node.right].some(
            (side) => ts.isStringLiteral(side) && /^https?:/.test(side.text),
          );
          if (names && (twoAddresses || againstUrl))
            offenders.push(`${file}: ${node.getText(sf).slice(0, 80)}`);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          const target = node.expression.expression.getText(sf);
          if (
            (method === "includes" || method === "indexOf") &&
            /redirect_uris|redirectUris/.test(target)
          ) {
            offenders.push(`${file}: ${node.getText(sf).slice(0, 80)}`);
          }
          if (
            method === "includes" &&
            node.arguments.some((arg) => /redirect_?uri|redirectUri/i.test(arg.getText(sf)))
          ) {
            offenders.push(`${file}: ${node.getText(sf).slice(0, 80)}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("M10-15 no weak randomness", () => {
  it("Math.random appears nowhere in src/lib/oauth or src/lib/mcp", () => {
    const offenders = [...OAUTH_LIB, ...MCP_LIB].filter((file) => /Math\.random/.test(code(file)));
    expect(offenders).toEqual([]);
  });
});

describe("M10-02 bearer credentials, never cookies", () => {
  it("no response of the wave carries Access-Control-Allow-Credentials (deleting the header is fine)", () => {
    const offenders: string[] = [];
    for (const file of ALL_SRC) {
      const sf = parse(file);
      visit(sf, (node) => {
        if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return;
        if (!/access-control-allow-credentials/i.test(node.text)) return;
        const parent = node.parent;
        const deleting =
          ts.isCallExpression(parent) &&
          ts.isPropertyAccessExpression(parent.expression) &&
          parent.expression.name.text === "delete";
        if (!deleting) offenders.push(file);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("M10-12 no return-URL parameter is read", () => {
  it("the OAuth code reads no next, return_to or redirect_to", () => {
    const offenders = [...OAUTH_LIB, ...OAUTH_ROUTES, ...OAUTH_UI].filter((file) =>
      /["'`](next|return_to|redirect_to|returnTo)["'`]/.test(code(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("the sign-in pages still read no return address", () => {
    for (const file of [
      "src/lib/auth/gate.ts",
      "src/app/(editor)/app/login/page.tsx",
      "src/lib/auth/callback.ts",
    ]) {
      expect(code(file), file).not.toMatch(/["'`](return_to|redirect_to|returnTo)["'`]/);
    }
  });
});

describe("M10-17 nothing secret is logged", () => {
  const BANNED =
    /^(token|accesstoken|refreshtoken|bearer|code|verifier|codeverifier|secret|clientsecret|csrf|csrfvalue|authorization|cookie|cookies|password|resumeid)$/i;
  const WHOLE = /^(request|req|response|res|headers|body|form|fields|params|formdata)$/i;

  it("no console call mentions a variable named token, code, verifier, secret, csrf, authorization or cookie, or logs a request as a whole", () => {
    const offenders: string[] = [];
    for (const file of WAVE_FILES) {
      const sf = parse(file);
      visit(sf, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (!/^console\.(log|info|warn|error|debug|trace)$/.test(node.expression.getText(sf)))
          return;
        for (const arg of node.arguments) {
          visit(arg, (inner) => {
            if (!ts.isIdentifier(inner)) return;
            const parent = inner.parent;
            // A property name on the right of a dot (`error.message`) is judged on its own.
            if (ts.isPropertyAccessExpression(parent) && parent.name === inner) {
              if (BANNED.test(inner.text))
                offenders.push(`${file}: ${node.getText(sf).slice(0, 90)}`);
              return;
            }
            if (BANNED.test(inner.text) || WHOLE.test(inner.text)) {
              offenders.push(`${file}: ${node.getText(sf).slice(0, 90)}`);
            }
          });
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("console is called only from log.ts in src/lib/oauth, and from the named places elsewhere in the wave", () => {
    // The MCP route hands the runner a logger for the one-line `[mcp] tool=... ok=...` it builds itself.
    const allowed = new Set([
      "src/lib/oauth/log.ts",
      "src/components/settings/connected-apps-card.tsx",
      "src/app/(editor)/app/mcp/route.ts",
    ]);
    const callers: string[] = [];
    for (const file of [...OAUTH_LIB, ...OAUTH_ROUTES, ...OAUTH_UI]) {
      if (/console\.(log|info|warn|error|debug|trace)\(/.test(code(file))) callers.push(file);
    }
    expect(callers.filter((file) => !allowed.has(file))).toEqual([]);
  });
});

describe("M10-04 the user comes from the token row", () => {
  it("the OAuth verify module takes the user from the store row only", () => {
    const source = code("src/lib/oauth/verify.ts");
    expect(source).toContain("row.userId");
    expect(source).not.toMatch(/headers|cookies|searchParams/);
  });
});

describe("M10-18 the Connected apps card shows no secret or id", () => {
  it("never renders a token, a hash or a client id as text", () => {
    for (const file of [
      "src/components/settings/connected-apps-card.tsx",
      "src/components/settings/connected-apps-list.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/token|hash|clientId|client_id/i);
    }
  });

  it("the grant id is only ever the argument of the revoke call", () => {
    const list = code("src/components/settings/connected-apps-list.tsx");
    expect([...list.matchAll(/app\.id/g)].length).toBeGreaterThan(0);
    expect(list).not.toMatch(/data-grant|data-id|href=\{[^}]*app\.id/);
  });
});

describe("M10-02 the wave's public paths end in no static-file extension", () => {
  it("so the proxy matcher, which skips such paths, still sees every one of them", () => {
    for (const path of [
      "/mcp",
      "/oauth/token",
      "/oauth/register",
      "/oauth/revoke",
      "/oauth/authorize",
      "/oauth/consent",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      expect(path).not.toMatch(
        /\.(svg|png|jpe?g|gif|webp|avif|ico|css|js|map|txt|xml|webmanifest|woff2?|mp4|webm)$/,
      );
    }
  });
});
