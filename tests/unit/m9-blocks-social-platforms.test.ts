import { describe, expect, it, vi } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { REMOVED_LINK, linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { blockedLinksInPublished } from "@/lib/blocklist";
import { blockRowSummary } from "@/components/blocks/summary";
import {
  LIMITS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
  type SocialIcon,
} from "@/lib/document";
import { IPHONE_UA, PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import { blocks, draftWith, fullDraft, fullPublished, noirTokens } from "./fixtures/page-document";

/**
 * M9-03: six more social platforms. The list and labels, the URL rules the new six share with the
 * others, the abuse cases, the blocklist (no new migration: it reads icons by shape), the click
 * redirect, Clicks by link, and the editor's block row title.
 */

const NEW_SIX = ["reddit", "snapchat", "pinterest", "discord", "twitch", "spotify"] as const;
const URL_OF = (platform: string) => `https://example.com/${platform}/mara`;

/** An icon of `platform`: an address for email, a URL for every other platform. */
function iconOf(platform: string, id: string, url = URL_OF(platform)): SocialIcon {
  return (
    platform === "email" ? { id, platform, address: "hello@maraokafor.com" } : { id, platform, url }
  ) as SocialIcon;
}

const socialBlock = (icons: SocialIcon[], extra: Record<string, unknown> = {}): Block =>
  ({ id: "social-row-m9", type: "social", visible: true, icons, ...extra }) as Block;

const draftOk = (doc: unknown) => draftDocSchema.safeParse(doc).success;
const publishOk = (doc: unknown) => publishDocSchema.safeParse(doc).success;

describe("M9-03 the list and the labels", () => {
  it("is sixteen platforms in the order of the editor's select, Email and Website last", () => {
    expect([...SOCIAL_PLATFORMS]).toEqual([
      "instagram",
      "tiktok",
      "youtube",
      "x",
      "facebook",
      "linkedin",
      "github",
      "threads",
      "reddit",
      "snapchat",
      "pinterest",
      "discord",
      "twitch",
      "spotify",
      "email",
      "website",
    ]);
    expect(SOCIAL_PLATFORMS.slice(-2)).toEqual(["email", "website"]);
  });

  it("labels the six with their brand names, and every platform has a label", () => {
    expect(SOCIAL_PLATFORM_LABELS.reddit).toBe("Reddit");
    expect(SOCIAL_PLATFORM_LABELS.snapchat).toBe("Snapchat");
    expect(SOCIAL_PLATFORM_LABELS.pinterest).toBe("Pinterest");
    expect(SOCIAL_PLATFORM_LABELS.discord).toBe("Discord");
    expect(SOCIAL_PLATFORM_LABELS.twitch).toBe("Twitch");
    expect(SOCIAL_PLATFORM_LABELS.spotify).toBe("Spotify");
    for (const platform of SOCIAL_PLATFORMS) {
      expect(Object.hasOwn(SOCIAL_PLATFORM_LABELS, platform), platform).toBe(true);
      expect(SOCIAL_PLATFORM_LABELS[platform].length).toBeGreaterThan(0);
    }
  });

  it("a social block still holds 1 to 8 icons", () => {
    expect(LIMITS.socialIconsMin).toBe(1);
    expect(LIMITS.socialIconsMax).toBe(8);
    const eight = SOCIAL_PLATFORMS.slice(0, 8).map((platform, i) =>
      iconOf(platform, `icon-eight-0${i}`),
    );
    expect(draftOk(draftWith(socialBlock(eight)))).toBe(true);
    const nine = [...eight, iconOf("reddit", "icon-eight-08")];
    expect(draftOk(draftWith(socialBlock(nine)))).toBe(false);
    expect(publishOk(draftWith(socialBlock(nine)))).toBe(false);
    expect(draftOk(draftWith(socialBlock([])))).toBe(false);
  });
});

describe("M9-03 each of the sixteen platforms parses", () => {
  it.each([...SOCIAL_PLATFORMS])("%s parses in the draft and the publish schema", (platform) => {
    const doc = draftWith(socialBlock([iconOf(platform, "icon-ok-00001")]));
    expect(draftOk(doc)).toBe(true);
    expect(publishOk(doc)).toBe(true);
    expect(collectPublishErrors(doc)).toEqual([]);
  });

  it("all sixteen in two blocks of eight publish, and the published form keeps them as they are", () => {
    const first = SOCIAL_PLATFORMS.slice(0, 8).map((p, i) => iconOf(p, `icon-a-0000${i}`));
    const second = SOCIAL_PLATFORMS.slice(8).map((p, i) => iconOf(p, `icon-b-0000${i}`));
    const draft = draftWith(
      socialBlock(first, { id: "social-row-m9a" }),
      socialBlock(second, { id: "social-row-m9b" }),
    ) as DraftDoc;
    expect(collectPublishErrors(draft)).toEqual([]);
    const published = toPublishForm(draft, noirTokens);
    expect(publishedDocSchema.safeParse(published).success).toBe(true);
    expect(published.blocks.map((b) => (b.type === "social" ? b.icons : null))).toEqual([
      first,
      second,
    ]);
  });

  it("the earlier fixtures publish exactly as before: their icons come through unchanged", () => {
    const social = fullDraft.blocks.find((b) => b.type === "social")!;
    const published = fullPublished.blocks.find((b) => b.type === "social")!;
    expect(published).toMatchObject({
      type: "social",
      icons: (social as { icons: unknown }).icons,
    });
    expect(blocks.social.icons.map((icon) => icon.platform)).toEqual([
      "instagram",
      "threads",
      "email",
    ]);
  });

  it.each(["Reddit", "mastodon", "__proto__", "constructor", "", "REDDIT", "reddit ", "toString"])(
    "the platform %j fails in both schemas, with the icon named",
    (platform) => {
      const doc = draftWith(
        socialBlock([{ id: "icon-bad-plat1", platform, url: "https://a.example" } as never]),
      );
      expect(draftOk(doc)).toBe(false);
      expect(publishOk(doc)).toBe(false);
      const errors = collectPublishErrors(doc);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatchObject({ blockId: "social-row-m9", itemId: "icon-bad-plat1" });
    },
  );
});

describe("M9-03 the URL rules of the six are the other platforms' rules", () => {
  const ABUSE: Record<string, string> = {
    "a javascript: URL": "javascript:alert(1)",
    "a data: URL": "data:text/html,x",
    "a protocol-relative URL": "//evil.example",
    "a URL with credentials": "https://user@host.example/",
    "a 4,000-character URL": `https://example.com/${"a".repeat(4000)}`,
    "a URL with a line break": "https://example.com/a\nb",
    "a URL with a space": "https://example.com/a b",
    "a URL with a tab": "https://example.com/\ta",
    "a bare word": "reddit",
  };

  for (const platform of NEW_SIX) {
    for (const [name, url] of Object.entries(ABUSE)) {
      it(`${platform}: ${name} is refused at Publish with the icon's id, and a draft keeps it`, () => {
        const id = `icon-${platform}-0001`;
        const doc = draftWith(socialBlock([iconOf(platform, id, url)]));
        expect(draftOk(doc)).toBe(true);
        expect(publishOk(doc)).toBe(false);
        const errors = collectPublishErrors(doc);
        expect(errors).toEqual([
          expect.objectContaining({ blockId: "social-row-m9", itemId: id, field: "url" }),
        ]);
        expect(errors[0]!.message).toBe("Enter a full web address, like https://example.com.");
      });
    }
  }

  it("a plain http URL passes, like the other platforms", () => {
    for (const platform of NEW_SIX) {
      expect(
        publishOk(
          draftWith(socialBlock([iconOf(platform, "icon-http-0001", "http://example.com/x")])),
        ),
      ).toBe(true);
    }
  });

  it("no per-platform host allowlist: a Reddit icon may point at any web host, as an Instagram one may", () => {
    for (const platform of ["instagram", ...NEW_SIX]) {
      const doc = draftWith(
        socialBlock([iconOf(platform, "icon-any-host01", "https://not-the-brand.example/me")]),
      );
      expect(publishOk(doc), platform).toBe(true);
    }
  });

  it("a hidden social block with a bad icon does not stop Publish: it is dropped", () => {
    const hidden = socialBlock([iconOf("discord", "icon-hidden-001", "javascript:alert(1)")], {
      id: "social-hidden-1",
      visible: false,
    });
    const doc = draftWith(hidden, blocks.header) as DraftDoc;
    expect(collectPublishErrors(doc)).toEqual([]);
    const published = toPublishForm(doc, noirTokens);
    expect(published.blocks.map((b) => b.id)).toEqual([blocks.header.id]);
  });

  it("the editor's draft keeps an empty or half-typed URL for the new platforms too", () => {
    for (const platform of NEW_SIX) {
      expect(draftOk(draftWith(socialBlock([iconOf(platform, "icon-empty-0001", "")])))).toBe(true);
    }
  });
});

describe("M9-03 the blocklist reads the new icons by shape", () => {
  const listed = ["blocked.example"];

  it("a discord and a spotify icon pointing at a listed domain are refused on the published form, by the browser's host parser", () => {
    const draft = draftWith(
      socialBlock([
        iconOf("discord", "icon-disc-00001", "https://blocked.example/invite"),
        iconOf("spotify", "icon-spot-00001", "https://www.BLOCKED.example./artist"),
        iconOf("reddit", "icon-redd-00001", "https://ok.example/r/x"),
      ]),
    ) as DraftDoc;
    const published = toPublishForm(draft, noirTokens);
    const errors = blockedLinksInPublished(published, listed);
    expect(errors.map((e) => [e.blockId, e.itemId, e.host])).toEqual([
      ["social-row-m9", "icon-disc-00001", "blocked.example"],
      ["social-row-m9", "icon-spot-00001", "www.blocked.example"],
    ]);
  });

  it("the same icons pointing at an unlisted host pass", () => {
    const draft = draftWith(
      socialBlock(NEW_SIX.map((p, i) => iconOf(p, `icon-ok-0000${i}`, `https://ok.example/${p}`))),
    ) as DraftDoc;
    expect(blockedLinksInPublished(toPublishForm(draft, noirTokens), listed)).toEqual([]);
  });
});

describe("M9-03 click redirect and Clicks by link", () => {
  const icons = NEW_SIX.map((p, i) => iconOf(p, `icon-click-0000${i}`));
  const hiddenIcon = iconOf("twitch", "icon-hidden-0001", "https://twitch.example/hidden");
  const draft = draftWith(
    socialBlock([iconOf("instagram", "icon-click-insta", "https://instagram.com/mara"), ...icons], {
      id: "social-row-m9",
    }),
    socialBlock([hiddenIcon], { id: "social-hidden-1", visible: false }),
  ) as DraftDoc;
  const published = toPublishForm(draft, noirTokens);

  it("findLinkUrl resolves each new icon id to exactly its published URL", () => {
    for (const icon of icons) {
      expect(findLinkUrl(published, icon.id), icon.platform).toBe((icon as { url: string }).url);
    }
  });

  it("an icon that exists only in the draft, in a hidden block, or nowhere resolves to nothing", () => {
    expect(findLinkUrl(published, hiddenIcon.id)).toBeNull();
    expect(findLinkUrl(published, "icon-not-there-1")).toBeNull();
    expect(findLinkUrl(published, "__proto__")).toBeNull();
  });

  it("GET /r/<pageId>/<icon id> answers 302 to the published URL, no-store, no cookie, and records one click with the icon's id", async () => {
    for (const icon of icons) {
      const s = makeDeps({
        resolveClickTarget: vi.fn(async (pageId: string, id: string) => {
          const url = pageId === PAGE_ID ? findLinkUrl(published, id) : null;
          return url ? { url, handle: "mara", customHosts: [] } : null;
        }),
      });
      const response = await handleClick(
        new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${icon.id}`, {
          headers: {
            host: "mara.localhost:3000",
            "user-agent": IPHONE_UA,
            "x-forwarded-for": "203.0.113.7",
          },
        }),
        { pageId: PAGE_ID, blockId: icon.id },
        s.deps,
      );
      expect(response.status, icon.platform).toBe(302);
      expect(response.headers.get("location")).toBe((icon as { url: string }).url);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      await s.flush();
      expect(s.inserted).toHaveLength(1);
      expect(s.inserted[0]).toMatchObject({ page_id: PAGE_ID, block_id: icon.id, type: "click" });
    }
  });

  it("a draft-only icon, a hidden one and an icon of another page answer 404 and insert nothing", async () => {
    for (const [pageId, id] of [
      [PAGE_ID, hiddenIcon.id],
      [PAGE_ID, "icon-draft-only1"],
      ["00000000-0000-4000-8000-0000000000b2", icons[0]!.id],
    ] as const) {
      const s = makeDeps({
        resolveClickTarget: vi.fn(async (page: string, item: string) => {
          const url = page === PAGE_ID ? findLinkUrl(published, item) : null;
          return url ? { url, handle: "mara", customHosts: [] } : null;
        }),
      });
      const response = await handleClick(
        new Request(`http://mara.localhost:3000/r/${pageId}/${id}`, {
          headers: { host: "mara.localhost:3000" },
        }),
        { pageId, blockId: id },
        s.deps,
      );
      expect(response.status).toBe(404);
      await s.flush();
      expect(s.inserted).toEqual([]);
    }
  });

  it("Clicks by link names an icon by its platform label, and a removed one reads 'Removed link'", () => {
    const labels = linkLabelsFromPublished(published);
    expect(labels.get("icon-click-00000")).toBe("Reddit");
    expect(labels.get("icon-click-00003")).toBe("Discord");
    expect(labels.get("icon-click-00005")).toBe("Spotify");
    // The icon is removed and the page republished: its old clicks have no label any more.
    const after = linkLabelsFromPublished(
      toPublishForm(
        draftWith(
          socialBlock([iconOf("instagram", "icon-click-insta", "https://instagram.com/mara")]),
        ) as DraftDoc,
        noirTokens,
      ),
    );
    expect(after.get("icon-click-00003")).toBeUndefined();
    expect(REMOVED_LINK).toBe("Removed link");
  });
});

describe("M9-03 the editor row", () => {
  it("the row's title lists the platform labels and its sub line says how many icons", () => {
    const block = socialBlock([
      iconOf("reddit", "icon-t-00001"),
      iconOf("discord", "icon-t-00002"),
      iconOf("email", "icon-t-00003"),
    ]);
    expect(blockRowSummary(block)).toMatchObject({
      title: "Reddit, Discord, Email",
      sub: "3 icons",
    });
  });
});
