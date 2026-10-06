// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateDialog } from "@/components/templates/template-dialog";
import { emptyDraft } from "@/lib/document";
import { TEMPLATES } from "@/lib/templates";
import { readFileSync as readSource } from "node:fs";
import {
  listFiles,
  packageNameOf,
  resolveImport,
  ROOT,
  stripComments,
  walk,
} from "./support/module-graph";

/**
 * The packages a browser downloads with the page: the module graph of `entries` following only
 * static imports (`import()` is a separate chunk, loaded later).
 */
function staticPackages(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = entries.map((entry) => resolve(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|jsx?|mjs)$/.test(file)) continue;
    const source = stripComments(readSource(file, "utf8"));
    for (const match of source.matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
    )) {
      const spec = match[1]!;
      const target = resolveImport(file, spec);
      if (target) queue.push(target);
      else {
        const name = packageNameOf(spec);
        if (name) packages.add(name);
      }
    }
  }
  return packages;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M9-06: the template picker's dialog is `@radix-ui/react-dialog`: that import is in exactly one
 * file, the hand-written focus code is gone, the dialog is loaded when opened, and the structure and
 * behavior of the spec hold (labelled and described, the six cards, focus on the first card, Escape
 * and Close close it, the backdrop does not).
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const code = (path: string) => stripComments(read(path));
const DIALOG_FILE = "src/components/templates/template-dialog.tsx";

describe("M9-06 the Radix dialog import is in exactly one file", () => {
  it("only template-dialog.tsx imports @radix-ui/react-dialog", () => {
    const importers = listFiles("src").filter((file) =>
      /from\s+["']@radix-ui\/react-dialog["']|import\(\s*["']@radix-ui\/react-dialog["']/.test(
        code(file),
      ),
    );
    expect(importers).toEqual([DIALOG_FILE]);
  });

  it("template-dialog.tsx has none of the hand-written focus and scroll code, and is not a <dialog>", () => {
    const source = code(DIALOG_FILE);
    expect(source).not.toMatch(/showModal/);
    expect(source).not.toMatch(/FOCUSABLE/);
    expect(source).not.toMatch(/documentElement\.style\.overflow/);
    expect(source).not.toMatch(/<dialog/);
    expect(source).not.toMatch(/useScrollLock/);
  });

  it("every other dialog stays a native <dialog>", () => {
    for (const file of [
      "src/components/editor/position-dialog.tsx",
      "src/components/app/delete-account-dialog-view.tsx",
    ]) {
      expect(code(file), file).toMatch(/<dialog/);
      expect(code(file), file).not.toMatch(/@radix-ui\/react-dialog/);
    }
  });

  it("public pages ship no dialog library: nothing reachable from the tenant routes, the page renderer or the marketing site", () => {
    for (const dir of [
      "src/components/page",
      "src/components/marketing",
      "src/lib/tenant-render",
      "src/lib/tenant-assets",
      "src/app/(tenant)",
    ]) {
      for (const file of listFiles(dir)) expect(code(file), file).not.toMatch(/@radix-ui/);
    }
    const { packages } = walk([
      ...listFiles("src/app/(tenant)"),
      ...listFiles("src/app/(marketing)"),
      ...listFiles("src/components/page"),
      ...listFiles("src/components/marketing"),
    ]);
    expect([...packages.keys()].filter((name) => name.startsWith("@radix-ui/"))).toEqual([]);
  });
});

describe("M9-06 the editor's first load does not include the dialog", () => {
  it("the dialog is loaded with import() from start-from-template.tsx, and nothing else imports it statically", () => {
    const start = code("src/components/templates/start-from-template.tsx");
    expect(start).toMatch(/import\("\.\/template-dialog"\)/);
    expect(start).not.toMatch(/from\s+["']\.\/template-dialog["']/);
    expect(start).toMatch(/ssr: false/);
    // The barrel does not re-export it, so importing StartFromTemplate or TemplateToast does not pull it in.
    expect(code("src/components/templates/index.ts")).not.toMatch(/template-dialog/);
    const staticImporters = listFiles("src").filter(
      (file) => file !== DIALOG_FILE && /from\s+["'][^"']*template-dialog["']/.test(code(file)),
    );
    expect(staticImporters).toEqual([]);
  });

  it("the editor's own module graph reaches no dialog library", () => {
    const packages = staticPackages([
      "src/components/editor/editor-screen.tsx",
      "src/components/workspace/workspace-shell.tsx",
    ]);
    expect([...packages].filter((name) => name === "@radix-ui/react-dialog")).toEqual([]);
    expect(packages.has("react-remove-scroll")).toBe(false);
    // ... and the dialog's own graph does reach it, so the scan can tell the two apart.
    expect(
      staticPackages(["src/components/templates/template-dialog.tsx"]).has(
        "@radix-ui/react-dialog",
      ),
    ).toBe(true);
  });

  it("an apply puts focus back on the opener itself: StartFromTemplate passes its button and keeps no timeout of its own", () => {
    const start = code("src/components/templates/start-from-template.tsx");
    expect(start).toMatch(/opener=\{trigger\}/);
    expect(start).not.toMatch(/setTimeout/);
  });
});

describe("M9-06 the dialog's structure and behavior", () => {
  let host: HTMLElement;
  let root: Root;
  const onClose = vi.fn();
  const onUse = vi.fn();
  const opener = createRef<HTMLButtonElement>();

  const flush = () =>
    act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))));
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="template-dialog"]');

  beforeEach(() => {
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observer;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = Observer;
    onClose.mockClear();
    onUse.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    const button = document.createElement("button");
    button.textContent = "Start from a template";
    document.body.append(button);
    (opener as { current: HTMLButtonElement | null }).current = button;
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    opener.current?.remove();
  });

  async function open(openState = true) {
    act(() =>
      root.render(
        createElement(TemplateDialog, {
          open: openState,
          draft: emptyDraft("mara"),
          themes: {},
          onUse,
          onClose,
          opener,
        }),
      ),
    );
    await flush();
  }

  it("is one role=dialog with aria-modal, labelled by its title and described by its hint, in a portal at the end of body", async () => {
    await open();
    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(host.contains(d)).toBe(false);
    expect(document.querySelectorAll("dialog")).toHaveLength(0);
    const title = document.getElementById(d.getAttribute("aria-labelledby")!);
    const hint = document.getElementById(d.getAttribute("aria-describedby")!);
    expect(title?.textContent).toBe("Start from a template");
    expect(title?.tagName).toBe("H2");
    expect(hint?.textContent).toBe("Pick a starting point, then change anything you like.");
    // Radix wires the ids: nothing is duplicated.
    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    // No heading level 1 and no landmark of its own.
    expect(d.querySelector("h1, main, nav, header, footer, aside")).toBeNull();
  });

  it("draws the six cards in the catalog's order with their buttons, and a Close button", async () => {
    await open();
    const d = dialog()!;
    const names = Array.from(d.querySelectorAll("h3")).map((h) => h.textContent);
    expect(names).toEqual(TEMPLATES.map((template) => template.name));
    expect(names).toEqual(["Musician", "Podcaster", "Artist", "Shop", "Coach", "Streamer"]);
    expect(d.querySelectorAll("[data-use-template]")).toHaveLength(6);
    for (const template of TEMPLATES) {
      expect(
        d.querySelector(`button[aria-label="Use the ${template.name} template"]`),
      ).not.toBeNull();
    }
    expect(d.querySelector('[data-testid="template-close"]')?.textContent).toBe("Close");
    for (const box of Array.from(d.querySelectorAll('[data-testid="template-preview"]'))) {
      expect(box.getAttribute("aria-hidden")).toBe("true");
      expect(box.hasAttribute("inert")).toBe(true);
    }
  });

  it("puts focus on the first card's Use this template when it opens", async () => {
    await open();
    expect(document.activeElement).toBe(dialog()!.querySelector("[data-use-template]"));
  });

  it("Escape closes it: onClose is called once, the draft is not touched, and focus goes to the opener", async () => {
    await open();
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUse).not.toHaveBeenCalled();
    await open(false);
    await flush();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener.current);
  });

  it("Close closes it the same way", async () => {
    await open();
    act(() => dialog()!.querySelector<HTMLElement>('[data-testid="template-close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await open(false);
    await flush();
    expect(document.activeElement).toBe(opener.current);
  });

  it("a press on the backdrop does not close it", async () => {
    await open();
    const overlay =
      document.querySelector<HTMLElement>("[data-state='open'][style*='pointer-events']") ??
      document.body;
    for (const target of [overlay, document.body]) {
      act(() => {
        target.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
        );
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
        );
      });
      await flush();
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("Use this template opens the choice in place; Cancel puts focus back on that card's button", async () => {
    await open();
    const musician = dialog()!.querySelector<HTMLElement>(
      '[data-template-id="musician"] [data-use-template]',
    )!;
    act(() => musician.click());
    const panel = dialog()!.querySelector('[data-testid="template-choice"]');
    expect(panel).not.toBeNull();
    act(() => dialog()!.querySelector<HTMLElement>('[data-testid="template-cancel"]')!.click());
    await flush();
    expect(document.activeElement).toBe(
      dialog()!.querySelector('[data-template-id="musician"] [data-use-template]'),
    );
    // Applying tells the caller which template and which style; it closes nothing itself.
    act(() =>
      dialog()!
        .querySelector<HTMLElement>('[data-template-id="musician"] [data-use-template]')!
        .click(),
    );
    act(() => dialog()!.querySelector<HTMLElement>('[data-testid="template-apply"]')!.click());
    expect(onUse).toHaveBeenCalledWith("musician", "template");
  });

  it("while it is open the page behind is out of the accessibility tree and nothing is drawn when it is closed", async () => {
    await open();
    expect(host.getAttribute("aria-hidden")).toBe("true");
    await open(false);
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.getAttribute("aria-hidden")).toBeNull();
  });
});
