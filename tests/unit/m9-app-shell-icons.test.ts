import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronDown, Pencil, Plus, Undo2, Upload } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EDITOR_ICON_STROKE, ICON_STROKE, Icon } from "@/components/app/icon";
import { BlockTypeChips } from "@/components/editor/block-type-chips";
import { UndoRedoButtons } from "@/components/editor/undo-redo-controls";
import { StepList } from "@/components/domains/step-list";
import { BLOCK_TYPES } from "@/lib/document";
import { ROOT, code, filesUnder, importsOf, rel, tenantGraph, walkGraph } from "./m9-icons-helpers";

/**
 * M9-02: Lucide icons replace the hand-drawn UI icons in the app. Static scans of the source (the
 * import rule, the clean-up, the allowlist of inline drawings) and renders of the icon wrapper and
 * the converted components that need no Next.js context.
 */

const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const ALL = filesUnder("src");

/** Source folders that must never reach Lucide: the public page, the marketing site, the tenant side. */
const NO_LUCIDE = [
  "src/components/page",
  "src/components/marketing",
  "src/lib/tenant-render",
  "src/lib/tenant-assets",
  "src/app/(tenant)",
  "src/app/(marketing)",
];

describe("M9-02 the import rule", () => {
  const importers = ALL.filter((file) => /lucide-react/.test(code(read(file))));

  it("every Lucide import is a named import from 'lucide-react'", () => {
    expect(importers.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const file of importers) {
      const text = code(read(file));
      for (const match of text.matchAll(
        /import\s+([^;]*?)\s+from\s+["']([^"']*lucide-react[^"']*)["']/g,
      )) {
        const [, clause, from] = match;
        if (from !== "lucide-react") bad.push(`${file}: ${from}`);
        else if (!/^(?:type\s+)?\{[^}]*\}$/.test(clause!.trim())) bad.push(`${file}: ${clause}`);
      }
      if (/import\s*\(\s*["'][^"']*lucide-react/.test(text)) bad.push(`${file}: dynamic import`);
      if (/require\s*\(\s*["'][^"']*lucide-react/.test(text)) bad.push(`${file}: require`);
    }
    expect(bad).toEqual([]);
  });

  it("nothing in src uses the dynamic icon or a deep import", () => {
    const bad = ALL.filter((file) =>
      /DynamicIcon|lucide-react\/dynamic|lucide-react\/dist|lucide-react\/icons/.test(
        code(read(file)),
      ),
    );
    expect(bad).toEqual([]);
  });

  it("no module of the public page, the marketing site or the tenant side imports lucide-react or the app's Icon wrapper", () => {
    const bad: string[] = [];
    for (const dir of NO_LUCIDE) {
      for (const file of filesUnder(dir)) {
        const text = code(read(file));
        if (/lucide-react/.test(text)) bad.push(`${file}: lucide-react`);
        if (/@\/components\/app\/icon["']/.test(text)) bad.push(`${file}: app/icon`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the tenant module graph and the marketing module graph reach no Lucide, directly or through the Icon wrapper", () => {
    const tenant = tenantGraph();
    expect(importsOf(tenant, ["lucide-react"])).toEqual([]);
    expect([...tenant.files.keys()].map(rel)).not.toContain("src/components/app/icon.tsx");
    const marketing = walkGraph([
      ...filesUnder("src/components/marketing"),
      ...filesUnder("src/app/(marketing)"),
    ]);
    expect(importsOf(marketing, ["lucide-react"])).toEqual([]);
    expect([...marketing.files.keys()].map(rel)).not.toContain("src/components/app/icon.tsx");
  });
});

describe("M9-02 the Icon wrapper", () => {
  const html = (props: Partial<Parameters<typeof Icon>[0]> = {}) =>
    renderToStaticMarkup(createElement(Icon, { icon: Pencil, ...props }));

  it("draws a decorative, non-focusable, non-shrinking svg on the 24 grid, 16px and stroke 1.8 by default", () => {
    const markup = html();
    expect(markup).toMatch(/^<svg /);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toMatch(/class="[^"]*\bshrink-0\b/);
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
    expect(markup).toContain('stroke-width="1.8"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-linecap="round"');
    expect(markup).toContain('stroke-linejoin="round"');
    expect(markup).toContain('fill="none"');
    expect(ICON_STROKE).toBe(1.8);
    expect(EDITOR_ICON_STROKE).toBe(1.9);
  });

  it("takes a size, a stroke and a class, and never writes a <title>", () => {
    for (const icon of [Pencil, Plus, Upload, Undo2, ChevronDown]) {
      const markup = html({
        icon,
        size: 18,
        strokeWidth: EDITOR_ICON_STROKE,
        className: "text-brass",
      });
      expect(markup).toContain('width="18"');
      expect(markup).toContain('stroke-width="1.9"');
      expect(markup).toMatch(/class="[^"]*\btext-brass\b/);
      expect(markup).not.toMatch(/<title/i);
      expect(markup).toContain('aria-hidden="true"');
    }
  });

  it("a computed style (the gradient arrow's rotation) passes through", () => {
    expect(html({ style: { transform: "rotate(90deg)" } })).toContain("transform:rotate(90deg)");
  });
});

describe("M9-02 converted components", () => {
  it("the add-block chips draw a Plus icon, decorative, with no title and no '+' text", () => {
    const markup = renderToStaticMarkup(createElement(BlockTypeChips, { onPick: () => undefined }));
    const buttons = markup.split("<button").slice(1);
    expect(buttons.length).toBe(BLOCK_TYPES.length);
    for (const button of buttons) {
      expect(button).toMatch(/<svg [^>]*aria-hidden="true"/);
      expect(button).toContain('width="15"');
      expect(button).not.toMatch(/<title/i);
      expect(button).not.toMatch(/>\+</);
    }
  });

  it("Undo and Redo keep their names and draw one decorative 18px icon each", () => {
    const controls = {
      canUndo: false,
      canRedo: false,
      undo: () => undefined,
      redo: () => undefined,
      message: "",
      messageSeq: 0,
      notice: null,
    };
    const markup = renderToStaticMarkup(createElement(UndoRedoButtons, { controls }));
    for (const name of ["Undo", "Redo"]) {
      const button = markup.split("<button").find((part) => part.includes(`aria-label="${name}"`));
      expect(button, name).toBeDefined();
      expect(button!.match(/<svg /g)).toHaveLength(1);
      expect(button).toMatch(/<svg [^>]*aria-hidden="true"/);
      expect(button).toContain('width="18"');
      expect(button).toContain('stroke-width="1.9"');
      expect(button).not.toMatch(/<title/i);
    }
  });

  it("the step list's done step draws a decorative check and the others a number", () => {
    const steps = [
      { n: 1, state: "done", label: "Step 1 of 3, done", title: "Added", children: null },
      {
        n: 2,
        state: "current",
        label: "Step 2 of 3, current",
        title: "Add the record",
        children: null,
      },
      { n: 3, state: "todo", label: "Step 3 of 3, to do", title: "Wait for SSL", children: null },
    ];
    const markup = renderToStaticMarkup(
      createElement(StepList, { steps } as unknown as Parameters<typeof StepList>[0]),
    );
    expect(markup.match(/<svg /g)?.length).toBe(1);
    expect(markup).toMatch(/<svg [^>]*aria-hidden="true"/);
    expect(markup).not.toMatch(/<title/i);
  });
});

describe("M9-02 the clean-up", () => {
  it("the two hand-drawn icon modules are gone and nothing imports them", () => {
    expect(existsSync(resolve(ROOT, "src/components/app/icons.tsx"))).toBe(false);
    expect(existsSync(resolve(ROOT, "src/components/editor/icons.tsx"))).toBe(false);
    const bad = ALL.filter((file) => {
      if (file.startsWith("src/components/marketing")) return false;
      return /["'](?:@\/components\/(?:app|editor)\/icons|\.\/icons|\.\.\/icons)["']/.test(
        code(read(file)),
      );
    });
    expect(bad).toEqual([]);
  });

  it("the components that drew a UI icon inline hold no <svg any more", () => {
    for (const file of [
      "src/components/app/page-switcher-menu.tsx",
      "src/components/workspace/toolbar/more-menu.tsx",
      "src/components/workspace/toolbar/preview-menu.tsx",
      "src/components/editor/undo-redo-controls.tsx",
      "src/components/editor/page-name.tsx",
      "src/components/design/font-picker.tsx",
      "src/components/design/sections/gradient-panel.tsx",
      "src/components/blocks/forms/focus-picker.tsx",
      "src/components/domains/step-list.tsx",
      "src/components/billing/manage-billing-button.tsx",
      "src/components/themes/card-menu.tsx",
      "src/components/themes/theme-carousel.tsx",
      "src/components/workspace/mini-preview/mini-phone.tsx",
      "src/components/workspace/mini-preview/full-preview-sheet.tsx",
      "src/components/auth/auth-layout.tsx",
      "src/components/auth/brand-handle.tsx",
      "src/components/auth/handle-field.tsx",
    ]) {
      expect(code(read(file)), file).not.toMatch(/<svg\b/);
    }
  });

  it("an inline <svg in the app is allowed only where the drawing is not an icon (a new hand-drawn icon fails here)", () => {
    // file -> why an inline drawing stays
    const ALLOWED: Record<string, string> = {
      "src/components/workspace/share/qr-card.tsx":
        "the QR code itself: modules drawn as one path, not an icon",
    };
    // src/components except the marketing site, the public page and the tenant panels, plus the
    // editor route group. (src/lib/qr/generate.ts writes the downloadable QR file, not UI.)
    const inScope = (file: string) =>
      (file.startsWith("src/components/") &&
        !/^src\/components\/(marketing|page|tenant)\//.test(file)) ||
      file.startsWith("src/app/(editor)/");
    const found = ALL.filter((file) => inScope(file) && /<svg\b/.test(code(read(file))));
    const unexpected = found.filter((file) => !(file in ALLOWED));
    expect(unexpected).toEqual([]);
    for (const file of Object.keys(ALLOWED)) expect(found, file).toContain(file);
  });
});

describe("M9-02 accessible names and the design doc", () => {
  it("every icon-only control keeps its aria-label", () => {
    const labels: Array<[string, RegExp]> = [
      ["src/components/editor/undo-redo-controls.tsx", /aria-label="Undo"/],
      ["src/components/editor/undo-redo-controls.tsx", /aria-label="Redo"/],
      ["src/components/editor/page-name.tsx", /aria-label="Rename page"/],
      ["src/components/themes/theme-carousel.tsx", /aria-label="Show previous themes"/],
      ["src/components/themes/theme-carousel.tsx", /aria-label="Show next themes"/],
      ["src/components/themes/card-menu.tsx", /aria-label=\{`More for \$\{themeName\}`\}/],
      ["src/components/workspace/toolbar/more-menu.tsx", /More actions/],
    ];
    for (const [file, pattern] of labels) expect(read(file), `${file} ${pattern}`).toMatch(pattern);
  });

  it("docs/DESIGN.md has an Icons paragraph: Lucide, the 24 grid, stroke 1.8, sizes, decorative by default", () => {
    const doc = read("docs/DESIGN.md");
    const start = doc.indexOf("### Icons");
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start, doc.indexOf("\n## ", start));
    expect(section).toMatch(/Lucide/);
    expect(section).toMatch(/24 grid/);
    expect(section).toMatch(/1\.8/);
    expect(section).toMatch(/14px/);
    expect(section).toMatch(/16px/);
    expect(section).toMatch(/18px/);
    expect(section).toMatch(/decorative by default/);
  });

  it("lucide-react is pinned at 1.51.0 and the library is permissively licensed", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["lucide-react"]).toBe("1.51.0");
    const installed = JSON.parse(read("node_modules/lucide-react/package.json")) as {
      version: string;
      license: string;
    };
    expect(installed.version).toBe("1.51.0");
    expect(["ISC", "MIT"]).toContain(installed.license);
  });
});
