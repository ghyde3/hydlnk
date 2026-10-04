import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OAUTH_CSS } from "@/components/oauth/oauth-css";

/**
 * The consent screen is answered by a route handler, which cannot load the app's compiled Tailwind
 * file, so it carries the few HYDLNK UI tokens it needs as an inline stylesheet. This keeps the copy
 * in step with src/app/globals.css (docs/DESIGN.md): every `--hl-*` token the screen declares must
 * hold the value the app declares, and only HYDLNK UI tokens appear (never a tenant `--t-*` token).
 */

const globals = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function tokens(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--hl-[a-z0-9-]+)\s*:\s*([^;/]+?)\s*(?:;|\/\*)/g)) {
    if (!found.has(match[1]!)) found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

describe("the consent screen's inline tokens are the app's tokens", () => {
  const app = tokens(globals);
  const screen = tokens(OAUTH_CSS);

  it("declares the tokens it uses", () => {
    expect([...screen.keys()]).toEqual(
      expect.arrayContaining([
        "--hl-ink",
        "--hl-page",
        "--hl-surface",
        "--hl-line",
        "--hl-brass",
        "--hl-radius",
      ]),
    );
  });

  it.each([...screen.entries()].filter(([name]) => !name.startsWith("--hl-font")))(
    "%s is %s in src/app/globals.css too",
    (name, value) => {
      expect(app.get(name), name).toBe(value);
    },
  );

  it("never mixes in a tenant token", () => {
    expect(OAUTH_CSS).not.toMatch(/--t-/);
  });

  it("every var() it reads is declared in the same stylesheet", () => {
    const declared = new Set(screen.keys());
    for (const match of OAUTH_CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      expect(declared.has(match[1]!), match[1]).toBe(true);
    }
  });

  it("loads nothing from another origin", () => {
    expect(OAUTH_CSS).not.toMatch(/@import|url\(|https?:\/\//);
  });
});
