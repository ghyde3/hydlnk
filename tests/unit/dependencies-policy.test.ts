import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { isClientModule, listFiles, rel, ROOT, walk } from "./support/module-graph";

/**
 * M9-14: the rules of CLAUDE.md's "Dependencies" section, held by tests. It reads files and
 * `node_modules` metadata only: no network, nothing built, no module of the app is run.
 *
 *   (a) the approved list in CLAUDE.md and package.json name the same packages (and versions);
 *   (b) every version is exact;
 *   (c) every direct dependency's license is on the allowlist, and the licenses of transitive
 *       packages outside it are printed for review;
 *   (d) no source file names a remote library or font host;
 *   and two boundaries of rule 1: what a public tenant page can reach, and what the marketing site can.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

interface Manifest {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}
const pkg = JSON.parse(read("package.json")) as Manifest;

// ---------------------------------------------------------------------------------------------
// (a) CLAUDE.md and package.json agree
// ---------------------------------------------------------------------------------------------

const claude = read("CLAUDE.md");

/** The text of the "## Dependencies" section: from its heading to the next "## ". */
function dependenciesSection(): string {
  const start = claude.indexOf("\n## Dependencies\n");
  if (start === -1) return "";
  const rest = claude.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next === -1 ? rest : rest.slice(0, next);
}

/** `name` version pairs: "- `name` 1.2.3: why" lines, and the one "Dev dependencies, one line:" line. */
function approvedList(section: string): { runtime: Map<string, string>; dev: Map<string, string> } {
  const runtime = new Map<string, string>();
  const dev = new Map<string, string>();
  for (const line of section.split("\n")) {
    const item = /^- `([^`]+)` (\d+\.\d+\.\d+)(?::|\s|$)/.exec(line);
    if (item) runtime.set(item[1]!, item[2]!);
    if (/^Dev dependencies, one line:/.test(line)) {
      for (const pair of line.matchAll(/`([^`]+)` (\d+\.\d+\.\d+)/g)) dev.set(pair[1]!, pair[2]!);
    }
  }
  return { runtime, dev };
}

const FIX = "Update the Dependencies section of CLAUDE.md (and ask Gary before installing a new library).";

describe("M9-14 CLAUDE.md has a Dependencies section with the five rules and the approved list", () => {
  const section = dependenciesSection();

  it("the section exists, after Invariants", () => {
    expect(section, "CLAUDE.md has no '## Dependencies' section").not.toBe("");
    expect(claude.indexOf("## Invariants")).toBeGreaterThan(-1);
    expect(claude.indexOf("## Invariants")).toBeLessThan(claude.indexOf("## Dependencies"));
  });

  it("states the five rules, one line each, with the substance the policy needs", () => {
    const rules = section.split("\n").filter((line) => /^[1-5]\. /.test(line));
    expect(rules).toHaveLength(5);
    expect(rules[0]).toMatch(/app and editor side/);
    expect(rules[0]).toMatch(/src\/lib\/tenant-render/);
    expect(rules[0]).toMatch(/Simple Icons/);
    expect(rules[1]).toMatch(/No library makes network calls/);
    expect(rules[1]).toMatch(/Sentry/);
    expect(rules[2]).toMatch(/MIT, ISC, BSD, Apache-2\.0, CC0-1\.0, 0BSD, OFL/);
    expect(rules[3]).toMatch(/Exact pinned versions/);
    expect(rules[4]).toMatch(/Gary's approval in chat/);
    expect(section).toMatch(/6\. The approved list/);
  });

  it("the names in its list equal the names in package.json dependencies and devDependencies, in both directions", () => {
    const { runtime, dev } = approvedList(section);
    const listed = [...runtime.keys(), ...dev.keys()].sort();
    const declared = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort();
    const missingFromList = declared.filter((name) => !listed.includes(name));
    const notInPackage = listed.filter((name) => !declared.includes(name));
    expect(missingFromList, `in package.json but not in the approved list. ${FIX}`).toEqual([]);
    expect(notInPackage, `in the approved list but not in package.json. ${FIX}`).toEqual([]);
  });

  it("runtime dependencies are listed as runtime and dev dependencies on the one line, each at the version package.json pins", () => {
    const { runtime, dev } = approvedList(section);
    expect([...runtime.keys()].sort(), `runtime list. ${FIX}`).toEqual(Object.keys(pkg.dependencies).sort());
    expect([...dev.keys()].sort(), `dev list. ${FIX}`).toEqual(Object.keys(pkg.devDependencies).sort());
    for (const [name, version] of runtime) expect(pkg.dependencies[name], `${name} version in CLAUDE.md. ${FIX}`).toBe(version);
    for (const [name, version] of dev) expect(pkg.devDependencies[name], `${name} version in CLAUDE.md. ${FIX}`).toBe(version);
  });

  it("the Wave K libraries are in the list at the approved versions", () => {
    const { runtime } = approvedList(section);
    const approved: Record<string, string> = {
      "lucide-react": "1.51.0",
      "simple-icons": "16.34.0",
      "@radix-ui/react-dropdown-menu": "2.1.24",
      "@radix-ui/react-dialog": "1.1.23",
      "react-colorful": "5.8.1",
      "react-easy-crop": "6.2.3",
      "react-email": "6.11.0",
      clsx: "2.1.1",
      "tailwind-merge": "3.7.0",
      "@sentry/nextjs": "11.4.0",
      "@tiptap/react": "3.31.4",
      "@tiptap/pm": "3.31.4",
      "@tiptap/starter-kit": "3.31.4",
      "@tiptap/extension-underline": "3.31.4",
      "@tiptap/extension-link": "3.31.4",
      "@tiptap/extension-text-align": "3.31.4",
    };
    for (const [name, version] of Object.entries(approved)) expect(runtime.get(name), name).toBe(version);
    // Only these two Radix components.
    expect([...runtime.keys()].filter((name) => name.startsWith("@radix-ui/")).sort()).toEqual([
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// (b) exact versions
// ---------------------------------------------------------------------------------------------

describe("M9-14 every version is exact", () => {
  it("each version in package.json matches ^\\d+\\.\\d+\\.\\d+$ (no ranges, no tags, no workspace:)", () => {
    const offenders = [
      ...Object.entries(pkg.dependencies).map(([name, version]) => ({ name, version, kind: "dependencies" })),
      ...Object.entries(pkg.devDependencies).map(([name, version]) => ({ name, version, kind: "devDependencies" })),
    ].filter(({ version }) => !/^\d+\.\d+\.\d+$/.test(version));
    expect(offenders.map(({ kind, name, version }) => `${kind}: ${name}@${version}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// (c) licenses
// ---------------------------------------------------------------------------------------------

/** What CLAUDE.md rule 3 allows. An SPDX expression passes when one alternative is on the list. */
const ALLOWED_LICENSES = new Set(["MIT", "ISC", "BSD", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "CC0-1.0", "0BSD", "OFL-1.1"]);

/** Direct dependencies that are on none of those lists, with why they are accepted (CLAUDE.md rule 3; Gary to confirm). */
const ACCEPTED_EXCEPTIONS: Record<string, { license: string; why: string }> = {
  isbot: { license: "Unlicense", why: "a public domain dedication, more permissive than MIT" },
  nodemailer: { license: "MIT-0", why: "MIT without the attribution clause, more permissive than MIT" },
  "@axe-core/playwright": { license: "MPL-2.0", why: "accessibility test tooling, a devDependency that never ships, used unmodified" },
};

/** The license of an installed package as one string, or null. */
function licenseOf(manifest: { license?: unknown; licenses?: unknown }): string | null {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license && typeof (manifest.license as { type?: unknown }).type === "string") {
    return (manifest.license as { type: string }).type;
  }
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map((entry) => (entry as { type?: string }).type).filter(Boolean);
    return types.length > 0 ? `(${types.join(" OR ")})` : null;
  }
  return null;
}

/** True when an SPDX expression has an alternative on the allowlist ("(MIT OR Apache-2.0)", "MIT"). */
function licenseAllowed(license: string): boolean {
  return license
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/i)
    .some((alternative) => alternative.split(/\s+AND\s+/i).every((part) => ALLOWED_LICENSES.has(part.trim())));
}

describe("M9-14 licenses", () => {
  const direct = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];

  it("every direct dependency's license (read from node_modules) is on the allowlist, or a named exception", () => {
    const failures: string[] = [];
    for (const name of direct) {
      const path = join(ROOT, "node_modules", name, "package.json");
      if (!existsSync(path)) {
        failures.push(`${name}: not installed (node_modules/${name}/package.json is missing)`);
        continue;
      }
      const license = licenseOf(JSON.parse(readFileSync(path, "utf8")));
      if (license === null) failures.push(`${name}: no license field`);
      else if (!licenseAllowed(license) && ACCEPTED_EXCEPTIONS[name]?.license !== license) {
        failures.push(`${name}: ${license} is not on the allowlist (MIT, ISC, BSD, Apache-2.0, CC0-1.0, 0BSD, OFL). See CLAUDE.md, Dependencies, rule 3`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("an exception is still needed: if its license ever becomes permitted or the package goes, remove it from the list", () => {
    for (const [name, { license }] of Object.entries(ACCEPTED_EXCEPTIONS)) {
      expect(direct, `${name} is no longer a direct dependency: drop it from ACCEPTED_EXCEPTIONS and rule 3`).toContain(name);
      const actual = licenseOf(JSON.parse(read(`node_modules/${name}/package.json`)));
      expect(actual, `${name} changed license`).toBe(license);
      expect(licenseAllowed(license), `${name} is on the allowlist now`).toBe(false);
    }
  });

  it("copyleft and unlicensed names fail the check (the matcher itself)", () => {
    for (const bad of ["GPL-3.0", "AGPL-3.0-only", "LGPL-2.1", "SSPL-1.0", "UNLICENSED", "SEE LICENSE IN LICENSE", "Proprietary", "MPL-2.0"]) {
      expect(licenseAllowed(bad), bad).toBe(false);
    }
    for (const good of ["MIT", "ISC", "BSD-3-Clause", "Apache-2.0", "CC0-1.0", "0BSD", "(MIT OR Apache-2.0)", "(GPL-3.0 OR MIT)", "MIT OR GPL-2.0"]) {
      expect(licenseAllowed(good), good).toBe(true);
    }
  });

  it("prints the licenses of transitive packages outside the list for review (sharp's libvips is the one known exception)", () => {
    const store = join(ROOT, "node_modules", ".pnpm");
    const outside = new Map<string, string[]>();
    if (existsSync(store)) {
      for (const entry of readdirSync(store)) {
        const modules = join(store, entry, "node_modules");
        if (!existsSync(modules) || !statSync(modules).isDirectory()) continue;
        for (const scopeOrName of readdirSync(modules)) {
          const names = scopeOrName.startsWith("@") ? readdirSync(join(modules, scopeOrName)).map((name) => `${scopeOrName}/${name}`) : [scopeOrName];
          for (const name of names) {
            const manifestPath = join(modules, name, "package.json");
            if (!existsSync(manifestPath) || direct.includes(name)) continue;
            let manifest: { license?: unknown; licenses?: unknown; version?: string };
            try {
              manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
            } catch {
              continue;
            }
            const license = licenseOf(manifest) ?? "(none)";
            if (licenseAllowed(license)) continue;
            const packages = outside.get(license) ?? [];
            if (!packages.includes(`${name}@${manifest.version ?? "?"}`)) packages.push(`${name}@${manifest.version ?? "?"}`);
            outside.set(license, packages);
          }
        }
      }
    }
    const lines = [...outside].sort().map(([license, names]) => `  ${license}: ${names.slice(0, 6).join(", ")}${names.length > 6 ? `, and ${names.length - 6} more` : ""}`);
    if (lines.length > 0) {
      console.info(
        `Transitive packages outside the license allowlist, for review (CLAUDE.md, Dependencies, rule 3). sharp's prebuilt libvips binaries (LGPL, dynamically linked, already in use) are the one known and accepted exception:\n${lines.join("\n")}`,
      );
    }
    // The report is informational; what this asserts is that the walk found the store at all.
    expect(existsSync(store)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// (d) no remote library or font URL in src
// ---------------------------------------------------------------------------------------------

describe("M9-14 no source file names a remote library or font host", () => {
  const REMOTE = ["cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

  /**
   * Existing, app-side uses of Google Fonts that were there before this policy (Gary to confirm): the
   * allowlist-checked stylesheet URL builder the Design screen and the template picker use to preview
   * a theme's fonts in the editor (never on a public page, which loads its fonts from its own host),
   * the helper that the vendoring script runs, and the manifest that records where the vendored font
   * files came from. `scripts/vendor-tenant-fonts.mts` lives outside src.
   */
  const KNOWN: Record<string, string> = {
    "src/lib/design/font-url.ts": "the allowlist-checked builder of the Google Fonts stylesheet URL (editor previews)",
    "src/lib/tenant-assets/google-css.ts": "parses Google's stylesheet when the tenant fonts are vendored (scripts/vendor-tenant-fonts.mts)",
    "src/lib/tenant-assets/font-manifest.json": "records the source of the vendored font files",
  };

  it("none of src names cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, fonts.googleapis.com or fonts.gstatic.com, apart from the named existing files", () => {
    const files = listFiles("src", /\.(tsx?|jsx?|mjs|css|json|html|svg|md)$/);
    expect(files.length).toBeGreaterThan(300);
    const offenders: string[] = [];
    for (const file of files) {
      const text = read(file);
      const hit = REMOTE.filter((host) => text.includes(host));
      if (hit.length > 0 && !(file in KNOWN)) offenders.push(`${file}: ${hit.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("each named file still names one of them (a stale entry is removed, not kept)", () => {
    for (const file of Object.keys(KNOWN)) {
      expect(REMOTE.some((host) => read(file).includes(host)), file).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The tenant boundary
// ---------------------------------------------------------------------------------------------

/**
 * The packages a public tenant page may reach at server render, each with why. A package that is not
 * here fails the scan: adding one is a code change that Gary reviews.
 */
const TENANT_ALLOWED: Record<string, string> = {
  react: "the components of the page renderer",
  "react-dom": "the renderer's static markup, as Next.js ships it (src/lib/tenant-render/static-markup.ts)",
  next: "next/server types and the copy of react-dom/server that Next.js ships",
  zod: "the document and theme schemas",
  "server-only": "marks the server modules of the render path",
  "@supabase/supabase-js": "the secret-key client of the published-page query (server only)",
  "simple-icons": "brand marks as SVG paths, drawn into static markup at server render (Wave K)",
};
const TENANT_FORBIDDEN = [
  "lucide-react",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "react-colorful",
  "react-easy-crop",
  "@tiptap/react",
  "@tiptap/pm",
  "@tiptap/starter-kit",
  "@tiptap/extension-link",
  "@tiptap/extension-underline",
  "@tiptap/extension-text-align",
  "@sentry/nextjs",
  "react-email",
  "clsx",
  "tailwind-merge",
  "nodemailer",
  "sharp",
];

describe("M9-14 the tenant boundary: a public page reaches server-render packages only", () => {
  const routes = ["src/app/(tenant)/t/[handle]/route.ts", "src/app/(tenant)/sites/[pageId]/route.ts"];
  const entries = [...routes, ...listFiles("src/lib/tenant-render"), ...listFiles("src/lib/tenant-assets"), ...listFiles("src/components/page")];
  const graph = walk(entries);
  /** What a request to a public page actually runs: the routes and everything they import. */
  const live = walk(routes);
  const reached = [...graph.packages.keys()].filter((name) => !name.startsWith("node:"));

  it("walks the two routes and every file of the renderer, the assets and the page components", () => {
    expect(entries.length).toBeGreaterThan(30);
    expect(graph.files.size).toBeGreaterThan(60);
    expect(live.files.size).toBeGreaterThan(40);
    expect(reached).toContain("react");
    expect(reached).toContain("zod");
  });

  it("every package reachable is on the short allowlist in this test", () => {
    const notAllowed = reached.filter((name) => !(name in TENANT_ALLOWED));
    expect(notAllowed.map((name) => `${name} (imported by ${[...graph.packages.get(name)!].slice(0, 2).join(", ")})`)).toEqual([]);
  });

  it("none of the client libraries, the mailer, the image library or the class helpers is reachable", () => {
    expect(reached.filter((name) => TENANT_FORBIDDEN.includes(name) || name.startsWith("@radix-ui/") || name.startsWith("@tiptap/") || name.startsWith("@sentry/"))).toEqual([]);
  });

  it("no file reachable from the two routes has a 'use client' directive (M8-02 (a))", () => {
    // From the routes, as M8-02 does: src/components/page/embed-facade.tsx is a client component of
    // the editor preview that sits in the same folder and is never imported by the render path.
    const client = [...live.files].filter(([, source]) => isClientModule(source)).map(([file]) => rel(file));
    expect(client).toEqual([]);
  });

  it("the packages the routes themselves reach are on the allowlist too (the narrower, real graph)", () => {
    const reachedLive = [...live.packages.keys()].filter((name) => !name.startsWith("node:"));
    expect(reachedLive.filter((name) => !(name in TENANT_ALLOWED))).toEqual([]);
  });

  it("the one tenant script has no import, require, fetch, XMLHttpRequest, eval or innerHTML and stays within its size limits (M8-05)", async () => {
    const source = read("src/lib/tenant-assets/script/tenant.js");
    for (const [name, pattern] of [
      ["import", /\bimport\b/],
      ["require", /\brequire\b/],
      ["fetch", /\bfetch\b/],
      ["XMLHttpRequest", /XMLHttpRequest/],
      ["eval", /\beval\b/],
      ["innerHTML", /innerHTML|outerHTML|insertAdjacentHTML/],
    ] as const) {
      expect(source, name).not.toMatch(pattern);
    }
    const { buildTenantScript } = await import("@/lib/tenant-assets/build");
    const built = buildTenantScript(source);
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(12 * 1024);
    expect(gzipSync(built.code).length).toBeLessThanOrEqual(3 * 1024);
  });
});

// ---------------------------------------------------------------------------------------------
// The marketing boundary
// ---------------------------------------------------------------------------------------------

/**
 * Client libraries of rule 1 that the app side owns. The marketing site reaches none of them, except
 * the ones its pages already use today, which are listed here with a one-line reason each. A new
 * entry is a code change that Gary reviews.
 */
const APP_SIDE_LIBRARIES = ["@radix-ui/", "react-colorful", "react-easy-crop", "@tiptap/", "@sentry/", "react-email", "@react-email/", "lucide-react"];
const MARKETING_EXCEPTIONS: Record<string, string> = {
  // (none today: the marketing site draws its own icons and uses no app-side library)
};

describe("M9-14 the marketing boundary", () => {
  const graph = walk([...listFiles("src/app/(marketing)"), ...listFiles("src/components/marketing")]);

  it("walks the marketing routes and components", () => {
    expect(graph.files.size).toBeGreaterThan(100);
  });

  it("reaches none of Radix, react-colorful, react-easy-crop, Tiptap, Sentry, react-email or lucide-react, apart from the listed exceptions", () => {
    const reached = [...graph.packages.keys()].filter((name) => APP_SIDE_LIBRARIES.some((prefix) => name === prefix || name.startsWith(prefix)));
    const unexplained = reached.filter((name) => !(name in MARKETING_EXCEPTIONS));
    expect(unexplained.map((name) => `${name} (imported by ${[...graph.packages.get(name)!].slice(0, 2).join(", ")})`)).toEqual([]);
  });

  it("the exception list holds no stale entry", () => {
    for (const name of Object.keys(MARKETING_EXCEPTIONS)) expect(graph.packages.has(name), name).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The docs say the same
// ---------------------------------------------------------------------------------------------

describe("M9-14 the other docs point at the section", () => {
  it(".claude/rules/tenant-pages.md has the one line that points at it", () => {
    expect(read(".claude/rules/tenant-pages.md")).toContain("Libraries on tenant pages: see CLAUDE.md, Dependencies");
  });

  it("docs/PLAN.md's decided list carries the rules in one paragraph", () => {
    const decided = read("docs/PLAN.md").split("\n## Open")[0]!;
    const paragraph = decided.split("\n").find((line) => line.startsWith("- Dependencies (2026-10-04"));
    expect(paragraph, "docs/PLAN.md has no 'Dependencies (2026-10-04' entry in Decided").toBeDefined();
    expect(paragraph).toMatch(/app and editor side only/);
    expect(paragraph).toMatch(/never ship library JavaScript/);
    expect(paragraph).toMatch(/no library makes network calls/);
    expect(paragraph).toMatch(/Sentry/);
    expect(paragraph).toMatch(/permissive licenses only/);
    expect(paragraph).toMatch(/exact pinned versions/);
    expect(paragraph).toMatch(/Gary's approval in chat/);
  });
});
