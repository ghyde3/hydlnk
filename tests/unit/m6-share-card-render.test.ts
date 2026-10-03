import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublishError, Share } from "@/lib/document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { ShareCard, SHARE_CARD_HINT, SHARE_IMAGE_HELP } =
  await import("@/components/editor/share-card");
const { SharePreviewCard, NO_IMAGE_TILE, PREVIEW_NOTE } =
  await import("@/components/editor/share-card-preview");

/**
 * M6-33, rendered on the server (no browser): the card's fields, the messages of the Publish gate
 * under the field they belong to, and the preview card with its fallbacks. Everything typed is
 * escaped by React: a title with markup characters comes out as text.
 */

const UID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const IMAGE = { path: `${UID}/img-0123456789ab.webp`, width: 1600, height: 800 };

const card = (props: {
  share?: Share;
  errors?: PublishError[];
  liveOgUrl?: string | null;
  name?: string;
  bio?: string;
}) =>
  renderToStaticMarkup(
    createElement(ShareCard, {
      share: props.share,
      name: props.name ?? "Mara Okafor",
      bio: props.bio ?? "Photographer in Orlando",
      host: "mara.hydlnk.com",
      liveOgUrl: props.liveOgUrl ?? null,
      errors: props.errors ?? [],
      focus: null,
      dispatch: () => undefined,
    }),
  );

const error = (field: string, message: string): PublishError => ({ blockId: null, field, message });

describe("M6-33 the card's own copy", () => {
  it("has the title, the hint, both fields with counters and hints, and the image help", () => {
    const html = card({});
    expect(html).toContain(">Share card<");
    expect(html).toContain(SHARE_CARD_HINT);
    expect(SHARE_CARD_HINT).toBe("How your page looks when you send its link");
    expect(html).toContain("Leave empty to use your display name.");
    expect(html).toContain("Leave empty to use your bio.");
    expect(html).toContain("0 / 70");
    expect(html).toContain("0 / 200");
    expect(html).toContain(">Upload image<");
    expect(html).toContain(SHARE_IMAGE_HELP);
    expect(SHARE_IMAGE_HELP).toBe(
      "Wide images work best, at least 1200 pixels across. Leave it empty and we make one from your name and colors.",
    );
    // No plan wording anywhere: it is on every plan.
    expect(html).not.toMatch(/\bPro\b|Studio|upgrade/i);
  });

  it("uses the display name and the bio as placeholders", () => {
    const html = card({ name: "Mara Okafor", bio: "Photographer in Orlando" });
    expect(html).toContain('placeholder="Mara Okafor"');
    expect(html).toContain('placeholder="Photographer in Orlando"');
  });

  it("counts code points and shows what is stored", () => {
    const html = card({ share: { title: "Hello", description: "World \u{1F600}", image: null } });
    expect(html).toContain("5 / 70");
    expect(html).toContain("7 / 200");
    expect(html).toContain('value="Hello"');
  });

  it("shows Replace image and Remove, and the focus control, when there is an image", () => {
    const html = card({ share: { title: "", description: "", image: IMAGE } });
    expect(html).toContain(">Replace image<");
    expect(html).toContain(">Remove<");
    expect(html).toContain('data-testid="focus-picker"');
    expect(html).toContain("How it will look");
    expect(html).toContain(">Center<");
    const without = card({});
    expect(without).not.toContain('data-testid="focus-picker"');
    expect(without).not.toContain(">Remove<");
  });
});

describe("M6-33 Publish errors sit under the field they belong to", () => {
  it("the title's, the description's and the image's messages each show once, in their own field", () => {
    const html = card({
      errors: [
        error("share.title", "Use 70 characters or fewer."),
        error("share.description", "Use 200 characters or fewer."),
        error("share.image", "Use an image at least 600 pixels wide."),
      ],
    });
    for (const message of [
      "Use 70 characters or fewer.",
      "Use 200 characters or fewer.",
      "Use an image at least 600 pixels wide.",
    ]) {
      expect(html.split(message).length - 1, message).toBe(1);
    }
    // The invalid fields are marked.
    expect(html.match(/aria-invalid="true"/g)?.length).toBe(2);
  });

  it("an image error from the media check, and a path that is not a reference, show under Image", () => {
    for (const [field, message] of [
      ["share.image", "That image isn’t in your uploads. Upload it again."],
      ["share.image", "That image is no longer available. Upload it again."],
      ["share.image.path", "Not a valid image reference."],
    ] as const) {
      const html = card({ errors: [error(field, message)] });
      expect(html, message).toContain(message);
      expect(html).toContain('data-field="share-image-error"');
    }
  });

  it("a focus outside the picture shows under the focus control, not under the upload buttons", () => {
    const html = card({
      share: { image: IMAGE },
      errors: [error("share.image.focus.x", "Choose a focus point inside the image.")],
    });
    expect(html).toContain("Choose a focus point inside the image.");
    expect(html).not.toContain('data-field="share-image-error"');
    expect(html).toContain('data-field="focus"');
  });

  it("an error of a block, or of the profile, never shows in the card", () => {
    const html = card({
      errors: [
        { blockId: "blk-12345678", field: "share.title", message: "BLOCK-ERROR" },
        error("profile.name", "PROFILE-ERROR"),
      ],
    });
    expect(html).not.toContain("BLOCK-ERROR");
    expect(html).not.toContain("PROFILE-ERROR");
  });
});

describe("M6-33 the preview card", () => {
  const preview = (share: Share | undefined, liveOgUrl: string | null = null) =>
    renderToStaticMarkup(
      createElement(SharePreviewCard, {
        share,
        name: "Mara Okafor",
        bio: "Photographer in Orlando",
        host: "mara.hydlnk.com",
        liveOgUrl,
      }),
    );

  it("falls back to the display name and the bio, and shows the address and the note", () => {
    const html = preview(undefined);
    expect(html).toContain("Mara Okafor");
    expect(html).toContain("Photographer in Orlando");
    expect(html).toContain("mara.hydlnk.com");
    expect(html).toContain(PREVIEW_NOTE);
    expect(PREVIEW_NOTE).toBe("Apps draw cards a little differently. This is close.");
  });

  it("shows the title and the description, and escapes everything", () => {
    const html = preview({
      title: "<img src=x onerror=alert(1)>",
      description: '"><script>x</script>',
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("with no image and no published page shows the gray tile; with a published page, its social image", () => {
    expect(preview(undefined)).toContain(NO_IMAGE_TILE);
    expect(NO_IMAGE_TILE).toBe("We make this image from your name and colors when you publish.");
    const live = preview(undefined, "http://mara.localhost:3000/og?v=123");
    expect(live).toContain('src="http://mara.localhost:3000/og?v=123"');
    expect(live).not.toContain(NO_IMAGE_TILE);
  });

  it("with an image shows it from the owner's folder, at 1.91:1 with the chosen focus", () => {
    const html = preview({ image: { ...IMAGE, focus: { x: 0.2, y: 0.4 } } }, "http://x/og");
    expect(html).toContain(`/storage/v1/object/public/page-media/${UID}/img-0123456789ab.webp`);
    expect(html).toContain("object-position:20% 40%");
    expect(html).toContain("aspect-ratio:1.91 / 1");
    // The share image wins over the live one.
    expect(html).not.toContain("http://x/og");
  });

  it("two lines at most for the title and the description", () => {
    const html = preview({ title: "t", description: "d" });
    expect(html.match(/line-clamp-2/g)?.length).toBe(2);
  });
});
