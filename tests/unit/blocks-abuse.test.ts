import { describe, expect, it } from "vitest";
import { collectPublishErrors, publishDocSchema } from "@/lib/document";
import { blocks, fullDraft } from "./fixtures/page-document";

/**
 * The block abuse cases at the schema level (M2-15 to M2-21): what a draft written straight to the
 * database can hold, and what the Publish gate reports for it. The failing block, icon or cell is
 * named by id, so the editor can mark exactly that row.
 */

function draftWith(...docBlocks: unknown[]): unknown {
  return {
    version: 1,
    rev: 1,
    profile: { name: "Mara Okafor", bio: "", photo: null },
    theme: { ref: null, overrides: {} },
    blocks: docBlocks,
  };
}

const URL_MESSAGE = "Enter a full web address, like https://example.com.";

describe("Publish refuses unsafe block content and names where it is", () => {
  it("a social icon with a javascript: URL: the icon id is in the errors", () => {
    const draft = draftWith({
      ...blocks.social,
      icons: [
        { id: "icon-good-0001", platform: "instagram", url: "https://instagram.com/mara" },
        { id: "icon-evil-0001", platform: "tiktok", url: "javascript:alert(1)" },
      ],
    });
    expect(publishDocSchema.safeParse(draft).success).toBe(false);
    expect(collectPublishErrors(draft)).toEqual([
      { blockId: blocks.social.id, itemId: "icon-evil-0001", field: "url", message: URL_MESSAGE },
    ]);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/x",
    "https://user:pass@example.com",
    "ftp://example.com",
    "https://exa mple.com",
    "mara.example",
  ])("a link, card, image link and grid cell with the URL %j are refused", (url) => {
    const draft = draftWith(
      { ...blocks.link, url },
      { ...blocks.card, id: "card-evil-001", url, image: null },
      { ...blocks.image, id: "image-evil-01", image: blocks.image.image, url },
      {
        ...blocks.grid,
        id: "grid-evil-001",
        cells: [
          { id: "cell-evil-0001", title: "A", subtitle: "", url },
          { id: "cell-good-0001", title: "B", subtitle: "", url: "https://example.com" },
        ],
      },
    );
    const errors = collectPublishErrors(draft);
    expect(errors.map((e) => e.blockId)).toEqual([
      blocks.link.id,
      "card-evil-001",
      "image-evil-01",
      "grid-evil-001",
    ]);
    expect(errors.at(-1)).toMatchObject({ itemId: "cell-evil-0001", field: "url" });
    for (const error of errors) expect(error.message).toBe(URL_MESSAGE);
  });

  it.each([
    "https://evil.example/x",
    "https://vimeo.com/channels/staffpicks",
    "https://www.youtube.com/@maraokafor",
    "https://youtube.com.evil.example/watch?v=jNQXAC9IVRw",
    "javascript:alert(1)",
    "",
  ])("an embed to %j is refused with the embed message", (url) => {
    const errors = collectPublishErrors(draftWith({ ...blocks.embed, url }));
    expect(errors).toEqual([
      {
        blockId: blocks.embed.id,
        field: "url",
        message:
          "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.",
      },
    ]);
  });

  it("an email icon must be a bare address", () => {
    for (const address of ["mailto:a@b.co", "a@b.co?subject=x", "a b@c.co", "no-at-sign", ""]) {
      const errors = collectPublishErrors(
        draftWith({
          ...blocks.social,
          icons: [{ id: "icon-mail-0001", platform: "email", address }],
        }),
      );
      expect(errors, address).toEqual([
        {
          blockId: blocks.social.id,
          itemId: "icon-mail-0001",
          field: "address",
          message: "Enter a valid email address.",
        },
      ]);
    }
  });

  it("an image block needs an uploaded image and alt text; an image path must be a stored reference", () => {
    const missing = collectPublishErrors(draftWith({ ...blocks.image, image: null, alt: "" }));
    expect(missing).toEqual([
      { blockId: blocks.image.id, field: "image", message: "Upload an image." },
      {
        blockId: blocks.image.id,
        field: "alt",
        message: "Add a short description of this image.",
      },
    ]);

    // A path that is a URL, climbs a folder or names another file type is not a reference at all.
    for (const path of [
      "https://evil.example/x.png",
      "../../etc/passwd",
      "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/../x.png",
      "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01/abcd1234-abcd1234.svg",
      "abcd1234-abcd1234.png",
    ]) {
      for (const block of [
        { ...blocks.image, image: { path, width: 4, height: 3 } },
        { ...blocks.card, image: { path, width: 4, height: 3 } },
      ]) {
        const errors = collectPublishErrors(draftWith(block));
        expect(
          errors.map((e) => e.blockId),
          path,
        ).toEqual([block.id]);
        expect(errors[0]!.field, path).toMatch(/^image(\.path)?$/);
      }
    }
  });

  it("empty required fields say what to add; a divider needs nothing", () => {
    const errors = collectPublishErrors(
      draftWith(
        { ...blocks.link, label: "", url: "" },
        { ...blocks.header, text: "  " },
        { ...blocks.text, text: "" },
        blocks.divider,
      ),
    );
    expect(errors.map((e) => [e.blockId, e.field, e.message])).toEqual([
      [blocks.link.id, "label", "Add a link label."],
      [blocks.link.id, "url", URL_MESSAGE],
      [blocks.header.id, "text", "Add a heading."],
      [blocks.text.id, "text", "Add some text."],
    ]);
  });

  it("a hidden block is exempt, the same block visible is not", () => {
    const bad = { ...blocks.link, url: "javascript:alert(1)" };
    expect(collectPublishErrors(draftWith({ ...bad, visible: false }))).toEqual([]);
    expect(collectPublishErrors(draftWith(bad))).toHaveLength(1);
    expect(collectPublishErrors(fullDraft)).toEqual([]);
  });
});
