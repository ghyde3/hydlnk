import { describe, expect, it, vi } from "vitest";
import { linkLabelsFromPublished, REMOVED_LINK } from "@/lib/analytics/dashboard/labels";
import { findLinkUrl, locationFor } from "@/lib/analytics/ingest/target";
import { blockedFieldErrors, blockedPublishErrorHolds } from "@/lib/blocklist/fields";
import { blockedLinksInPublished } from "@/lib/blocklist/published";
import { BLOCKED_FIELD_MESSAGE } from "@/lib/blocklist/messages";
import {
  draftDocSchema,
  emptyDraft,
  toPublishForm,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { loadDraft } from "@/lib/editor/load";
import { bannerFieldOf, editorReducer, initialEditorState } from "@/lib/editor/state";
import { sanitizeSharedDoc } from "@/lib/previews/sanitize";
import { failureTab } from "@/components/workspace/failure-tab";
import { nullMissingImages, ownedImagePaths, versionToDraft } from "@/lib/versions/restore";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M9-23, the server and editor plumbing around the support banner: where /r/<page>/<banner id> goes,
 * what 'Clicks by link' calls it, the link blocklist (draft and published sides), the editor's
 * loader, share sanitizer, restore and failure routing.
 */

const BANNER_ID = "banner-0001a";
const base = {
  id: BANNER_ID,
  visible: true,
  text: "Free shipping this week",
  label: "Shop",
  url: "https://shop.example/sale",
};
const draftOf = (banner?: Record<string, unknown>): DraftDoc =>
  draftDocSchema.parse({
    ...(draftWith(blocks.link) as object),
    ...(banner ? { banner } : {}),
  }) as DraftDoc;
const published = (banner?: Record<string, unknown>): PublishDoc =>
  toPublishForm(draftOf(banner), noirTokens);

describe("M9-23 findLinkUrl: the banner's id is a click target, from the published document only", () => {
  it("resolves the banner's id to its address, exactly as published", () => {
    expect(findLinkUrl(published(base), BANNER_ID)).toBe("https://shop.example/sale");
    expect(locationFor("https://shop.example/sale")).toBe("https://shop.example/sale");
  });

  it("answers null for a message-only banner, a hidden banner, a removed banner and a wrong id", () => {
    expect(findLinkUrl(published({ ...base, label: "", url: "" }), BANNER_ID)).toBeNull();
    expect(findLinkUrl(published({ ...base, visible: false }), BANNER_ID)).toBeNull();
    expect(findLinkUrl(published(), BANNER_ID)).toBeNull();
    expect(findLinkUrl(published(base), "banner-other01")).toBeNull();
    expect(findLinkUrl(published(base), "banner")).toBeNull();
  });

  it("never resolves an address that is not http(s), even from a stored document that holds one", () => {
    const doc = published(base);
    for (const url of [
      "javascript:alert(1)",
      "//evil.example",
      "data:text/html,x",
      "ftp://x.test/",
    ]) {
      const stored = { ...doc, banner: { ...doc.banner!, url } } as PublishDoc;
      expect(findLinkUrl(stored, BANNER_ID), url).toBeNull();
    }
  });

  it("does not change what a block id resolves to", () => {
    const doc = published(base);
    expect(findLinkUrl(doc, blocks.link.id)).toBe(blocks.link.url);
  });
});

describe("M9-23 'Clicks by link' labels", () => {
  it("names the banner link 'Banner: {label}'", () => {
    const labels = linkLabelsFromPublished(published(base));
    expect(labels.get(BANNER_ID)).toBe("Banner: Shop");
    expect(labels.get(blocks.link.id)).toBe(blocks.link.label);
  });

  it("cuts the label to 60 characters", () => {
    const labels = linkLabelsFromPublished({
      blocks: [],
      banner: { id: BANNER_ID, label: "L".repeat(80) },
    });
    expect(Array.from(labels.get(BANNER_ID)!).length).toBeLessThanOrEqual(60);
    expect(labels.get(BANNER_ID)!.startsWith("Banner: LLL")).toBe(true);
  });

  it("is absent once the banner is gone from the published document: the click row reads 'Removed link'", () => {
    const labels = linkLabelsFromPublished(published());
    expect(labels.get(BANNER_ID) ?? REMOVED_LINK).toBe("Removed link");
  });

  it("reads defensively: a banner that is not an object is skipped", () => {
    expect(linkLabelsFromPublished({ blocks: [], banner: "x" }).size).toBe(0);
    expect(linkLabelsFromPublished({ blocks: [], banner: { label: "x" } }).size).toBe(0);
  });
});

describe("M9-23 the blocklist, draft side (the editor's inline error)", () => {
  const blocked = (hosts: string[], blockIds: string[], draft?: DraftDoc) => ({
    hosts,
    blockIds,
    ...(draft ? { draft } : {}),
  });

  it("shows the blocked-site message on the banner's address, with block 'banner' and the banner id", () => {
    const draft = draftOf({ ...base, url: "https://blocked.example/x" });
    const errors = blockedFieldErrors(draft, blocked(["blocked.example"], ["banner"]));
    expect(errors).toEqual([
      { blockId: "banner", itemId: BANNER_ID, field: "url", message: BLOCKED_FIELD_MESSAGE },
    ]);
  });

  it("clears the moment the address changes", () => {
    const draft = draftOf({ ...base, url: "https://good.example/x" });
    expect(blockedFieldErrors(draft, blocked(["blocked.example"], ["banner"]))).toEqual([]);
  });

  it("also judges a hidden banner like a hidden block (the database does)", () => {
    const draft = draftOf({ ...base, visible: false, url: "https://blocked.example/x" });
    expect(blockedFieldErrors(draft, blocked(["blocked.example"], ["banner"]))).toHaveLength(1);
  });

  it("falls back to the banner when a notation the browser reads differently was refused", () => {
    const draft = draftOf({ ...base, url: "https://sub.weird.example/x" });
    const errors = blockedFieldErrors(draft, blocked(["other.example"], ["banner"], draft));
    expect(errors.map((e) => e.blockId)).toEqual(["banner"]);
  });

  it("a Publish error on the banner holds while the address still points at the host", () => {
    const draft = draftOf({ ...base, url: "https://blocked.example/x" });
    const error = {
      blockId: "banner",
      itemId: BANNER_ID,
      field: "url",
      message: BLOCKED_FIELD_MESSAGE,
      host: "blocked.example",
    };
    expect(blockedPublishErrorHolds(draft, error)).toBe(true);
    expect(
      blockedPublishErrorHolds(draftOf({ ...base, url: "https://good.example/" }), error),
    ).toBe(false);
    expect(blockedPublishErrorHolds(draftOf(), error)).toBe(false);
  });
});

describe("M9-23 the blocklist, published side (the authority)", () => {
  it("refuses a published banner link to a listed host, one error naming block 'banner', the id and the host", () => {
    const doc = published({ ...base, url: "https://blocked.example/x" });
    expect(blockedLinksInPublished(doc, ["blocked.example"])).toEqual([
      {
        blockId: "banner",
        itemId: BANNER_ID,
        field: "url",
        message: BLOCKED_FIELD_MESSAGE,
        host: "blocked.example",
      },
    ]);
  });

  it("refuses a subdomain, an IP literal and a single-label host; passes an unlisted host", () => {
    expect(
      blockedLinksInPublished(published({ ...base, url: "https://a.blocked.example/" }), [
        "blocked.example",
      ]),
    ).toHaveLength(1);
    expect(
      blockedLinksInPublished(published({ ...base, url: "http://127.0.0.1/x" }), []),
    ).toHaveLength(1);
    expect(
      blockedLinksInPublished(published({ ...base, url: "http://localhost/x" }), []),
    ).toHaveLength(1);
    expect(blockedLinksInPublished(published(base), ["blocked.example"])).toEqual([]);
  });

  it("the userinfo trick still lands on the real host", () => {
    // isHttpUrl refuses credentials at the schema, so only a stored document could hold one.
    const doc = published(base);
    const stored = {
      ...doc,
      banner: { ...doc.banner!, url: "https://good.example@blocked.example/" },
    };
    expect(blockedLinksInPublished(stored as PublishDoc, ["blocked.example"])).toHaveLength(1);
  });

  it("reports the banner next to a blocked block link, each with its own ids", () => {
    const doc = published({ ...base, url: "https://blocked.example/a" });
    const withLink = {
      ...doc,
      blocks: doc.blocks.map((b) =>
        b.type === "link" ? { ...b, url: "https://blocked.example/b" } : b,
      ),
    } as PublishDoc;
    expect(
      blockedLinksInPublished(withLink, ["blocked.example"])
        .map((e) => e.blockId)
        .sort(),
    ).toEqual(["banner", blocks.link.id]);
  });

  it("a message-only banner holds no address to judge", () => {
    expect(
      blockedLinksInPublished(published({ ...base, label: "", url: "" }), ["blocked.example"]),
    ).toEqual([]);
  });
});

describe("M9-23 the editor: load, share, restore, errors", () => {
  it("loadDraft keeps a stored banner as it is, and the repair path keeps one that reads", () => {
    const stored = { ...draftOf(base), rev: 3 };
    expect(loadDraft(stored, "mara").draft.banner).toEqual(base);
    const damaged = { ...stored, blocks: 5 };
    const repaired = loadDraft(damaged, "mara");
    expect(repaired.repaired).toBe(true);
    expect(repaired.draft.banner).toEqual(base);
  });

  it("the repair path cuts a long message, drops one with a bad id, and leaves no key for none", () => {
    const long = loadDraft(
      { ...draftOf(), blocks: 5, banner: { ...base, text: "x".repeat(300) } },
      "mara",
    );
    expect(long.draft.banner?.text.length).toBe(100);
    expect(
      loadDraft({ ...draftOf(), blocks: 5, banner: { ...base, id: "!" } }, "mara").draft.banner,
    ).toBeUndefined();
    expect("banner" in loadDraft({}, "mara").draft).toBe(false);
  });

  it("a block that repeats the banner's id is dropped by the repair, so ids stay unique", () => {
    const clash = {
      ...draftOf(),
      banner: { ...base, id: blocks.link.id },
      blocks: [blocks.link, blocks.header, "junk"],
    };
    const repaired = loadDraft(clash, "mara");
    expect(repaired.draft.blocks.map((b) => b.id)).toEqual([blocks.header.id]);
  });

  it("the share sanitizer strips hidden characters from the banner's text and label", () => {
    const doc = published({ ...base, text: "Hello‮world", label: "Sh\u0007op" });
    const cleaned = sanitizeSharedDoc({
      ...doc,
      banner: { ...doc.banner!, text: "Hello‮world", label: "Sh\u0007op" },
    });
    expect(cleaned.banner!.text).toBe("Helloworld");
    expect(cleaned.banner!.label).toBe("Shop");
    expect(sanitizeSharedDoc(published()).banner).toBeUndefined();
  });

  it("restoring a version brings its banner back; a version without one restores none", () => {
    const doc = published(base);
    const restored = versionToDraft(doc, { ref: null, overrides: {} }, 4);
    expect(restored.banner).toMatchObject({ id: BANNER_ID, text: base.text, url: base.url });
    expect("banner" in versionToDraft(published(), { ref: null, overrides: {} }, 4)).toBe(false);
    // The image checks are untouched by a banner.
    expect(ownedImagePaths(doc, "owner", "http://x").length).toBe(0);
    expect(nullMissingImages(doc, "owner", "http://x", () => true).missingImages).toBe(0);
  });

  it("bannerFieldOf names the first banner field a Publish error names, in the order text, label, address", () => {
    const err = (field: string, blockId: string | null = null) => ({
      blockId,
      field,
      message: "m",
    });
    expect(bannerFieldOf([])).toBeNull();
    expect(bannerFieldOf([err("banner.url"), err("banner.label")])).toBe("label");
    expect(bannerFieldOf([err("banner.url"), err("banner.text")])).toBe("text");
    expect(bannerFieldOf([err("url", "banner")])).toBe("url");
    expect(bannerFieldOf([err("profile.name"), err("url", "blk-1")])).toBeNull();
    expect(bannerFieldOf([err("banner.id")])).toBeNull();
  });

  it("a failed Publish asks for focus on the banner field, after the display name and the logo", () => {
    const state = initialEditorState({ ...emptyDraft("mara") });
    const next = editorReducer(state, {
      type: "publish/errors",
      errors: [{ blockId: null, field: "banner.label", message: "Add a label for the link." }],
    });
    expect(next.focus).toMatchObject({ kind: "banner-field", field: "label" });
    const both = editorReducer(state, {
      type: "publish/errors",
      errors: [
        { blockId: null, field: "banner.text", message: "x" },
        { blockId: null, field: "profile.name", message: "Add a display name." },
      ],
    });
    expect(both.focus?.kind).toBe("profile-name");
  });

  it("failureTab sends banner errors to the Edit tab, and name font and size errors to Design", () => {
    expect(failureTab([{ blockId: null, field: "banner.text", message: "x" }])).toBe("edit");
    expect(failureTab([{ blockId: "banner", field: "url", message: "x" }])).toBe("edit");
    expect(failureTab([{ blockId: null, field: "profile.nameFont", message: "x" }])).toBe("design");
    expect(failureTab([{ blockId: null, field: "profile.nameSize", message: "x" }])).toBe("design");
    expect(failureTab([{ blockId: null, field: "profile.logo", message: "x" }])).toBe("edit");
    expect(failureTab([{ blockId: null, field: "profile.name", message: "x" }])).toBe("edit");
    expect(
      failureTab([
        { blockId: null, field: "profile.nameFont", message: "x" },
        { blockId: null, field: "share.title", message: "x" },
      ]),
    ).toBe("share");
  });
});
