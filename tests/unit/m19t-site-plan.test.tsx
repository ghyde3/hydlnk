import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * R4 (M19-05, M19-10): the screens read the SITE's plan (its owner's) for every feature of the site.
 * A Free member of a Studio site gets Studio's scheduling, History and Pro toolbar items; their own
 * plan stays for account and billing UI. The screens layout hands `context.sitePlan` to the plan
 * context, and every reader of that context is a site feature (`useSitePlan`).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pages/context", () => ({
  getAppContext: async () => ({ plan: "free", sitePlan: "studio" }),
}));
vi.mock("@/components/app/app-shell-frame", () => ({
  AppShellFrame: ({ children }: { children: ReactNode }) => children,
}));

const { default: ScreensLayout } = await import("@/app/(editor)/app/(screens)/layout");
const { useSitePlan } = await import("@/components/versions/plan-context");

function ShowPlan() {
  return createElement("span", null, useSitePlan());
}

describe("R4 the site's plan gates the site's features", () => {
  it("a Free member on a Studio owner's site reads studio", async () => {
    const tree = await ScreensLayout({ children: createElement(ShowPlan) });
    expect(renderToStaticMarkup(tree)).toBe("<span>studio</span>");
  });

  it("every reader of the plan context is a site feature (scheduling, History, the toolbar's Pro items)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
      });
    const readers = walk(join(process.cwd(), "src"))
      .filter((file) => /useSitePlan\(\)/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file))
      .sort();
    expect(readers).toEqual([
      "src/components/editor/block-row.tsx",
      "src/components/posts/post-editor.tsx",
      "src/components/versions/plan-context.tsx",
      "src/components/workspace/share/history-card.tsx",
      "src/components/workspace/toolbar/more-menu.tsx",
    ]);
  });
});
