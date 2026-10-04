import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M7-02 static checks. The workspace owns the draft: `useAutosave` and the history/undo hooks are
 * used once, in its provider, and in none of the Edit, Design or Share components; the layout and
 * everything under it read with the user's own session (no secret-key client); there is one
 * workspace layout and the three pages only fill its slot.
 */

const ROOT = process.cwd();
const code = (path: string) =>
  readFileSync(resolve(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(resolve(ROOT, path)).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const WORKSPACE_ROUTE = "src/app/(editor)/app/(screens)/(workspace)";

describe("M7-02 one autosave, one history, one undo", () => {
  const files = walk("src");
  const callers = (pattern: RegExp) =>
    files
      .filter((file) => pattern.test(code(file)))
      .map((file) => relative(ROOT, file))
      .sort();

  it("calls useAutosave once, in the workspace provider", () => {
    expect(callers(/(?<!function )\buseAutosave\(/)).toEqual([
      "src/components/workspace/workspace-provider.tsx",
    ]);
  });

  it("calls useUndoRedo once, in the workspace provider", () => {
    expect(callers(/(?<!function )\buseUndoRedo\(/)).toEqual([
      "src/components/workspace/workspace-provider.tsx",
    ]);
  });

  it("keeps no second draft history: no useDraftHistory and no useReducer over the editor reducer outside the provider", () => {
    expect(callers(/\buseDraftHistory\b/)).toEqual([]);
    expect(callers(/useReducer\(\s*(?:editorReducer|workspaceReducer)/)).toEqual([
      "src/components/workspace/workspace-provider.tsx",
    ]);
    expect(
      callers(/\bcreateHistory\(/).filter((file) => file.startsWith("src/components")),
    ).toEqual([]);
  });

  it("the tabs only read the workspace: none of them builds a save queue or its own draft state", () => {
    for (const file of [
      "src/components/editor/editor-screen.tsx",
      "src/components/design/design-screen.tsx",
      "src/components/workspace/share/share-tab.tsx",
    ]) {
      const source = code(file);
      expect(source, file).toMatch(/useWorkspace\(\)/);
      expect(source, file).not.toMatch(/AutosaveQueue|createDraftSaver|useAutosave|useUndoRedo/);
    }
  });
});

describe("M7-02 the layout and the pages", () => {
  it("has one layout for the three tabs and three pages that only fill its slot", () => {
    const layouts = walk(WORKSPACE_ROUTE).filter((file) => file.endsWith("/layout.tsx"));
    expect(layouts).toEqual([`${WORKSPACE_ROUTE}/layout.tsx`]);
    const pages = walk(WORKSPACE_ROUTE)
      .filter((file) => file.endsWith("/page.tsx"))
      .map((file) => file.slice(WORKSPACE_ROUTE.length + 1))
      .sort();
    expect(pages).toEqual(["design/page.tsx", "editor/page.tsx", "share/page.tsx"]);
    for (const page of pages) {
      const source = code(`${WORKSPACE_ROUTE}/${page}`);
      // The gate, then the tab: no data is read here (the layout read it once).
      expect(source, page).toMatch(/requireAppUser\(\)/);
      expect(source, page).not.toMatch(
        /loadEditorPageData|loadThemeLibrary|createServerSupabase|\.from\(/,
      );
    }
  });

  it("the layout reads the draft, the theme library, the template themes and the domain with the user's session", () => {
    const source = code(`${WORKSPACE_ROUTE}/layout.tsx`);
    for (const call of [
      "loadEditorPageData(",
      "loadThemeLibrary(",
      "loadTemplateThemes(",
      "loadPrimaryDomain(",
    ]) {
      expect(source).toContain(call);
    }
    expect(source).toMatch(/key=\{current\.id\}/);
    expect(source).toMatch(/failIfInjected\("draft-load"\)/);
    expect(source).toMatch(/failIfInjected\("themes-load"\)/);
  });

  it("no workspace layout, page or component module imports a secret-key client", () => {
    const modules = [...walk(WORKSPACE_ROUTE), ...walk("src/components/workspace")];
    expect(modules.length).toBeGreaterThan(15);
    for (const file of modules) {
      expect(code(file), file).not.toMatch(
        /@\/lib\/supabase\/admin|createAdminSupabase|@\/lib\/env\/server|SUPABASE_SECRET_KEY/,
      );
    }
  });

  it("the provider is keyed by the page id and freezes the draft-shaped props on mount", () => {
    const source = code("src/components/workspace/workspace-provider.tsx");
    expect(source).toMatch(/const \[initial\] = useState\(\(\) => \(\{/);
    expect(source).toMatch(/initialRevKey: initial\.revKey/);
    expect(source).not.toMatch(/initialRevKey: props\./);
  });

  it("nothing is named Done and the Share tab calls no endpoint but the draft save, upload and preview-link actions", () => {
    for (const file of [
      "src/components/design/design-screen.tsx",
      ...walk("src/components/workspace"),
    ]) {
      expect(code(file), file).not.toMatch(/>\s*Done\s*</);
    }
    for (const file of walk("src/components/workspace/share")) {
      const source = code(file);
      expect(source, file).not.toMatch(
        /\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/,
      );
      expect(source, file).not.toMatch(
        /useSearchParams|URLSearchParams|window\.location\.(search|href)/,
      );
    }
  });
});

describe("M7-09 the phone workspace clears the tab bar and the mini phone, and the toasts end before it", () => {
  const raw = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

  it("the tab panel's bottom padding plus the app shell's main padding is the mini phone's clearance", () => {
    const measures = raw("src/components/workspace/mini-preview/measures.ts");
    const clearance = 57 + 12 + 104 + 12;
    expect(measures).toMatch(/export const APP_MAIN_BOTTOM_PADDING = 84;/);
    expect(raw("src/components/app/app-shell-frame.tsx")).toContain("pb-[calc(84px+");
    // 101px: the clearance (185px) less what <main> already pads (84px).
    expect(clearance - 84).toBe(101);
    expect(raw("src/components/workspace/workspace-shell.tsx")).toMatch(
      /\bpb-\[101px\][^"]*hl:pb-0/,
    );
  });

  it("the three workspace toasts end 72px from the right edge below 760px and are free of it from 760px", () => {
    for (const file of [
      "src/components/editor/undo-toast.tsx",
      "src/components/editor/published-toast.tsx",
      "src/components/templates/template-toast.tsx",
    ]) {
      const source = raw(file);
      expect(source, file).toMatch(/fixed left-4 right-\[72px\]/);
      expect(source, file).toMatch(/hl:right-auto/);
    }
  });

  it("the preview column's bezel is its first drawn child, so it pins exactly 16px under the toolbar", () => {
    const source = code("src/components/workspace/workspace-preview.tsx");
    expect(source.indexOf("<PreviewBezel")).toBeGreaterThan(source.indexOf("<ThemePreviewHeader"));
    // The "Live preview" caption is drawn after the bezel, never before it.
    expect(source.lastIndexOf("Live preview")).toBeGreaterThan(source.indexOf("<PreviewBezel"));
  });
});
