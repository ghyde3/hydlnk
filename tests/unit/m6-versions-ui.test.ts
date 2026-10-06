import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/lib/limits";
import { formatPublishTime } from "@/lib/versions/format";
import {
  confirmQuestion,
  lockedBody,
  missingImagesNote,
  previewingStatus,
  restoreFailureMessage,
  restoredMessage,
  versionHistoryCell,
  versionHistoryItem,
} from "@/lib/versions/messages";

/**
 * M6-50 copy and wiring that needs no browser: every sentence the screen says (from the spec, with
 * the numbers read from the limits table), the time format, and the rules about who may read what
 * (the screen reads with the user's own session; nothing public touches versions).
 */

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
/** The file's code with its comments removed, so prose about a rule cannot trip a check on the rule. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("M6-50 the words of the screen", () => {
  it("M6-50 the locked card's number comes from the limits table", () => {
    expect(lockedBody()).toBe(
      "Pro keeps your last 25 published versions, so you can look back and restore one.",
    );
    expect(lockedBody()).toContain(String(PLAN_LIMITS.pro.versionsKept));
    expect(PLAN_LIMITS.studio.versionsKept).toBe(PLAN_LIMITS.pro.versionsKept);
    expect(PLAN_LIMITS.free.versionsKept).toBe(0);
  });

  it("M6-50 the plan cells: a dash on Free, the count on Pro and Studio", () => {
    expect(versionHistoryCell(PLAN_LIMITS.free.versionsKept)).toBe("—");
    expect(versionHistoryCell(PLAN_LIMITS.pro.versionsKept)).toBe("Last 25 versions");
    expect(versionHistoryCell(PLAN_LIMITS.studio.versionsKept)).toBe("Last 25 versions");
    expect(versionHistoryItem(25)).toBe("Version history, last 25 versions");
  });

  it("M6-50 the preview lines", () => {
    expect(previewingStatus(12)).toBe("Previewing version 12.");
    expect(missingImagesNote(1)).toBe("An image in this version is no longer stored.");
    expect(missingImagesNote(2)).toBe("2 images in this version are no longer stored.");
    expect(missingImagesNote(7)).toBe("7 images in this version are no longer stored.");
  });

  it("M6-50 the confirmation and the success line", () => {
    expect(confirmQuestion(8)).toBe(
      "Restore version 8? Your draft is replaced with this version. Your live page doesn’t change until you publish.",
    );
    expect(restoredMessage(8, 0)).toBe(
      "Restored version 8 to your draft. Review it in the editor, then publish.",
    );
    expect(restoredMessage(8, 2)).toBe(
      "Restored version 8 to your draft. Review it in the editor, then publish. 2 images from this version are no longer stored. Add them again before you publish.",
    );
    expect(restoredMessage(8, 1)).toContain("An image from this version is no longer stored.");
  });

  it("M6-50 each failure says what to do, and only the generic one offers Retry", () => {
    expect(
      restoreFailureMessage({ ok: false, reason: "blocked_link", hosts: ["example.test"] }),
    ).toEqual({
      message: "This version has a link to a blocked site (example.test), so it can’t be restored.",
      retry: false,
    });
    expect(restoreFailureMessage({ ok: false, reason: "conflict" })).toEqual({
      message: "Your page changed in another tab. Reload, then try again.",
      retry: false,
    });
    expect(restoreFailureMessage({ ok: false, reason: "account_suspended" })).toEqual({
      message: "Couldn’t restore. Your account is suspended.",
      retry: false,
    });
    const generic = {
      message: "Couldn’t restore that version. Your draft is safe. Try again.",
      retry: true,
    };
    for (const reason of ["error", "not_found", "forbidden", "unauthorized"] as const) {
      expect(restoreFailureMessage({ ok: false, reason }), reason).toEqual(generic);
    }
  });

  it("M6-50 no sentence uses an exclamation mark, a straight apostrophe or a British spelling", () => {
    const text = code("src/lib/versions/messages.ts");
    const strings = [...text.matchAll(/`([^`]*)`|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? "");
    for (const line of strings) {
      expect(line, line).not.toContain("!");
      expect(line, line).not.toMatch(/[a-z]'[a-z]/i);
    }
    expect(text).not.toMatch(/\b(colour|cancelled|licence|behaviour)\b/i);
  });
});

describe("M6-50 the time", () => {
  it("M6-50 reads like 'Oct 3, 2026, 4:12 PM' in the zone asked for, with a plain space before PM", () => {
    expect(formatPublishTime("2026-10-03T16:12:00Z", "UTC")).toBe("Oct 3, 2026, 4:12 PM");
    expect(formatPublishTime("2026-10-03T16:12:00Z", "America/Los_Angeles")).toBe(
      "Oct 3, 2026, 9:12 AM",
    );
    expect(formatPublishTime("2026-10-03T16:12:00Z", "Asia/Tokyo")).toBe("Oct 4, 2026, 1:12 AM");
    expect(formatPublishTime("2026-10-03T16:12:00Z", "UTC")).not.toMatch(/ /);
  });

  it("M6-50 an unreadable time is empty, never 'Invalid Date'", () => {
    expect(formatPublishTime("not a date")).toBe("");
  });
});

describe("M6-50 who reads what", () => {
  it("M6-50 the list is read with the user's own session, never the secret key", () => {
    for (const file of [
      "src/lib/versions/load.ts",
      "src/app/(editor)/app/(screens)/editor/history/page.tsx",
    ]) {
      const text = code(file);
      expect(text, file).not.toMatch(/supabase\/admin|createAdminSupabase|SUPABASE_SECRET/);
    }
    expect(code("src/lib/versions/load.ts")).toMatch(/createServerSupabase/);
  });

  it("M6-50 the page decides the plan before it asks for a single version", () => {
    const text = code("src/app/(editor)/app/(screens)/editor/history/page.tsx");
    const gate = text.indexOf("versionsKept");
    const load = text.indexOf("loadHistory(");
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
    // a locked plan returns before loadHistory runs
    expect(text.slice(gate, load)).toMatch(/return/);
  });

  it("M6-50 the client modules never import the secret-key client", () => {
    const dir = join(process.cwd(), "src/components/versions");
    for (const name of readdirSync(dir)) {
      expect(code(`src/components/versions/${name}`), name).not.toMatch(
        /supabase\/admin|SUPABASE_SECRET|server-only/,
      );
    }
  });

  it("M6-48 nothing public reads versions: the tenant pages, the OG image, the click and view routes, the share pages", () => {
    const roots = [
      "src/app/(tenant)",
      "src/app/r",
      "src/app/(share)",
      "src/lib/analytics/ingest",
      "src/lib/routing",
      "src/components/page",
      "src/components/tenant",
    ];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          /\.(ts|tsx)$/.test(name) &&
          /page_versions|@\/lib\/versions|components\/versions/.test(
            code(relative(process.cwd(), path)),
          )
        ) {
          hits.push(relative(process.cwd(), path));
        }
      }
    };
    for (const root of roots) {
      try {
        walk(join(process.cwd(), root));
      } catch {
        // a root that does not exist in this checkout
      }
    }
    expect(hits).toEqual([]);
    // the public query and the OG image read pages and accounts only
    for (const file of ["src/app/(tenant)/published-page.ts", "src/lib/publish/og-image.tsx"]) {
      expect(code(file), file).not.toMatch(/page_versions/);
    }
  });

  it("M6-48 media cleanup is untouched: media_paths_in_use is not redefined, and versions are not part of any cleanup module", () => {
    for (const name of readdirSync(join(process.cwd(), "src/lib/media"))) {
      expect(code(`src/lib/media/${name}`), name).not.toMatch(/page_versions/);
    }
    expect(
      source("supabase/migrations/20261006000002_page_versions.sql").replace(/--.*$/gm, ""),
    ).not.toMatch(/media_paths_in_use|media_image_paths|image_cleanup_queue/);
  });
});
