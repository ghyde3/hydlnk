import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE_OPTION_KEYS } from "@/lib/document/profile-options";

/**
 * M6-15 step 5 and M6-17 step 3: the share image (/og) draws the name, the bio and the avatar from
 * the published profile as before and ignores the display options. Static: the image code and its
 * route never read any of the six option keys, and they take name, bio and photo from the document
 * unconditionally, so a hidden name, a hidden bio or a hidden photo is still drawn.
 */

const SOURCES = ["src/lib/publish/og-image.tsx", "src/app/(tenant)/t/[handle]/og/route.ts"];

describe("the /og image and the profile display options", () => {
  it.each(SOURCES)("%s never mentions a profile display option", (file) => {
    const source = readFileSync(file, "utf8");
    for (const key of PROFILE_OPTION_KEYS) {
      expect(source, `${file} reads ${key}`).not.toContain(key);
    }
  });

  it("draws the name, the bio and the photo straight from the published profile", () => {
    const source = readFileSync("src/lib/publish/og-image.tsx", "utf8");
    expect(source).toMatch(/name:\s*document\.profile\.name/);
    expect(source).toMatch(/bio:\s*document\.profile\.bio/);
    expect(source).toMatch(/photo:\s*document\.profile\.photo/);
  });
});
