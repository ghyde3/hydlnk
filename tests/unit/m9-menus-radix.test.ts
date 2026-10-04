import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles, stripComments, walk } from "./support/module-graph";

/**
 * M9-05: the workspace toolbar's Preview and ⋯ menus and the sidebar's account menu are
 * `@radix-ui/react-dropdown-menu`, and only those: the Radix import is in `toolbar-menu.tsx` and
 * `account-menu.tsx`, the hand-written menu code is gone, the links and the Sign out POST keep their
 * meaning, and public pages ship no library code.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const code = (path: string) => stripComments(read(path));

const TOOLBAR_MENU = "src/components/workspace/toolbar/toolbar-menu.tsx";
const ACCOUNT_MENU = "src/components/app/account-menu.tsx";
const DROPDOWN = "@radix-ui/react-dropdown-menu";

/** Every file under `src` that imports `pkg` (a runtime import of that package or a path under it). */
function importersOf(pkg: string): string[] {
  return listFiles("src").filter((file) =>
    new RegExp(`from\\s+["']${pkg}(/[^"']*)?["']|import\\(\\s*["']${pkg}(/[^"']*)?["']`).test(
      code(file),
    ),
  );
}

describe("M9-05 the Radix import is in exactly the two menu files", () => {
  it("only toolbar-menu.tsx and account-menu.tsx import @radix-ui/react-dropdown-menu", () => {
    expect(importersOf(DROPDOWN).sort()).toEqual([ACCOUNT_MENU, TOOLBAR_MENU].sort());
  });

  it("the other menus (page switcher, theme card, marketing) stay hand-written: no Radix there", () => {
    for (const file of [
      "src/components/app/page-switcher-menu.tsx",
      "src/components/themes/card-menu.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/@radix-ui/);
    }
    for (const file of listFiles("src/components/marketing")) {
      expect(code(file), file).not.toMatch(/@radix-ui/);
    }
  });

  it("the preview and more menus take their items from toolbar-menu.tsx, not from Radix", () => {
    for (const file of [
      "src/components/workspace/toolbar/preview-menu.tsx",
      "src/components/workspace/toolbar/more-menu.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/@radix-ui/);
      expect(code(file), file).toMatch(/ToolbarMenuItem/);
    }
  });
});

describe("M9-05 the hand-written menu code is deleted", () => {
  it.each([TOOLBAR_MENU, ACCOUNT_MENU])(
    "%s has no onMenuKeyDown, no document pointerdown listener, no focusOnOpen",
    (file) => {
      const source = code(file);
      expect(source).not.toMatch(/onMenuKeyDown/);
      expect(source).not.toMatch(/focusOnOpen/);
      expect(source).not.toMatch(/document\.addEventListener\(\s*["']pointerdown["']/);
      expect(source).not.toMatch(/addEventListener\(\s*["']pointerdown["']/);
      expect(source).not.toMatch(/useEffect/);
    },
  );

  it.each([TOOLBAR_MENU, ACCOUNT_MENU])(
    "%s is not modal: the page behind keeps its scroll and gets no padding",
    (file) => {
      expect(code(file)).toMatch(/modal=\{false\}/);
    },
  );

  it.each([TOOLBAR_MENU, ACCOUNT_MENU])(
    "%s puts the panel in a portal and names it for what it is, not by its button",
    (file) => {
      const source = code(file);
      expect(source).toMatch(/<DropdownMenu\.Portal>/);
      expect(source).toMatch(/aria-labelledby=\{undefined\}/);
    },
  );

  it("the panels are named Preview, More actions and Account", () => {
    expect(code("src/components/workspace/toolbar/preview-menu.tsx")).toMatch(/label="Preview"/);
    expect(code("src/components/workspace/toolbar/more-menu.tsx")).toMatch(/label="More actions"/);
    expect(code(ACCOUNT_MENU)).toMatch(/aria-label="Account"/);
  });

  it("collision handling and the account menu's width are Radix's: the panel opens above the block, as wide as it", () => {
    const source = code(ACCOUNT_MENU);
    expect(source).toMatch(/side="top"/);
    expect(source).toMatch(/--radix-dropdown-menu-trigger-width/);
    expect(source).toMatch(/collisionPadding/);
  });
});

describe("M9-05 items and links keep their meaning", () => {
  const preview = code("src/components/workspace/toolbar/preview-menu.tsx");
  const more = code("src/components/workspace/toolbar/more-menu.tsx");
  const account = code(ACCOUNT_MENU);

  it("Preview your draft is a real link to a new tab with rel noopener that flushes first on a plain click", () => {
    expect(preview).toMatch(/href=\{draftHref\}\s+target="_blank"\s+rel="noopener"/);
    expect(preview).toMatch(/data-menu-item="preview-draft"/);
    expect(preview).toMatch(/isPlainClick\(event\)/);
    expect(preview).toMatch(/await flush\(\)/);
  });

  it("View live page stays focusable and aria-disabled with its description, and its select is canceled, never Radix's disabled", () => {
    expect(preview).toMatch(/aria-disabled="true"/);
    expect(preview).toMatch(/aria-describedby=\{noteId\}/);
    expect(preview).toMatch(/onSelect=\{\(event\) => event\.preventDefault\(\)\}/);
    expect(preview).not.toMatch(/(?<![-\w])disabled\b/);
    expect(preview).toMatch(/NOT_PUBLISHED_YET/);
  });

  it("Private preview link and QR code go to the Share tab's cards and keep their data attributes", () => {
    expect(preview).toMatch(/href="\/share#preview-links"/);
    expect(preview).toMatch(/data-menu-item="preview-link"/);
    expect(more).toMatch(/href="\/share#qr"/);
    expect(more).toMatch(/data-menu-item="qr"/);
  });

  it("Version history keeps its flush on a plain click and the Pro chip attributes", () => {
    expect(more).toMatch(/data-menu-item="history"/);
    expect(more).toMatch(/data-history-link=""/);
    expect(more).toMatch(/data-history-pro-chip=""/);
    expect(more).toMatch(/bg-brass-soft/);
    expect(more).toMatch(/await flush\(\)/);
  });

  it("Settings & billing is a link to /settings with aria-current on that screen", () => {
    expect(account).toMatch(/href="\/settings"/);
    expect(account).toMatch(/aria-current=\{onSettings \? "page" : undefined\}/);
  });

  it("Sign out is a submit button in a form that calls the signOut Server Action: a POST, never a link", () => {
    expect(account).toMatch(/<form action=\{signOut\}/);
    const form = account.slice(account.indexOf("<form"), account.indexOf("</form>"));
    expect(form).toMatch(/<button type="submit"/);
    expect(form).not.toMatch(/href|<Link|<a\b/);
    // Choosing it must not unmount the form before the browser submits it.
    expect(form).toMatch(/onSelect=\{\(event\) => event\.preventDefault\(\)\}/);
    expect(account).toMatch(/data-account-menu=""/);
  });

  it("the items are styled with HYDLNK UI tokens only: no --t-* variable", () => {
    for (const file of [TOOLBAR_MENU, ACCOUNT_MENU]) {
      expect(read(file)).not.toMatch(/--t-/);
    }
    expect(code(TOOLBAR_MENU)).toMatch(/border-line-3 bg-surface/);
    expect(code(ACCOUNT_MENU)).toMatch(/bg-ink-raised/);
  });
});

describe("M9-05 public pages ship no Radix code", () => {
  it("no Radix import in the page renderer, the marketing site, the static renderer or the tenant routes", () => {
    for (const dir of [
      "src/components/page",
      "src/components/marketing",
      "src/lib/tenant-render",
      "src/lib/tenant-assets",
      "src/app/(tenant)",
      "src/app/(marketing)",
    ]) {
      for (const file of listFiles(dir)) {
        expect(code(file), file).not.toMatch(/@radix-ui/);
      }
    }
  });

  it("nothing reachable from the tenant routes, the page renderer or the marketing site imports a Radix package", () => {
    const entries = [
      ...listFiles("src/app/(tenant)"),
      ...listFiles("src/app/(marketing)"),
      ...listFiles("src/components/page"),
      ...listFiles("src/components/marketing"),
      ...listFiles("src/lib/tenant-render"),
    ];
    const { packages } = walk(entries);
    expect([...packages.keys()].filter((name) => name.startsWith("@radix-ui/"))).toEqual([]);
  });
});
