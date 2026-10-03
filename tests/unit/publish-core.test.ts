import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draftDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  toPublishForm,
  type Block,
} from "@/lib/document";
import { TOKEN_KEYS, tokenSetSchema, type TokenSet } from "@/lib/theme";
import { SYSTEM_DEFAULT_TOKENS } from "@/lib/theme";
import { makePng } from "../e2e/m2/publish-helpers";
import {
  draftOf,
  makeOwner,
  publishedOf,
  rand,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));

// Database round trips and PNG rendering: a loaded machine can take far longer than 5 seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M2-23 and M2-25 integration tests: `publishPageCore` (the gate behind the Server Action) against
 * the local Supabase with the secret key. Drafts are written the way a client with the publishable
 * key could write them (directly into `pages.draft`), then Publish is attempted.
 */
const { run } = await stackIsUp();

const link = (id: string, label = "Book", url = "https://example.com/book"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url,
});

describe.skipIf(!run)("M2-23 / M2-25 publish gate (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
  });

  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    await removeOwners(admin, owners);
  });

  const owner = async (
    label: string,
    draft?: (handle: string) => unknown,
    plan?: "free" | "pro",
  ) => {
    const made = await makeOwner(admin, label, draft, plan);
    owners.push(made);
    return made;
  };
  const writeDraft = async (o: TestOwner, draft: unknown) => {
    const { error } = await admin
      .from("pages")
      .update({ draft: draft as never })
      .eq("id", o.pageId);
    expect(error).toBeNull();
  };
  const publish = (o: TestOwner, userId: string | null = o.userId) =>
    core.publishPageCore({ pageId: o.pageId, userId }, { admin });

  // -----------------------------------------------------------------------------------------
  describe("auth", () => {
    it("no session is unauthorized and writes nothing", async () => {
      const a = await owner("au1", () => draftOf("Alpha"));
      const result = await publish(a, null);
      expect(result).toMatchObject({ ok: false, reason: "unauthorized" });
      expect(await publishedOf(admin, a.pageId)).toEqual({ published: null, published_at: null });
    });

    it("another user's page is forbidden and leaves published and published_at unchanged", async () => {
      const a = await owner("au2", () => draftOf("Alpha"));
      const b = await owner("au3", () => draftOf("Bravo"));
      // a has a published copy; b tries to overwrite it.
      expect((await publish(a)).ok).toBe(true);
      const before = await publishedOf(admin, a.pageId);

      const result = await core.publishPageCore({ pageId: a.pageId, userId: b.userId }, { admin });
      expect(result).toMatchObject({ ok: false, reason: "forbidden" });
      expect(await publishedOf(admin, a.pageId)).toEqual(before);
    });

    it("an unknown, malformed or hostile page id is forbidden", async () => {
      const a = await owner("au4", () => draftOf("Alpha"));
      for (const pageId of [
        "00000000-0000-4000-8000-00000000ffff",
        "not-a-uuid",
        "' or 1=1 --",
        "",
        null,
        42,
        { id: a.pageId },
      ]) {
        const result = await core.publishPageCore({ pageId, userId: a.userId }, { admin });
        expect(result, JSON.stringify(pageId)).toMatchObject({ ok: false, reason: "forbidden" });
      }
      expect(await publishedOf(admin, a.pageId)).toEqual({ published: null, published_at: null });
    });

    it("a user id that is not a uuid never reaches the database", async () => {
      const a = await owner("au5", () => draftOf("Alpha"));
      const result = await core.publishPageCore(
        { pageId: a.pageId, userId: "x' or owner_id is not null --" },
        { admin },
      );
      expect(result).toMatchObject({ ok: false, reason: "unauthorized" });
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("validation gate", () => {
    const U202E = "Mara‮Okafor";
    const cases: {
      label: string;
      draft: (uid: string) => unknown;
      blockId: string | null;
      field: RegExp;
    }[] = [
      {
        label: "a javascript: URL",
        draft: () => draftOf("Alpha", [link("lnk-bad-js01", "Click", "javascript:alert(1)")]),
        blockId: "lnk-bad-js01",
        field: /^url$/,
      },
      {
        label: "a data: URL",
        draft: () =>
          draftOf("Alpha", [
            link("lnk-bad-dat01", "Click", "data:text/html,<script>alert(1)</script>"),
          ]),
        blockId: "lnk-bad-dat01",
        field: /^url$/,
      },
      {
        label: "an embed of https://evil.example/x",
        draft: () =>
          draftOf("Alpha", [
            {
              id: "emb-bad-0001",
              type: "embed",
              visible: true,
              url: "https://evil.example/x",
              caption: "",
            },
          ]),
        blockId: "emb-bad-0001",
        field: /^url$/,
      },
      {
        label: "a display name with U+202E",
        draft: () => draftOf(U202E),
        blockId: null,
        field: /^profile\.name$/,
      },
      {
        label: "51 blocks",
        draft: () =>
          draftOf(
            "Alpha",
            Array.from({ length: 51 }, (_, i) => link(`lnk-many-${String(i).padStart(3, "0")}`)),
          ),
        blockId: null,
        field: /^blocks$/,
      },
      {
        label: "a missing display name",
        draft: () => draftOf("   "),
        blockId: null,
        field: /^profile\.name$/,
      },
      {
        label: "a link without a label",
        draft: () => draftOf("Alpha", [link("lnk-nolabel1", "  ")]),
        blockId: "lnk-nolabel1",
        field: /^label$/,
      },
      {
        label: "a photo path in another user's folder",
        draft: () =>
          draftOf("Alpha", undefined, {
            profile: {
              name: "Alpha",
              bio: "",
              photo: {
                path: "00000000-0000-4000-8000-0000000000a1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
                width: 8,
                height: 8,
              },
            },
          }),
        blockId: null,
        field: /^profile\.photo$/,
      },
    ];

    it.each(cases)(
      "refuses $label, names the block and writes nothing",
      async ({ draft, blockId, field }) => {
        const o = await owner("va", (handle) => draft(handle));
        // The draft is stored first (a client can write anything into `draft`).
        const result = await publish(o);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe("invalid");
        expect(result.errors.some((e) => e.blockId === blockId && field.test(e.field))).toBe(true);
        expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
      },
    );

    it("a refused publish leaves an earlier published copy as it was", async () => {
      const o = await owner("va2", () => draftOf("Before"));
      expect((await publish(o)).ok).toBe(true);
      const before = await publishedOf(admin, o.pageId);
      await writeDraft(o, draftOf("After", [link("lnk-bad-js02", "Click", "javascript:alert(1)")]));
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      expect(await publishedOf(admin, o.pageId)).toEqual(before);
    });

    it("a draft that is not a document at all is refused, not a crash", async () => {
      // The database only lets a JSON object through (pages_draft_integrity); anything else
      // fails there, before Publish. These are objects that are not documents.
      for (const junk of [
        {},
        { version: 2 },
        { profile: 1, blocks: "x" },
        { version: 1, rev: 1, profile: { name: 5 }, theme: null, blocks: [null] },
      ]) {
        const o = await owner("va3", () => junk);
        const result = await publish(o);
        expect(result, JSON.stringify(junk)).toMatchObject({ ok: false, reason: "invalid" });
        expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
      }
    });

    it("hidden blocks are exempt from completeness: they are removed, not validated", async () => {
      const o = await owner("va4", () =>
        draftOf("Alpha", [
          link("lnk-shown-001"),
          { id: "lnk-hidden-01", type: "link", visible: false, label: "", url: "not a url" },
        ]),
      );
      expect((await publish(o)).ok).toBe(true);
      const { published } = await publishedOf(admin, o.pageId);
      expect(publishedDocSchema.parse(published).blocks.map((b) => b.id)).toEqual([
        "lnk-shown-001",
      ]);
    });

    it("a visible block cannot hide an image path that is another user's", async () => {
      const a = await owner("va5", () => draftOf("Alpha"));
      const b = await owner("va6", () => draftOf("Bravo"));
      const foreign = `${b.userId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
      await writeDraft(a, {
        ...draftOf("Alpha", [
          {
            id: "img-foreign-1",
            type: "image",
            visible: true,
            image: { path: foreign, width: 8, height: 8 },
            alt: "x",
          },
        ]),
      });
      const result = await publish(a);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      expect(result.ok === false && result.errors).toEqual([
        expect.objectContaining({ blockId: "img-foreign-1", field: "image" }),
      ]);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("images must exist in page-media", () => {
    it("publishes an own, existing image and refuses an own path that has no object", async () => {
      const o = await owner("im1", () => draftOf("Alpha"));
      const stored = `${o.userId}/${crypto.randomUUID()}.png`;
      const up = await admin.storage
        .from("page-media")
        .upload(stored, new Uint8Array(makePng(8, 8)), { contentType: "image/png" });
      expect(up.error).toBeNull();
      objects.push(stored);

      await writeDraft(
        o,
        draftOf("Alpha", undefined, {
          profile: { name: "Alpha", bio: "", photo: { path: stored, width: 8, height: 8 } },
        }),
      );
      const ok = await publish(o);
      expect(ok.ok).toBe(true);
      const { published } = await publishedOf(admin, o.pageId);
      expect(publishedDocSchema.parse(published).profile.photo?.path).toBe(stored);

      const missing = `${o.userId}/${crypto.randomUUID()}.png`;
      await writeDraft(
        o,
        draftOf("Alpha", [
          {
            id: "card-missing1",
            type: "card",
            visible: true,
            title: "T",
            caption: "",
            url: "https://example.com",
            image: { path: missing, width: 8, height: 8 },
          },
        ]),
      );
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      expect(result.ok === false && result.errors).toEqual([
        expect.objectContaining({
          blockId: "card-missing1",
          field: "image",
          message: expect.stringMatching(/no longer available/),
        }),
      ]);
    });

    it("the existence check can fail without blaming the user: reason error, nothing written", async () => {
      const o = await owner("im2", () =>
        draftOf("Alpha", undefined, {
          profile: {
            name: "Alpha",
            bio: "",
            photo: { path: `00000000-0000-4000-8000-000000000000/x.png`, width: 8, height: 8 },
          },
        }),
      );
      const fixed = await admin
        .from("pages")
        .update({
          draft: draftOf("Alpha", undefined, {
            profile: {
              name: "Alpha",
              bio: "",
              photo: { path: `${o.userId}/${crypto.randomUUID()}.png`, width: 8, height: 8 },
            },
          }) as never,
        })
        .eq("id", o.pageId);
      expect(fixed.error).toBeNull();
      const result = await core.publishPageCore(
        { pageId: o.pageId, userId: o.userId },
        {
          admin,
          mediaExists: async () => {
            throw new Error("storage is down");
          },
        },
      );
      expect(result).toMatchObject({ ok: false, reason: "error", errors: [] });
      expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("what is written", () => {
    it("escaping: <script> in the display name is valid and stored as plain text", async () => {
      const o = await owner("wr1", () => draftOf("<script>alert(1)</script>"));
      expect((await publish(o)).ok).toBe(true);
      const { published } = await publishedOf(admin, o.pageId);
      expect(publishedDocSchema.parse(published).profile.name).toBe("<script>alert(1)</script>");
    });

    it("writes the publish form: visible blocks only, resolved tokens, no rev, unknown keys stripped, published_at set", async () => {
      const draft = {
        ...draftOf("Alpha", [
          link("lnk-shown-001"),
          {
            id: "lnk-hidden-01",
            type: "link",
            visible: false,
            label: "Hidden",
            url: "https://example.com/h",
          },
          { id: "div-shown-001", type: "divider", visible: true },
        ]),
        badge: false,
        settings: { hideBadge: true, hideReport: true },
        evil: { __proto__: { polluted: true } },
      };
      (draft.profile as Record<string, unknown>).badge = false;
      const o = await owner("wr2", () => draft);

      const before = Date.now();
      const result = await publish(o);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Date.parse(result.publishedAt)).toBeGreaterThanOrEqual(before - 1000);

      const row = await publishedOf(admin, o.pageId);
      expect(new Date(row.published_at!).toISOString()).toBe(result.publishedAt);
      const stored = row.published as Record<string, unknown>;
      expect(Object.keys(stored).sort()).toEqual([
        "blocks",
        "profile",
        "theme",
        "tokens",
        "version",
      ]);
      // The profile's six display options (M6-15, M6-17) are always written, and nothing else is.
      expect(Object.keys(stored.profile as object).sort()).toEqual([
        "bio",
        "name",
        "photo",
        "photoBorder",
        "photoShape",
        "photoSize",
        "showBio",
        "showName",
        "showPhoto",
      ]);
      expect(JSON.stringify(stored)).not.toMatch(
        /hideBadge|hideReport|badge|polluted|"rev"|Hidden/,
      );
      const parsed = publishedDocSchema.parse(stored);
      expect(parsed.blocks.map((b) => b.id)).toEqual(["lnk-shown-001", "div-shown-001"]);
      expect(tokenSetSchema.safeParse(parsed.tokens).success).toBe(true);
      expect(parsed.tokens).toEqual(SYSTEM_DEFAULT_TOKENS);

      const draftParsed = draftDocSchema.parse(draft);
      expect(publishFormsEqual(parsed, toPublishForm(draftParsed, null))).toBe(true);
    });

    it("Publish twice moves published_at forward and replaces the document", async () => {
      const o = await owner("wr3", () => draftOf("One"));
      const first = await publish(o);
      await writeDraft(o, draftOf("Two"));
      await new Promise((r) => setTimeout(r, 15));
      const second = await publish(o);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(Date.parse(second.publishedAt)).toBeGreaterThan(Date.parse(first.publishedAt));
      expect(
        publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published).profile.name,
      ).toBe("Two");
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M2-25 freezing resolved tokens", () => {
    const FIXTURE_TOKENS: TokenSet = {
      ...SYSTEM_DEFAULT_TOKENS,
      bg: "#101820",
      text: "#F2F2F2",
      accent: "#00A3A3",
      buttonBg: "#00A3A3",
      radius: 20,
      buttonStyle: "outline",
    };

    it("system default, then theme, then page overrides, then the block's own override", async () => {
      const o = await owner("fz1", () => draftOf("Alpha"));
      const theme = await admin
        .from("themes")
        .insert({ owner_id: o.userId, name: "Freeze fixture", tokens: FIXTURE_TOKENS })
        .select("id")
        .single();
      expect(theme.error).toBeNull();
      const themeId = theme.data!.id as string;

      await writeDraft(
        o,
        draftOf(
          "Alpha",
          [
            { ...link("lnk-pill-0001", "Pill"), overrides: { buttonStyle: "pill" } } as Block,
            link("lnk-plain-001", "Plain"),
          ],
          { theme: { ref: themeId, overrides: { accent: "#C46A4F" } } },
        ),
      );

      expect((await publish(o)).ok).toBe(true);
      const parsed = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);

      for (const key of TOKEN_KEYS) expect(parsed.tokens[key], key).not.toBeUndefined();
      expect(parsed.tokens.bg).toBe("#101820"); // theme beats the default
      expect(parsed.tokens.accent).toBe("#C46A4F"); // page override beats the theme
      expect(parsed.tokens.buttonBg).toBe("#00A3A3");
      expect(parsed.tokens.radius).toBe(20);
      expect(parsed.tokens.buttonStyle).toBe("outline");
      expect(parsed.theme).toEqual({ ref: themeId, overrides: { accent: "#C46A4F" } });
      const pill = parsed.blocks.find((b) => b.id === "lnk-pill-0001")!;
      expect(pill.type === "link" && pill.overrides).toEqual({ buttonStyle: "pill" });

      // Editing the saved theme changes nothing live; the page keeps its frozen tokens.
      const frozen = (await publishedOf(admin, o.pageId)).published;
      const edit = await admin
        .from("themes")
        .update({ tokens: { ...FIXTURE_TOKENS, bg: "#FFFFFF", accent: "#FF0000" } })
        .eq("id", themeId);
      expect(edit.error).toBeNull();
      expect((await publishedOf(admin, o.pageId)).published).toEqual(frozen);

      // Deleting the row does not change the live page either.
      expect((await admin.from("themes").delete().eq("id", themeId)).error).toBeNull();
      expect((await publishedOf(admin, o.pageId)).published).toEqual(frozen);

      // Publishing again with the theme gone resolves like no theme: system default + overrides.
      expect((await publish(o)).ok).toBe(true);
      const again = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
      expect(again.tokens).toEqual({ ...SYSTEM_DEFAULT_TOKENS, accent: "#C46A4F" });
    });

    it("another user's saved theme is not applied; a system theme is", async () => {
      const a = await owner("fz2", () => draftOf("Alpha"));
      const b = await owner("fz3", () => draftOf("Bravo"));
      const foreign = await admin
        .from("themes")
        .insert({ owner_id: b.userId, name: "Private", tokens: FIXTURE_TOKENS })
        .select("id")
        .single();
      expect(foreign.error).toBeNull();
      await writeDraft(
        a,
        draftOf("Alpha", undefined, { theme: { ref: foreign.data!.id as string, overrides: {} } }),
      );
      expect((await publish(a)).ok).toBe(true);
      expect(
        publishedDocSchema.parse((await publishedOf(admin, a.pageId)).published).tokens,
      ).toEqual(SYSTEM_DEFAULT_TOKENS);

      const noir = "00000000-0000-4000-8000-000000000001";
      await writeDraft(a, draftOf("Alpha", undefined, { theme: { ref: noir, overrides: {} } }));
      expect((await publish(a)).ok).toBe(true);
      const tokens = publishedDocSchema.parse(
        (await publishedOf(admin, a.pageId)).published,
      ).tokens;
      expect(tokens.bg).toBe("#16120E");
    });
  });
});

describe("publish gate: unique test data", () => {
  it("rand gives distinct tags", () => {
    expect(new Set(Array.from({ length: 20 }, () => rand())).size).toBeGreaterThan(15);
  });
});
