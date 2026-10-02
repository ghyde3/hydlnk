import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M2-03 static check: the editor reads and writes drafts with the signed-in user's session under
 * RLS. No module of the editor route, nor any module the editor owns (src/components/editor,
 * src/lib/editor), imports the server-only secret-key client or the server env that holds the key.
 * (Shared gate modules such as @/lib/pages/context sit outside these folders and are covered by
 * their own reviews: they read with the user's session too.)
 */

const ROOT = process.cwd();
const EDITOR_DIRS = [
  "src/app/(editor)/app/(screens)/editor",
  "src/components/editor",
  "src/lib/editor",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const files = EDITOR_DIRS.flatMap((dir) => sourceFiles(resolve(ROOT, dir)));

const GATE_ACCOUNT_REPAIR = "src/lib/auth/accounts.ts";

const FORBIDDEN: [RegExp, string][] = [
  [/@\/lib\/supabase\/admin/, "the secret-key Supabase client"],
  [/createAdminSupabase/, "createAdminSupabase"],
  [/@\/lib\/env\/server/, "the server env (it holds the secret key)"],
  [/SUPABASE_SECRET_KEY/, "SUPABASE_SECRET_KEY"],
  [/supabase\/admin/, "the admin client by a relative path"],
];

describe("M2-03: the editor never uses the secret-key client", () => {
  it("finds the editor's modules", () => {
    const names = files.map((file) => relative(ROOT, file));
    expect(names).toContain("src/app/(editor)/app/(screens)/editor/page.tsx");
    expect(names).toContain("src/lib/editor/page-data.ts");
    expect(names).toContain("src/components/editor/editor-screen.tsx");
  });

  it.each(files.map((file) => [relative(ROOT, file), file]))("%s", (_name, file) => {
    const source = readFileSync(file as string, "utf8");
    for (const [pattern, what] of FORBIDDEN) {
      expect(pattern.test(source), `imports ${what}`).toBe(false);
    }
  });

  it("no module the editor page reaches through its imports uses the secret-key client, except behind the Publish Server Action", () => {
    // Follow every static import from the editor route (the page, the screen, the gate modules it
    // calls), not just the files in the editor folders. A "use server" module is a boundary: it runs
    // on the server only and may use the secret key (that is what Publish is), so it is listed, not
    // entered. Nothing else may reach the admin client.
    const resolveImport = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/")
        ? resolve(ROOT, "src", spec.slice(2))
        : spec.startsWith(".")
          ? resolve(from, "..", spec)
          : null;
      if (!base) return null;
      for (const candidate of [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
        base,
      ]) {
        try {
          if (statSync(candidate).isFile()) return candidate;
        } catch {
          /* try the next form */
        }
      }
      return null;
    };
    const seen = new Set<string>();
    const boundaries = new Set<string>();
    const queue = [resolve(ROOT, "src/app/(editor)/app/(screens)/editor/page.tsx")];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      if (/^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use server["']/.test(source)) {
        boundaries.add(relative(ROOT, file));
        continue;
      }
      // The Milestone 1 gate (getAppContext) re-creates a missing account row with the secret key,
      // the id taken from the verified session (M1-05). Not editor code; named here so a second
      // path to the admin client cannot appear unnoticed.
      if (relative(ROOT, file) === GATE_ACCOUNT_REPAIR) {
        boundaries.add(GATE_ACCOUNT_REPAIR);
        continue;
      }
      // Comments may mention the server env ("for the secret key use ..."): only code counts.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const [pattern, what] of FORBIDDEN) {
        expect(pattern.test(code), `${relative(ROOT, file)} imports ${what}`).toBe(false);
      }
      const specs = [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
        (m) => m[1]!,
      );
      for (const spec of specs) {
        const next = resolveImport(file, spec);
        if (next) queue.push(next);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect([...boundaries].sort()).toEqual([GATE_ACCOUNT_REPAIR, "src/lib/publish/actions.ts"]);
  });

  it("loads the draft with the user's session (the server client)", () => {
    const loader = readFileSync(resolve(ROOT, "src/lib/editor/page-data.ts"), "utf8");
    expect(loader).toContain("@/lib/supabase/server");
    expect(loader).toContain("createServerSupabase");
    const page = readFileSync(
      resolve(ROOT, "src/app/(editor)/app/(screens)/editor/page.tsx"),
      "utf8",
    );
    expect(page).toContain("getAppContext");
    expect(page).toContain("loadEditorPageData");
  });

  it("writes drafts from the browser with the publishable-key client", () => {
    const saver = readFileSync(resolve(ROOT, "src/lib/editor/save-client.ts"), "utf8");
    expect(saver).toContain("@/lib/supabase/browser");
  });
});
