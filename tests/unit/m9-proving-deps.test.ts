import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M9-14 "Docs match", the part dependencies-policy.test.ts does not read: the PROGRESS.md entry of
 * the wave lists the approved libraries with the date of Gary's approval (2026-10-04), and the
 * policy test's failure messages name CLAUDE.md so whoever adds a package knows where to add it.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("M9-14 the PROGRESS entry and the failure message", () => {
  const progress = read("PROGRESS.md");
  const line = progress.split("\n").find((l) => /Libraries \(Gary-approved 2026-10-04/.test(l));

  it("PROGRESS.md lists the approved libraries with the date of the approval", () => {
    expect(line, "the libraries line of the Wave K entry").toBeDefined();
    for (const name of [
      "lucide-react",
      "simple-icons",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-dialog",
      "react-colorful",
      "react-easy-crop",
      "react-email",
      "clsx",
      "tailwind-merge",
      "@sentry/nextjs",
      "@tiptap/react",
    ]) {
      expect(line, name).toContain(name);
    }
  });

  it("the list-equality failure names CLAUDE.md and its Dependencies section", () => {
    const test = read("tests/unit/dependencies-policy.test.ts");
    expect(test).toMatch(/CLAUDE\.md[^\n]*Dependencies|Dependencies[^\n]*CLAUDE\.md/);
  });
});
