import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { navKeyForSegment, type NavKey } from "@/components/app/nav-items";

/**
 * M7-01 static checks: the navigation's matching against the REAL src/app route tree (not a stub),
 * the account menu's Sign out is a POST form, and every app-host path literal under src/ names a
 * route that exists.
 */

const ROOT = process.cwd();
const SCREENS = "src/app/(editor)/app/(screens)";
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(resolve(ROOT, path)).isDirectory()) walk(path, accept, out);
    else if (accept(name)) out.push(path);
  }
  return out;
}

/** What `useSelectedLayoutSegment()` reports in the (screens) layout for a page file, and its URL. */
function routesUnderScreens() {
  return walk(SCREENS, (name) => name === "page.tsx").map((file) => {
    const parts = file
      .slice(SCREENS.length + 1)
      .split("/")
      .slice(0, -1);
    const url = `/${parts.filter((part) => !/^\(.*\)$/.test(part)).join("/")}`;
    return { file, url, segment: parts[0]! };
  });
}

const EXPECTED: Record<string, NavKey | null> = {
  "/editor": "editor",
  "/design": "editor",
  "/share": "editor",
  "/editor/history": "editor",
  "/analytics": "analytics",
  "/domains": "domains",
  "/settings": "settings",
  "/pages/new": null,
};

describe("M7-01 the navigation matches every real screen route", () => {
  const routes = routesUnderScreens();

  it("finds the routes the spec names", () => {
    expect(routes.map((route) => route.url).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("reports the workspace's route group by its own name, and /editor/history as 'editor'", () => {
    const segmentOf = (url: string) => routes.find((route) => route.url === url)!.segment;
    expect(segmentOf("/editor")).toBe("(workspace)");
    expect(segmentOf("/design")).toBe("(workspace)");
    expect(segmentOf("/share")).toBe("(workspace)");
    expect(segmentOf("/editor/history")).toBe("editor");
  });

  for (const route of routesUnderScreens()) {
    it(`${route.url} (segment ${route.segment}) belongs to ${EXPECTED[route.url] ?? "no item"}`, () => {
      expect(navKeyForSegment(route.segment)).toBe(EXPECTED[route.url] ?? null);
    });
  }

  it("treats everything else, and no segment, as no item", () => {
    expect(navKeyForSegment(null)).toBeNull();
    expect(navKeyForSegment("pages")).toBeNull();
    expect(navKeyForSegment("")).toBeNull();
    expect(navKeyForSegment("design")).toBeNull();
    expect(navKeyForSegment("share")).toBeNull();
  });

  it("the sidebar lists Editor, Analytics and Domains; the phone bar adds Account", () => {
    const source = code("src/components/app/app-nav.tsx");
    expect(source).toMatch(/SIDEBAR_ITEMS[^=]*=\s*\[EDITOR, ANALYTICS, DOMAINS\]/);
    expect(source).toMatch(/TAB_ITEMS[^=]*=\s*\[EDITOR, ANALYTICS, DOMAINS, ACCOUNT\]/);
    expect(source).not.toMatch(/label: "Design"/);
  });
});

describe("M7-01 the account menu", () => {
  const source = code("src/components/app/account-menu.tsx");

  it("signs out with a POST form (a Server Action), never a link", () => {
    expect(source).toMatch(/<form action=\{signOut\}/);
    expect(source).toMatch(/type="submit"/);
    // The Sign out item is the button inside the form: no href belongs to it.
    const form = source.slice(source.indexOf("<form"), source.indexOf("</form>"));
    expect(form).not.toMatch(/href|<Link|<a\b/);
    expect(form).toMatch(/Sign out/);
  });

  it("is one button that opens a menu named Account", () => {
    expect(source).toMatch(/aria-label="Account menu"/);
    expect(source).toMatch(/aria-label="Account"/);
    // M9-05: Radix's dropdown menu draws aria-haspopup="menu" on the trigger and role="menu" on the panel.
    expect(source).toMatch(/<DropdownMenu\.Trigger asChild>/);
    expect(source).toMatch(/<DropdownMenu\.Content/);
  });

  it("takes the name and email from props and draws them as text", () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/useSearchParams|location\./);
  });

  it("the admin shell keeps the static block", () => {
    expect(code("src/components/admin/admin-shell.tsx")).toMatch(/<UserBlock email=\{email\} \/>/);
    expect(code("src/components/app/user-block.tsx")).not.toMatch(/<button|role="menu"/);
  });
});

/** The URL pattern of every route file under src/app, with route groups removed. */
function routePatterns(): RegExp[] {
  const files = walk("src/app", (name) => /^(page\.tsx|route\.ts)$/.test(name));
  const patterns: RegExp[] = [];
  for (const file of files) {
    let parts = file.slice("src/app/".length).split("/").slice(0, -1);
    parts = parts.filter((part) => !/^\(.*\)$/.test(part));
    // The app host's internal prefix is not part of the URL.
    if (file.startsWith("src/app/(editor)/app/") && parts[0] === "app") parts = parts.slice(1);
    // Catch-alls are the 404 pages: they do not make a path "exist".
    if (parts.some((part) => part.startsWith("[..."))) continue;
    if (parts[0] === "t" || parts[0] === "sites" || parts[0] === "shared-draft") continue;
    const source = parts
      .map((part) => (part.startsWith("[") ? "[^/]+" : part.replace(/[.*+?^${}()|\\]/g, "\\$&")))
      .join("/");
    patterns.push(new RegExp(`^/${source}/?$`));
  }
  return patterns;
}

describe("M7-01 every app-host path literal under src/ names a route that exists", () => {
  const patterns = routePatterns();
  const existing = (path: string) => patterns.some((pattern) => pattern.test(path));

  /** `href="/x"`, `href: "/x"`, `push("/x")`, `replace("/x")`, `redirect("/x")` and the same in a template literal. */
  const LITERAL = /(?:href\s*[=:]\s*\{?|push\(|replace\(|redirect\()\s*[`"'](\/[^`"'\s?#]*)/g;

  const files = walk("src", (name) => /\.(ts|tsx)$/.test(name));

  it("finds only routes that exist", () => {
    const missing: string[] = [];
    let scanned = 0;
    for (const file of files) {
      const source = code(file);
      for (let match = LITERAL.exec(source); match; match = LITERAL.exec(source)) {
        let path = match[1]!;
        if (path === "/" || path.startsWith("/_next")) continue;
        // A template literal's `${...}` stands for one segment.
        path = path.replace(/\$\{[^}]*\}?[^/]*/g, "x");
        // Private share links are answered by the proxy: `/share/{token}`.
        if (path.startsWith("/share/")) continue;
        // The tenant hosts, the social image and files in public/ are not app-host routes.
        if (/\.[a-z0-9]+$/i.test(path)) continue;
        scanned += 1;
        if (!existing(path)) missing.push(`${file}: ${path}`);
      }
    }
    // The scan is not vacuous: the app links to its own screens in dozens of places.
    expect(scanned).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it("knows the workspace's three tabs and the history screen", () => {
    for (const path of ["/editor", "/design", "/share", "/editor/history", "/settings"]) {
      expect(existing(path), path).toBe(true);
    }
    expect(existing("/app/share")).toBe(false);
    expect(existsSync(resolve(ROOT, SCREENS, "design/page.tsx"))).toBe(false);
  });
});
