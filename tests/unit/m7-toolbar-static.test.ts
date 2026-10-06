import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(`${dir}/${entry.name}`)
      : /\.(tsx?|css)$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const FILES = [
  ...walk("src/components/workspace/toolbar"),
  ...walk("src/components/workspace/mini-preview"),
];

describe("M7-05 and M7-09 the toolbar and the mini phone are views", () => {
  it("M7-05 they have files", () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it("M7-05 neither owns the draft, the history or the save queue (the workspace provider does)", () => {
    for (const file of FILES) {
      const source = code(file);
      expect(source, file).not.toMatch(
        /useAutosave|useReducer\(|useUndoRedo|useDraftHistory|AutosaveQueue/,
      );
    }
  });

  it("M7-05 neither imports a secret-key client or server-only code", () => {
    for (const file of FILES) {
      const source = code(file);
      expect(source, file).not.toMatch(
        /supabase\/admin|server-only|SUPABASE_SECRET|serviceRole|createAdminClient/,
      );
    }
  });

  it("M7-09 the mini phone sends no analytics and no view beacon", () => {
    for (const file of walk("src/components/workspace/mini-preview")) {
      expect(code(file), file).not.toMatch(
        /\/api\/e|\/r\/|sendBeacon|navigator\.sendBeacon|analytics/i,
      );
    }
  });

  it("M7-05 the old editor header and the 96px dock are gone", () => {
    for (const gone of [
      "src/components/editor/editor-header.tsx",
      "src/components/editor/mini-preview-dock.tsx",
      "src/components/editor/mini-preview.tsx",
    ]) {
      expect(() => readFileSync(resolve(root, gone), "utf8"), gone).toThrow();
    }
  });
});
