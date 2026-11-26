import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLISH_CONFLICT_MESSAGE,
  publishFailureNote,
  restoreRevisionMessage,
} from "@/components/workspace/publish-note";
import { CONTENT_MESSAGES } from "@/lib/content/errors";
import {
  PUBLISH_FAILED_MESSAGE,
  PUBLISH_RATE_LIMITED_MESSAGE,
  STORAGE_FULL_MESSAGE,
} from "@/lib/editor/messages";

/**
 * M15-10: a stale rev gets the conflict notice. `publishFailureNote` is the one mapper the workspace
 * provider shows for all three publish actions (Publish all changes, Publish page, Publish design).
 */
describe("M15-10 the publish notice", () => {
  it("a conflict says the content writer's own sentence and offers no Retry", () => {
    expect(publishFailureNote("conflict")).toEqual({
      message: "This was changed somewhere else. Reload to see the latest version.",
      retry: false,
    });
    expect(PUBLISH_CONFLICT_MESSAGE).toBe(CONTENT_MESSAGES.conflict);
  });

  it("not_found names the page and offers no Retry", () => {
    const note = publishFailureNote("not_found");
    expect(note.retry).toBe(false);
    expect(note.message).toContain("isn’t part of this site any more");
  });

  it("the other refusals keep the sentences Publish always had", () => {
    expect(publishFailureNote("unauthorized")).toEqual({
      message: "Couldn’t publish. Sign in again, then try again.",
      retry: false,
    });
    expect(publishFailureNote("account_suspended")).toEqual({
      message: "Couldn’t publish. Your account is suspended.",
      retry: false,
    });
    expect(publishFailureNote("rate_limited")).toEqual({
      message: PUBLISH_RATE_LIMITED_MESSAGE,
      retry: false,
    });
    expect(publishFailureNote("storage_full")).toEqual({
      message: STORAGE_FULL_MESSAGE,
      retry: false,
    });
    for (const reason of ["error", "forbidden", undefined]) {
      expect(publishFailureNote(reason)).toEqual({ message: PUBLISH_FAILED_MESSAGE, retry: true });
    }
  });

  it("a restore refused for a stale rev says the same conflict sentence", () => {
    expect(restoreRevisionMessage("conflict")).toBe(CONTENT_MESSAGES.conflict);
    expect(restoreRevisionMessage("error")).toContain("Your draft is safe");
  });

  it("no sentence uses an exclamation mark, 'please' or 'successfully'", () => {
    const text = readFileSync(
      resolve(process.cwd(), "src/components/workspace/publish-note.ts"),
      "utf8",
    );
    const strings = [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
    for (const line of strings) expect(line).not.toMatch(/!|please|successfully/i);
  });

  it("the provider shows every refusal of the three actions through this mapper, and sends the revs it holds", () => {
    const provider = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-provider.tsx"),
      "utf8",
    );
    expect(provider).toContain("setPublishNote(publishFailureNote(result.reason))");
    // One refusal path for all three: each action hands its refused result to `showRefusal`.
    expect(provider.match(/showRefusal\(result\);/g)).toHaveLength(3);
    expect(provider).toMatch(/publishPage\(pageId, expected\)/);
    expect(provider).toMatch(/publishSitePage\(pageId, entryId, rev\)/);
    expect(provider).toMatch(/publishDesign\(pageId, revKey\(\)\)/);
    // The rev a Publish page answered is adopted, for Home and for a sub-page.
    expect(provider).toContain("adoptHomeRev(result.rev)");
    expect(provider).toContain("markSitePagePublished(id, result.rev)");
  });
});
