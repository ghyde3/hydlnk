/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APP_STORE_MESSAGE,
  BOOK_STORE_MESSAGE,
  LINK_FEATURED_VALUE_MESSAGE,
  LINK_ICON_ERROR_MESSAGE,
  STORE_DUPLICATE_MESSAGE,
  URL_ERROR_MESSAGE,
  appStoresLimitMessage,
  bookStoresLimitMessage,
  draftDocSchema,
  type DraftDoc,
} from "@/lib/document";
import { IMAGE_SHAPE_MESSAGE } from "@/lib/document/focus";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminForTests, makeRuntime, type Outcome } from "./support/mcp-db";
import { richDraft } from "./support/mcp-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M10-25 to M10-28 against the local database: update_profile, add_block, update_block, move_block,
 * remove_block and set_theme. Validation is the document's own, images are only by reference, an
 * update changes only what it names, and a refusal writes nothing. Skipped when the stack is not up.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("the write tools (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  const owners: TestOwner[] = [];
  const themes: string[] = [];

  async function owner(
    label: string,
    draft?: (handle: string, id: string) => unknown,
    plan: "free" | "pro" = "pro",
  ) {
    const made = draft
      ? await makeOwner(admin, label, (handle) => ({ __pending: handle }), plan)
      : await makeOwner(admin, label, undefined, plan);
    if (draft) {
      const { error } = await admin
        .from("pages")
        .update({ draft: draft(made.handle, made.userId) as never })
        .eq("id", made.pageId);
      if (error) throw new Error(error.message);
    }
    owners.push(made);
    return made;
  }
  const who = (o: TestOwner) => ({ userId: o.userId });
  const draftOf = async (o: TestOwner) =>
    (await admin.from("pages").select("draft").eq("id", o.pageId).single()).data!.draft as DraftDoc;
  const messages = (out: Outcome) => (out.error?.issues ?? []).map((issue) => issue.message);

  beforeAll(async () => {
    admin = adminForTests();
    rt = await makeRuntime(admin);
  });
  afterAll(async () => {
    if (themes.length > 0) await admin.from("themes").delete().in("id", themes);
    await removeOwners(admin, owners);
  });

  // -------------------------------------------------------------------------------------------
  describe("update_profile", () => {
    it("changes the name and bio, one line each, hidden characters removed, and says so", async () => {
      const o = await owner("up-basic", (h, id) => richDraft(h, id));
      const out = await rt.call(
        "update_profile",
        { pageId: o.pageId, name: "Mara ‮evil‬ Okafor", bio: "Line one\nline two" },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.text).toBe("Updated your profile.");
      expect(out.json).toMatchObject({
        unchanged: false,
        rev: 4,
        profile: { name: "Mara evil Okafor", bio: "Line one line two" },
      });
      const stored = await draftOf(o);
      expect(stored.profile.name).toBe("Mara evil Okafor");
      expect(stored.profile.bio).toBe("Line one line two");
      expect(stored.profile.name).not.toMatch(/[‪-‮]/);
    });

    it("applies the options through the document's helper and the booleans as real booleans", async () => {
      const o = await owner("up-options", (h, id) => richDraft(h, id));
      const out = await rt.call(
        "update_profile",
        {
          pageId: o.pageId,
          photoShape: "circle",
          photoSize: "small",
          photoBorder: "none",
          showName: false,
          showBio: true,
        },
        who(o),
      );
      expect(out.json!.profile).toMatchObject({
        photoShape: "circle",
        photoSize: "small",
        photoBorder: "none",
        showName: false,
        showBio: true,
        showPhoto: true,
      });
      const stored = await draftOf(o);
      expect(stored.profile).toMatchObject({
        photoShape: "circle",
        showName: false,
        showBio: true,
        nameSize: "large",
      });
    });

    it.each([
      ["a 61-character name", { name: "x".repeat(61) }, "Use 60 characters or fewer."],
      ["an empty name", { name: "   " }, "Add a display name."],
      ["a bad shape", { photoShape: "hexagon" }, "Choose a photo shape from the list."],
      ["a bad size", { photoSize: "huge" }, "Choose a photo size from the list."],
      ["a bad border", { photoBorder: "dotted" }, "Choose a photo border from the list."],
      ["a string where a boolean goes", { showName: "false" }, "Choose on or off."],
      ["nothing at all", {}, "Nothing to change."],
      ["a bio over 160 characters", { bio: "b".repeat(161) }, "Use 160 characters or fewer."],
      ["an unknown key", { nickname: "x" }, "Unknown field"],
    ])("%s is invalid_input and writes nothing", async (_label, input, wanted) => {
      const o = await owner("up-bad", (h, id) => richDraft(h, id));
      const before = await draftOf(o);
      const out = await rt.call("update_profile", { pageId: o.pageId, ...input }, who(o));
      expect(out.error!.code).toBe("invalid_input");
      expect(messages(out).join(" ") + out.error!.message).toContain(wanted);
      expect(await draftOf(o)).toEqual(before);
    });

    it("the same values again are unchanged: no write, the same rev, the same bytes", async () => {
      const o = await owner("up-same", (h, id) => richDraft(h, id));
      const raw = (
        await admin.from("pages").select("draft, updated_at").eq("id", o.pageId).single()
      ).data!;
      const out = await rt.call(
        "update_profile",
        {
          pageId: o.pageId,
          name: "Mara Okafor",
          bio: "Ceramics and slow mornings.",
          showBio: false,
        },
        who(o),
      );
      expect(out.json).toMatchObject({ unchanged: true, rev: 3 });
      const after = (
        await admin.from("pages").select("draft, updated_at").eq("id", o.pageId).single()
      ).data!;
      expect(JSON.stringify(after.draft)).toBe(JSON.stringify(raw.draft));
      expect(after.updated_at).toBe(raw.updated_at);
    });

    it("a stale ifRev is a conflict with nothing written, and the others refuse as they do everywhere", async () => {
      const o = await owner("up-guards", (h, id) => richDraft(h, id));
      const before = await draftOf(o);
      expect(
        (await rt.call("update_profile", { pageId: o.pageId, ifRev: 1, name: "X" }, who(o))).error!
          .code,
      ).toBe("conflict");
      expect(
        (
          await rt.call(
            "update_profile",
            { pageId: o.pageId, name: "X" },
            { ...who(o), scopes: ["hydlnk.read"] },
          )
        ).error!.code,
      ).toBe("insufficient_scope");
      const stranger = await owner("up-stranger");
      expect(
        (await rt.call("update_profile", { pageId: o.pageId, name: "X" }, who(stranger))).error!
          .code,
      ).toBe("not_found");
      expect(await draftOf(o)).toEqual(before);
    });

    it("the photo is only by reference: an imageId on one of your pages, or null to remove it", async () => {
      const o = await owner("up-photo", (h, id) => richDraft(h, id));
      const other = await owner("up-photo-b", (h, id) => ({
        ...richDraft(h, id),
        profile: {
          ...richDraft(h, id).profile,
          photo: { path: `${id}/stranger00001.webp`, width: 10, height: 10 },
        },
      }));
      const used = await rt.call(
        "update_profile",
        { pageId: o.pageId, photo: { imageId: "glaze000001.webp" } },
        who(o),
      );
      expect(used.json!.profile.photo).toEqual({
        imageId: "glaze000001.webp",
        width: 800,
        height: 400,
      });
      expect((await draftOf(o)).profile.photo).toEqual({
        path: `${o.userId}/glaze000001.webp`,
        width: 800,
        height: 400,
      });
      const cleared = await rt.call("update_profile", { pageId: o.pageId, photo: null }, who(o));
      expect(cleared.json!.profile.photo).toBeNull();
      expect((await draftOf(o)).profile.photo).toBeNull();
      for (const imageId of ["stranger00001.webp", "missing000001.webp"]) {
        expect(
          (await rt.call("update_profile", { pageId: o.pageId, photo: { imageId } }, who(o))).error!
            .code,
          imageId,
        ).toBe("image_not_found");
      }
      for (const imageId of [
        "https://example.com/a.png",
        `${other.userId}/stranger00001.webp`,
        "../x.webp",
        "a/b.webp",
      ]) {
        expect(
          (await rt.call("update_profile", { pageId: o.pageId, photo: { imageId } }, who(o))).error!
            .code,
          imageId,
        ).toBe("invalid_input");
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("add_block", () => {
    const VALID: Array<[string, Record<string, unknown>]> = [
      [
        "link",
        { label: "Book", url: "https://example.com/book", icon: "github", featured: "bold" },
      ],
      [
        "card",
        { title: "Card", caption: "cap", url: "https://example.com", image: "photo0000001.webp" },
      ],
      ["header", { text: "Hello" }],
      ["text", { text: "Some text\nsecond line" }],
      ["image", { image: "photo0000001.webp", alt: "A picture", shape: "square" }],
      [
        "social",
        {
          icons: [
            { platform: "github", url: "https://github.com/x" },
            { platform: "email", address: "a@b.co" },
          ],
        },
      ],
      ["embed", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: "Video" }],
      [
        "grid",
        {
          cells: [
            { title: "A", url: "https://a.example.com" },
            { title: "B", subtitle: "sub", url: "https://b.example.com" },
          ],
        },
      ],
      ["divider", {}],
      ["faq", { items: [{ question: "Q?", answer: "A." }] }],
      [
        "contact",
        { name: "Mara", phone: "+1 555 123 4567", email: "m@example.com", hours: "9 to 5" },
      ],
      ["discount", { code: "SPRING", description: "10% off", url: "https://shop.example.com" }],
      [
        "book",
        {
          title: "Book",
          author: "Au",
          cover: "photo0000001.webp",
          links: [{ store: "amazon", url: "https://amazon.com/x" }],
        },
      ],
      ["apps", { links: [{ store: "appstore", url: "https://apps.apple.com/x" }] }],
      ["map", { name: "Cafe", address: "1 Main St" }],
    ];

    it("adds a block of every one of the fifteen types, validated, readable by get_page, with fresh unique ids", async () => {
      const o = await owner("ab-all", (h, id) => ({ ...richDraft(h, id), blocks: [] }));
      let index = 0;
      for (const [type, fields] of VALID) {
        const out = await rt.call("add_block", { pageId: o.pageId, type, fields }, who(o));
        expect(out.isError, `${type}: ${JSON.stringify(out.error)}`).toBe(false);
        expect(out.json).toMatchObject({ index, block: { type, visible: true } });
        expect(out.text).toMatch(new RegExp(`^Added an? .+ block at position ${index + 1}\\.$`));
        index += 1;
      }
      const stored = await draftOf(o);
      expect(stored.blocks.map((block) => block.type)).toEqual(VALID.map(([type]) => type));
      expect(draftDocSchema.safeParse(stored).success).toBe(true);
      const page = await rt.call("get_page", { pageId: o.pageId }, who(o));
      expect(page.json!.blocks).toHaveLength(15);
      // Nested items and the map's two ids are fresh and unique across the page.
      const ids: string[] = [];
      for (const block of stored.blocks as any[]) {
        ids.push(
          block.id,
          ...(block.icons ?? []).map((i: any) => i.id),
          ...(block.cells ?? []).map((i: any) => i.id),
          ...(block.items ?? []).map((i: any) => i.id),
          ...(block.links ?? []).map((i: any) => i.id),
        );
        if (block.type === "map") ids.push(block.googleId, block.appleId);
      }
      expect(new Set(ids).size).toBe(ids.length);
      expect(page.json!.publishIssues).toEqual([]);
    });

    it("a hidden block is exempt from completeness, and control and bidirectional characters are stripped", async () => {
      const o = await owner("ab-hidden", (h, id) => ({ ...richDraft(h, id), blocks: [] }));
      const hidden = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "link", visible: false, fields: { label: "Later" } },
        who(o),
      );
      expect(hidden.isError, JSON.stringify(hidden.error)).toBe(false);
      expect((hidden.json!.block as any).visible).toBe(false);
      const clean = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "header", fields: { text: "Hello‮ world\u0007!" } },
        who(o),
      );
      // A control character is a line break to `singleLine`: it becomes one space; the bidi override is removed.
      expect((clean.json!.block as any).text).toBe("Hello world !");
    });

    it.each([
      ["link, empty label", "link", { label: "" }, "Add a link label."],
      [
        "link, javascript: url",
        "link",
        { label: "x", url: "javascript:alert(1)" },
        URL_ERROR_MESSAGE,
      ],
      ["link, no url", "link", { label: "x" }, URL_ERROR_MESSAGE],
      [
        "link, featured sparkle",
        "link",
        { label: "x", url: "https://example.com", featured: "sparkle" },
        LINK_FEATURED_VALUE_MESSAGE,
      ],
      [
        "link, icon outside the 24",
        "link",
        { label: "x", url: "https://example.com", icon: "rocket-ship" },
        LINK_ICON_ERROR_MESSAGE,
      ],
      [
        "text over 600 characters",
        "text",
        { text: "t".repeat(601) },
        "Use 600 characters or fewer.",
      ],
      [
        "faq with 11 items",
        "faq",
        { items: Array.from({ length: 11 }, () => ({ question: "q", answer: "a" })) },
        "Use up to 10 questions.",
      ],
      [
        "grid with 7 cells",
        "grid",
        { cells: Array.from({ length: 7 }, () => ({ title: "t", url: "https://example.com" })) },
        "Use 2 to 6 cells.",
      ],
      [
        "grid with 1 cell",
        "grid",
        { cells: [{ title: "t", url: "https://example.com" }] },
        "Use 2 to 6 cells.",
      ],
      [
        "social with 9 icons",
        "social",
        {
          icons: Array.from({ length: 9 }, () => ({
            platform: "github",
            url: "https://github.com/x",
          })),
        },
        "Use 1 to 8 icons.",
      ],
      [
        "social, myspace",
        "social",
        { icons: [{ platform: "myspace", url: "https://myspace.com/x" }] },
        "Choose a platform from:",
      ],
      [
        "social, email with a url",
        "social",
        { icons: [{ platform: "email", url: "https://example.com" }] },
        "An email icon takes address, not url.",
      ],
      ["embed, a host outside the list", "embed", { url: "https://evil.example/video" }, "YouTube"],
      ["embed, javascript:", "embed", { url: "javascript:alert(1)" }, "YouTube"],
      ["embed, data:", "embed", { url: "data:text/html,<script>1</script>" }, "YouTube"],
      [
        "contact, no phone or email",
        "contact",
        { name: "Mara" },
        "Add a phone number or an email address.",
      ],
      [
        "discount, a code with a space",
        "discount",
        { code: "TWO WORDS" },
        "Enter a code with no spaces.",
      ],
      [
        "book, an unknown store",
        "book",
        { title: "t", links: [{ store: "abebooks", url: "https://example.com" }] },
        BOOK_STORE_MESSAGE,
      ],
      [
        "book, the same store twice",
        "book",
        {
          title: "t",
          links: [
            { store: "amazon", url: "https://example.com" },
            { store: "amazon", url: "https://example.org" },
          ],
        },
        STORE_DUPLICATE_MESSAGE,
      ],
      [
        "book, 4 links",
        "book",
        {
          title: "t",
          links: ["amazon", "apple", "bookshop", "amazon"].map((store) => ({
            store,
            url: "https://example.com",
          })),
        },
        bookStoresLimitMessage(3),
      ],
      [
        "apps, a third store",
        "apps",
        {
          links: ["appstore", "googleplay", "appstore"].map((store) => ({
            store,
            url: "https://example.com",
          })),
        },
        appStoresLimitMessage(2),
      ],
      [
        "apps, an unknown store",
        "apps",
        { links: [{ store: "fdroid", url: "https://example.com" }] },
        APP_STORE_MESSAGE,
      ],
      ["map, an empty address", "map", { name: "Cafe", address: "" }, "Add an address."],
      [
        "image, shape round",
        "image",
        { image: "photo0000001.webp", alt: "x", shape: "round" },
        IMAGE_SHAPE_MESSAGE,
      ],
      ["image, no image", "image", { alt: "x" }, "Upload an image."],
      [
        "a bad block color",
        "link",
        { label: "x", url: "https://example.com", overrides: { accent: "red" } },
        "Color isn’t a valid hex color",
      ],
    ])(
      "%s is refused with the document's own words and nothing is stored",
      async (_label, type, fields, wanted) => {
        const o = await owner("ab-bad", (h, id) => ({ ...richDraft(h, id), blocks: [] }));
        const before = await draftOf(o);
        const out = await rt.call("add_block", { pageId: o.pageId, type, fields }, who(o));
        expect(out.error!.code).toBe("invalid_input");
        expect([...messages(out), out.error!.message].join(" ")).toContain(wanted);
        expect(await draftOf(o)).toEqual(before);
      },
    );

    it("an unknown field is refused by name with the allowed ones listed, and ids, locks, UTM tags and marks cannot be set", async () => {
      const o = await owner("ab-keys", (h, id) => ({ ...richDraft(h, id), blocks: [] }));
      const unknown = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          type: "link",
          fields: { label: "x", url: "https://example.com", colour: "red" },
        },
        who(o),
      );
      expect(unknown.error!.message).toContain("colour");
      expect(unknown.error!.message).toContain("Allowed: label, url, icon, featured, overrides.");
      const unsettable: Array<[string, string, Record<string, unknown>]> = [
        [
          "link",
          "Ids are made by HYDLNK",
          { id: "mine-0001-aaaa", label: "x", url: "https://example.com" },
        ],
        [
          "link",
          "A link’s lock can only be set in the app.",
          { lock: { kind: "age" }, label: "x", url: "https://example.com" },
        ],
        [
          "link",
          "A link’s UTM tags can only be set in the app.",
          { utm: { source: "x" }, label: "x", url: "https://example.com" },
        ],
        ["text", "Text formatting can only be set in the app.", { text: "hi", marks: [] }],
        [
          "social",
          "Ids are made by HYDLNK",
          { icons: [{ id: "icon-mine-001", platform: "github", url: "https://github.com/x" }] },
        ],
        ["header", "visible is its own argument", { text: "x", visible: false }],
        ["header", "A block’s type can’t change", { text: "x", type: "link" }],
      ];
      for (const [type, wanted, fields] of unsettable) {
        const out = await rt.call("add_block", { pageId: o.pageId, type, fields }, who(o));
        expect(out.error!.code, wanted).toBe("invalid_input");
        expect(out.error!.message + JSON.stringify(out.error!.issues), wanted).toContain(wanted);
      }
      expect((await draftOf(o)).blocks).toHaveLength(0);
    });

    it("images only by imageId: a URL, a typed path, another user's image or an unknown id is refused, and nothing is fetched", async () => {
      const o = await owner("ab-images", (h, id) => ({ ...richDraft(h, id), blocks: [] }));
      const other = await owner("ab-images-b", (h, id) => ({
        ...richDraft(h, id),
        profile: {
          ...richDraft(h, id).profile,
          photo: { path: `${id}/stranger00002.webp`, width: 10, height: 10 },
        },
      }));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const httpSpy = vi.spyOn(http, "request");
      const httpsSpy = vi.spyOn(https, "request");
      const lookupSpy = vi.spyOn(dns, "lookup");
      try {
        const refused: Array<[string, string, unknown]> = [
          ["card", "image", "https://example.com/a.png"],
          ["card", "image", `${o.userId}/photo0000001.webp`],
          ["image", "image", "../../etc/passwd"],
          ["book", "cover", "http://169.254.169.254/latest"],
          ["card", "image", "stranger00002.webp"],
          ["card", "image", "unknownimg001.webp"],
        ];
        for (const [type, key, value] of refused) {
          const fields =
            type === "image"
              ? { alt: "x", [key]: value }
              : type === "book"
                ? { title: "x", [key]: value }
                : { title: "x", url: "https://example.com", [key]: value };
          const out = await rt.call("add_block", { pageId: o.pageId, type, fields }, who(o));
          expect(["invalid_input", "image_not_found"], `${type} ${String(value)}`).toContain(
            out.error!.code,
          );
          expect(
            out.error!.code === "invalid_input" ? messages(out).join(" ") : out.error!.message,
          ).toMatch(
            /Images must already be uploaded\. Use an imageId from get_page\.|That image isn’t on any of your pages\. Upload it in the editor first\./,
          );
        }
        const notOnAnyPage = await rt.call(
          "add_block",
          {
            pageId: o.pageId,
            type: "card",
            fields: { title: "x", url: "https://example.com", image: "unknownimg001.webp" },
          },
          who(o),
        );
        expect(notOnAnyPage.error).toMatchObject({
          code: "image_not_found",
          message: "That image isn’t on any of your pages. Upload it in the editor first.",
        });
        expect(other.userId).toBeTruthy();
        // Every call above plus a good one: no request left the process but the database's.
        const good = await rt.call(
          "add_block",
          {
            pageId: o.pageId,
            type: "card",
            fields: { title: "ok", url: "https://example.com", image: "photo0000001.webp" },
          },
          who(o),
        );
        expect(good.isError).toBe(false);
        // The database is the one thing a tool talks to: no fetch goes anywhere else.
        const hosts = fetchSpy.mock.calls.map((args) =>
          String(args[0] instanceof Request ? args[0].url : args[0]),
        );
        expect(hosts.length).toBeGreaterThan(0);
        for (const target of hosts)
          expect(target.startsWith(process.env.NEXT_PUBLIC_SUPABASE_URL!), target).toBe(true);
        expect(httpSpy).not.toHaveBeenCalled();
        expect(httpsSpy).not.toHaveBeenCalled();
        expect(lookupSpy).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
      expect((await draftOf(o)).blocks).toHaveLength(1);
    });

    it("position: an index, after another block, the default end; an unknown id or an index out of range is invalid_input", async () => {
      const o = await owner("ab-pos", (h, id) => ({ ...richDraft(h, id), blocks: [] }));
      const add = (text: string, position?: unknown) =>
        rt.call(
          "add_block",
          { pageId: o.pageId, type: "header", fields: { text }, ...(position ? { position } : {}) },
          who(o),
        );
      const a = await add("A");
      const b = await add("B");
      const c = await add("C", { index: 0 });
      const d = await add("D", { afterBlockId: a.json!.blockId });
      expect((await draftOf(o)).blocks.map((block: any) => block.text)).toEqual([
        "C",
        "A",
        "D",
        "B",
      ]);
      expect(b.json!.index).toBe(1);
      expect(c.json!.index).toBe(0);
      expect(d.json!.index).toBe(2);
      expect((await add("E", { index: 9 })).error!.code).toBe("invalid_input");
      expect((await add("F", { afterBlockId: "nope" })).error!.code).toBe("invalid_input");
      expect((await draftOf(o)).blocks).toHaveLength(4);
    });

    it("a blocked link stores nothing (HL005) and the 51st block is block_limit", async () => {
      const o = await owner("ab-limit", (h, id) => ({
        ...richDraft(h, id),
        blocks: Array.from({ length: 50 }, (_, n) => ({
          id: `limit-block-${String(n).padStart(3, "0")}`,
          type: "divider",
          visible: true,
        })),
      }));
      expect(
        (await rt.call("add_block", { pageId: o.pageId, type: "divider" }, who(o))).error!.code,
      ).toBe("block_limit");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("update_block", () => {
    const blockOf = async (o: TestOwner, id: string) =>
      (await draftOf(o)).blocks.find((block) => block.id === id) as any;

    it("scalars given replace, omitted ones stay, null clears an optional field, and the same call again changes nothing", async () => {
      const o = await owner("ub-scalar", (h, id) => richDraft(h, id));
      const input = {
        pageId: o.pageId,
        blockId: "link-id-001",
        fields: { label: "Visit", featured: null, icon: "github" },
      };
      const first = await rt.call("update_block", input, who(o));
      expect(first.isError, JSON.stringify(first.error)).toBe(false);
      const link = await blockOf(o, "link-id-001");
      expect(link).toMatchObject({
        label: "Visit",
        url: "https://example.com/shop",
        icon: { type: "builtin", name: "github" },
        lock: { kind: "age" },
      });
      expect(link).not.toHaveProperty("featured");
      const rev = (await draftOf(o)).rev;
      const again = await rt.call("update_block", input, who(o));
      expect(again.json).toMatchObject({ unchanged: true, rev });
      expect((await draftOf(o)).rev).toBe(rev);
      const cleared = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { icon: null } },
        who(o),
      );
      expect(cleared.isError).toBe(false);
      expect(await blockOf(o, "link-id-001")).not.toHaveProperty("icon");
    });

    it("a list replaces the list: an item keeps its id by position or by its own id, extras are new, dropped ones go", async () => {
      const o = await owner("ub-lists", (h, id) => richDraft(h, id));
      // The second icon keeps its id when its address changes (analytics history survives).
      await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          blockId: "social-id-01",
          fields: {
            icons: [
              { platform: "github", url: "https://github.com/new" },
              { id: "icon-id-0002", address: "new@example.com" },
            ],
          },
        },
        who(o),
      );
      let social = await blockOf(o, "social-id-01");
      expect(social.icons).toEqual([
        { id: "icon-id-0001", platform: "github", url: "https://github.com/new" },
        { id: "icon-id-0002", platform: "email", address: "new@example.com" },
      ]);
      // An extra item is new; sending one fewer drops one.
      await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          blockId: "social-id-01",
          fields: {
            icons: [
              { id: "icon-id-0002" },
              { platform: "x", url: "https://x.com/m" },
              { platform: "github", url: "https://github.com/m" },
            ],
          },
        },
        who(o),
      );
      social = await blockOf(o, "social-id-01");
      expect(social.icons[0]).toEqual({
        id: "icon-id-0002",
        platform: "email",
        address: "new@example.com",
      });
      expect(social.icons[1].platform).toBe("x");
      expect(social.icons[1].id).not.toBe("icon-id-0001");
      expect(social.icons).toHaveLength(3);
      await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "social-id-01", fields: { icons: [{ id: "icon-id-0002" }] } },
        who(o),
      );
      expect((await blockOf(o, "social-id-01")).icons).toHaveLength(1);
      // A made-up id is refused.
      const made = await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          blockId: "social-id-01",
          fields: { icons: [{ id: "invented-id-01", platform: "x", url: "https://x.com/m" }] },
        },
        who(o),
      );
      expect(made.error!.code).toBe("invalid_input");
      expect(made.error!.message).toContain("isn’t one of this block’s icons");
    });

    it("overrides merge key by key and null removes one; changing text clears marks and says so", async () => {
      const o = await owner("ub-overrides", (h, id) => richDraft(h, id));
      await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          blockId: "link-id-001",
          fields: { overrides: { radius: 8, accent: null } },
        },
        who(o),
      );
      expect((await blockOf(o, "link-id-001")).overrides).toEqual({ radius: 8 });
      await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { overrides: { radius: null } } },
        who(o),
      );
      expect(await blockOf(o, "link-id-001")).not.toHaveProperty("overrides");
      const bad = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { overrides: { radius: 99 } } },
        who(o),
      );
      expect(bad.error!.message).toContain("Corner radius isn’t valid");
      const same = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "text-id-001", fields: { text: "Hello world, welcome in" } },
        who(o),
      );
      expect(same.json).toMatchObject({ unchanged: true });
      expect(await blockOf(o, "text-id-001")).toHaveProperty("marks");
      const changed = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "text-id-001", fields: { text: "Brand new words" } },
        who(o),
      );
      expect(changed.text).toContain("formatting was cleared");
      expect(changed.json).toMatchObject({ formattingCleared: true });
      const text = await blockOf(o, "text-id-001");
      expect(text.text).toBe("Brand new words");
      expect(text).not.toHaveProperty("marks");
    });

    it("hiding works on a half-filled block, showing an incomplete one is refused in Publish's words, and the type cannot change", async () => {
      const o = await owner("ub-visible", (h, id) => richDraft(h, id));
      const added = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "link", visible: false, fields: { label: "Half" } },
        who(o),
      );
      const id = added.json!.blockId as string;
      const show = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: id, visible: true },
        who(o),
      );
      expect(show.error!.code).toBe("invalid_input");
      expect(messages(show).join(" ")).toContain(URL_ERROR_MESSAGE);
      expect(((await blockOf(o, id)) as any).visible).toBe(false);
      const hide = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", visible: false },
        who(o),
      );
      expect(hide.isError).toBe(false);
      const type = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { type: "card" } },
        who(o),
      );
      expect(type.error!.message).toContain("A block’s type can’t change");
      // Fixing the missing field and showing in one call works.
      const fixed = await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          blockId: id,
          visible: true,
          fields: { url: "https://example.com/half" },
        },
        who(o),
      );
      expect(fixed.isError, JSON.stringify(fixed.error)).toBe(false);
    });

    it("an unknown id, another page's id and another user's id are block_not_found, a stale ifRev is conflict, and an image is by reference", async () => {
      const o = await owner("ub-guards", (h, id) => richDraft(h, id));
      const stranger = await owner("ub-guards-b", (h, id) => richDraft(h, id));
      const before = await draftOf(o);
      expect(
        (
          await rt.call(
            "update_block",
            { pageId: o.pageId, blockId: "nope", fields: { label: "x" } },
            who(o),
          )
        ).error,
      ).toMatchObject({
        code: "block_not_found",
        message: "No block with that id on this page. Call get_page.",
      });
      expect(
        (
          await rt.call(
            "update_block",
            { pageId: stranger.pageId, blockId: "link-id-001", fields: { label: "Hijack" } },
            who(o),
          )
        ).error!.code,
      ).toBe("not_found");
      expect(
        (
          await rt.call(
            "update_block",
            { pageId: o.pageId, ifRev: 1, blockId: "link-id-001", fields: { label: "x" } },
            who(o),
          )
        ).error!.code,
      ).toBe("conflict");
      const url = await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          blockId: "card-id-0001",
          fields: { image: "https://example.com/x.png" },
        },
        who(o),
      );
      expect(messages(url).join(" ")).toContain("Images must already be uploaded");
      expect(await draftOf(o)).toEqual(before);
      expect((await draftOf(stranger)).blocks[0]).toMatchObject({ label: "Shop" });
      const swapped = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "card-id-0001", fields: { image: "photo0000001.webp" } },
        who(o),
      );
      expect(swapped.isError).toBe(false);
      expect((await blockOf(o, "card-id-0001")).image).toMatchObject({
        path: `${o.userId}/photo0000001.webp`,
        width: 600,
        height: 600,
      });
    });

    it("only the named fields change, and an item the caller edits keeps its click-history id", async () => {
      const o = await owner("ub-exact", (h, id) => richDraft(h, id));
      const before = await blockOf(o, "card-id-0001");
      await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "card-id-0001", fields: { caption: "New caption" } },
        who(o),
      );
      const after = await blockOf(o, "card-id-0001");
      expect(after).toEqual({ ...before, caption: "New caption" });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("move_block and remove_block", () => {
    const order = async (o: TestOwner) => (await draftOf(o)).blocks.map((block) => block.id);

    it("moves by index, after another block, or to the first or last place, and lists the new order", async () => {
      const o = await owner("mb-moves", (h, id) => richDraft(h, id));
      const start = await order(o);
      const first = await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: start[3], position: "first" },
        who(o),
      );
      expect(first.json!.order.map((item: { id: string }) => item.id)).toEqual([
        start[3],
        start[0],
        start[1],
        start[2],
        start[4],
        start[5],
      ]);
      expect(first.json!.order[0]).toEqual({ id: start[3], type: "social" });
      expect(await order(o)).toEqual([start[3], start[0], start[1], start[2], start[4], start[5]]);
      await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: start[3], position: "last" },
        who(o),
      );
      expect(await order(o)).toEqual([start[0], start[1], start[2], start[4], start[5], start[3]]);
      await rt.call("move_block", { pageId: o.pageId, blockId: start[3], toIndex: 1 }, who(o));
      expect((await order(o))[1]).toBe(start[3]);
      await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: start[3], afterBlockId: start[5] },
        who(o),
      );
      expect((await order(o)).at(-1)).toBe(start[3]);
    });

    it("moving to where it already is changes nothing, and only the order changes otherwise", async () => {
      const o = await owner("mb-same", (h, id) => richDraft(h, id));
      const before = await draftOf(o);
      const same = await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: "link-id-001", toIndex: 0 },
        who(o),
      );
      expect(same.json).toMatchObject({ unchanged: true, rev: before.rev });
      expect(await draftOf(o)).toEqual(before);
      await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: "map-id-00001", position: "first" },
        who(o),
      );
      const after = await draftOf(o);
      expect(after.rev).toBe(before.rev + 1);
      const byId = (draft: DraftDoc) =>
        Object.fromEntries(draft.blocks.map((block) => [block.id, block]));
      expect(byId(after)).toEqual(byId(before));
      expect({ ...after, blocks: [], rev: 0 }).toEqual({ ...before, blocks: [], rev: 0 });
    });

    it.each([
      ["none of the three", {}],
      ["two of the three", { toIndex: 1, position: "first" }],
      ["an index out of range", { toIndex: 99 }],
      ["after itself", { afterBlockId: "link-id-001" }],
      ["after an unknown block", { afterBlockId: "nope" }],
    ])("%s is invalid_input and moves nothing", async (_label, extra) => {
      const o = await owner("mb-bad", (h, id) => richDraft(h, id));
      const before = await draftOf(o);
      const out = await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: "link-id-001", ...extra },
        who(o),
      );
      expect(out.error!.code).toBe("invalid_input");
      expect(await draftOf(o)).toEqual(before);
    });

    it("an unknown block is block_not_found and a stale ifRev is conflict", async () => {
      const o = await owner("mb-guards", (h, id) => richDraft(h, id));
      expect(
        (
          await rt.call(
            "move_block",
            { pageId: o.pageId, blockId: "nope", position: "first" },
            who(o),
          )
        ).error!.code,
      ).toBe("block_not_found");
      expect(
        (
          await rt.call(
            "move_block",
            { pageId: o.pageId, ifRev: 0, blockId: "link-id-001", position: "last" },
            who(o),
          )
        ).error!.code,
      ).toBe("conflict");
    });

    it("removes that block and nothing else, says how many are left, and a second removal is block_not_found", async () => {
      const o = await owner("rb-basic", (h, id) => richDraft(h, id));
      const before = await draftOf(o);
      const out = await rt.call(
        "remove_block",
        { pageId: o.pageId, blockId: "social-id-01" },
        who(o),
      );
      expect(out.text).toBe("Removed a social block. 5 blocks left.");
      expect(out.json).toEqual({
        removedBlockId: "social-id-01",
        removedType: "social",
        blocksLeft: 5,
        rev: before.rev + 1,
      });
      expect((await draftOf(o)).blocks).toEqual(
        before.blocks.filter((block) => block.id !== "social-id-01"),
      );
      expect(
        (await rt.call("remove_block", { pageId: o.pageId, blockId: "social-id-01" }, who(o)))
          .error!.code,
      ).toBe("block_not_found");
      expect(
        (
          await rt.call(
            "remove_block",
            { pageId: o.pageId, ifRev: 1, blockId: "map-id-00001" },
            who(o),
          )
        ).error!.code,
      ).toBe("conflict");
    });

    it("removing the last block leaves a valid empty page", async () => {
      const o = await owner("rb-last", (h, id) => ({
        ...richDraft(h, id),
        blocks: [{ id: "only-block-01", type: "divider", visible: true }],
      }));
      const out = await rt.call(
        "remove_block",
        { pageId: o.pageId, blockId: "only-block-01" },
        who(o),
      );
      expect(out.json!.blocksLeft).toBe(0);
      expect(draftDocSchema.safeParse(await draftOf(o)).success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("set_theme", () => {
    async function savedTheme(o: TestOwner, name: string) {
      const system = (
        await admin.from("themes").select("tokens").eq("name", "Noir").is("owner_id", null).single()
      ).data!.tokens;
      const { data, error } = await admin
        .from("themes")
        .insert({ owner_id: o.userId, name, tokens: system })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      themes.push(data.id);
      return data.id as string;
    }
    const systemId = async (name: string) =>
      (await admin.from("themes").select("id").eq("name", name).is("owner_id", null).single()).data!
        .id as string;

    it("applies a system theme by name in any letter case, or by id, and clears the page's own style values", async () => {
      const o = await owner("st-apply", (h, id) => richDraft(h, id));
      const noir = await systemId("Noir");
      const out = await rt.call("set_theme", { pageId: o.pageId, theme: "  nOiR " }, who(o));
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.text).toBe("Applied the Noir theme.");
      expect(out.json).toMatchObject({
        theme: { kind: "system", id: noir, name: "Noir" },
        overrides: {},
        unchanged: false,
      });
      expect((await draftOf(o)).theme).toEqual({ ref: noir, overrides: {} });
      const again = await rt.call("set_theme", { pageId: o.pageId, theme: noir }, who(o));
      expect(again.json).toMatchObject({ unchanged: true });
      const none = await rt.call("set_theme", { pageId: o.pageId, theme: null }, who(o));
      expect((await draftOf(o)).theme).toEqual({ ref: null, overrides: {} });
      expect(none.json).toMatchObject({ theme: { kind: "none", id: null, name: null } });
    });

    it("sets validated style values on top, merges key by key, and clearOverrides empties them", async () => {
      const o = await owner("st-overrides", (h, id) => ({
        ...richDraft(h, id),
        theme: { ref: null, overrides: {} },
      }));
      await rt.call(
        "set_theme",
        { pageId: o.pageId, overrides: { accent: "#AA0000", radius: 10 } },
        who(o),
      );
      await rt.call(
        "set_theme",
        { pageId: o.pageId, overrides: { fontHeading: "Fraunces" } },
        who(o),
      );
      expect((await draftOf(o)).theme.overrides).toEqual({
        accent: "#AA0000",
        radius: 10,
        fontHeading: "Fraunces",
      });
      const both = await rt.call(
        "set_theme",
        { pageId: o.pageId, theme: "Ivory", overrides: { accent: "#00AA00" } },
        who(o),
      );
      expect((await draftOf(o)).theme.overrides).toEqual({ accent: "#00AA00" });
      expect(both.json!.theme.name).toBe("Ivory");
      await rt.call("set_theme", { pageId: o.pageId, clearOverrides: true }, who(o));
      expect((await draftOf(o)).theme.overrides).toEqual({});
    });

    it.each([
      ["a bad color", { bg: "not-a-color" }, "Page background isn’t a valid color."],
      ["a bad accent", { accent: "#12" }, "Accent isn’t a valid color."],
      ["a font outside the list", { fontBody: "Comic Sans" }, "Body font isn’t an available font."],
      ["a radius out of range", { radius: 99 }, "Corner radius isn’t valid."],
      [
        "a background image",
        { bgImage: "https://example.com/x.png" },
        "Background image takes an uploaded image and can only be set in the app.",
      ],
      [
        "a made-up key",
        { background: "#000000" },
        "isn’t a style setting. You can set: Page background",
      ],
    ])(
      "%s is refused in the Design screen's words and nothing changes",
      async (_label, overrides, wanted) => {
        const o = await owner("st-bad", (h, id) => richDraft(h, id));
        const before = await draftOf(o);
        const out = await rt.call("set_theme", { pageId: o.pageId, overrides }, who(o));
        expect(out.error!.code).toBe("invalid_input");
        expect([...messages(out), out.error!.message].join(" ")).toContain(wanted);
        expect([...messages(out), out.error!.message].join(" ")).not.toMatch(
          /bgImage|fontBody|buttonBg|overlayOpacity/,
        );
        expect(await draftOf(o)).toEqual(before);
      },
    );

    it("an unknown theme lists up to 25 names and never another user's, and a saved theme of the caller works", async () => {
      const a = await owner("st-names-a", (h, id) => richDraft(h, id));
      const b = await owner("st-names-b", (h, id) => richDraft(h, id));
      const theirs = await savedTheme(b, "Their secret theme");
      const mine = await savedTheme(a, "My own look");
      const missing = await rt.call("set_theme", { pageId: a.pageId, theme: "Noirr" }, who(a));
      expect(missing.error!.code).toBe("theme_not_found");
      expect(missing.error!.message).toMatch(/^No theme called “Noirr”\. Available: Noir, /);
      expect(missing.error!.message).toContain("My own look");
      expect(missing.error!.message).not.toContain("Their secret theme");
      const byTheirId = await rt.call("set_theme", { pageId: a.pageId, theme: theirs }, who(a));
      expect(byTheirId.error!.code).toBe("theme_not_found");
      expect(byTheirId.error!.message).not.toContain("Their secret theme");
      expect(JSON.stringify(byTheirId.raw)).not.toContain(b.userId);
      const ok = await rt.call("set_theme", { pageId: a.pageId, theme: "my own look" }, who(a));
      expect(ok.json).toMatchObject({ theme: { kind: "saved", id: mine, name: "My own look" } });
    });

    it("two themes with one name are ambiguous: invalid_input with ids, never a silent pick", async () => {
      const a = await owner("st-dupes", (h, id) => richDraft(h, id));
      const first = await savedTheme(a, "Noir");
      const out = await rt.call("set_theme", { pageId: a.pageId, theme: "Noir" }, who(a));
      expect(out.error).toMatchObject({
        code: "invalid_input",
        message: "Two themes are called “Noir”. Use an id.",
      });
      expect(out.error!.details!.candidates.map((item: { id: string }) => item.id)).toContain(
        first,
      );
      expect(out.error!.details!.candidates.length).toBeLessThanOrEqual(5);
      expect((await rt.call("set_theme", { pageId: a.pageId, theme: first }, who(a))).isError).toBe(
        false,
      );
    });

    it("changes only the draft's theme: no saved theme is created, changed or deleted, even at the Free limit", async () => {
      const free = await owner("st-free", (h, id) => richDraft(h, id), "free");
      for (const name of ["One", "Two", "Three"]) await savedTheme(free, name);
      const count = async () =>
        (
          await admin
            .from("themes")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", free.userId)
        ).count;
      expect(await count()).toBe(3);
      const before = await draftOf(free);
      const out = await rt.call(
        "set_theme",
        { pageId: free.pageId, theme: "Smoke", overrides: { accent: "#123456" } },
        who(free),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(await count()).toBe(3);
      const after = await draftOf(free);
      expect({ ...after, theme: null, rev: 0 }).toEqual({ ...before, theme: null, rev: 0 });
    });
  });
});
