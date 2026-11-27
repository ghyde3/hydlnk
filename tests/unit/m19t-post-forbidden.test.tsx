// @vitest-environment node
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostPublishPanel } from "@/components/posts/post-publish-panel";
import { postAction, refusalMessage } from "@/lib/posts/client";
import { postEntryDraft } from "@/lib/site-pages/entry-save-client";

/**
 * R5 (M19-10 step 4): an editor on a shared site. The Posts client reads the server's `forbidden`
 * answer as a sentence of its own (never "Something went wrong"), the draft save client too, and the
 * post editor's bar shows "Ask the owner or a publisher to publish" where Publish and Unpublish would
 * be. The post screen hands the editor the site access's canPublish.
 */

const SENTENCE = "Ask the owner or a publisher to publish.";

afterEach(() => vi.unstubAllGlobals());

const answering = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("R5 forbidden is a clear message", () => {
  it("postAction reads 403 forbidden with the server's sentence", async () => {
    answering(403, { kind: "forbidden", message: SENTENCE });
    const out = await postAction("s", "e", "publish", 1);
    expect(out).toEqual({ kind: "forbidden", message: SENTENCE });
    expect(refusalMessage(out as never)).toBe(SENTENCE);
  });

  it("a forbidden with no sentence still reads as the publish sentence", async () => {
    answering(403, { kind: "forbidden" });
    expect(await postAction("s", "e", "trash", 1)).toEqual({ kind: "forbidden", message: SENTENCE });
  });

  it("the draft save client reads forbidden too", async () => {
    answering(403, { kind: "forbidden", message: SENTENCE });
    expect(await postEntryDraft("s", "e", 1, {})).toEqual({ kind: "forbidden", message: SENTENCE });
  });
});

const panel = (publishForbidden: string | null, state: "live" | "draft" = "live") =>
  renderToStaticMarkup(
    createElement(PostPublishPanel, {
      state,
      save: { state: "saved", problem: null },
      busy: null,
      disabled: false,
      publishOff: null,
      publishForbidden,
      previewUrl: null,
      onPublish: () => undefined,
      onUnpublish: () => undefined,
      onPreview: () => undefined,
    }),
  );

describe("R5 the post bar for an editor", () => {
  it("an editor sees the sentence and neither Publish nor Unpublish", () => {
    const html = panel(SENTENCE);
    expect(html).toContain(SENTENCE);
    expect(html).not.toContain('data-testid="post-publish"');
    expect(html).not.toContain('data-testid="post-unpublish"');
    expect(html).toContain("Preview");
  });

  it("the owner and a publisher see Publish and Unpublish", () => {
    const html = panel(null);
    expect(html).not.toContain(SENTENCE);
    expect(html).toContain("Unpublish");
    expect(html).toContain("Publish changes".slice(0, 7));
  });

  it("the post screen passes the site access's canPublish; the editor hides Schedule and a live post's trash", () => {
    const page = readFileSync("src/app/(editor)/app/(screens)/posts/[entryId]/page.tsx", "utf8");
    expect(page).toContain("canPublish={current.access.canPublish}");
    const editor = readFileSync("src/components/posts/post-editor.tsx", "utf8");
    expect(editor).toContain("publishForbidden={canPublish ? null : PUBLISH_FORBIDDEN_MESSAGE}");
    expect(editor).toContain("{trashed || !canPublish ? null : (");
    expect(editor).toContain('canPublish || meta.status !== "published"');
  });
});
