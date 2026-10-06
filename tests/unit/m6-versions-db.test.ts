import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  draftDocSchema,
  publishFormsEqual,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type PublishDoc,
} from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, resolveTokens, type TokenSet } from "@/lib/theme";
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
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M6-48 and M6-49 against the local Supabase with the secret key: what the trigger records, the
 * numbering under concurrent Publishes, retention, the read gate through the real client, and the
 * preview and restore actions end to end (the draft is the only thing restore writes; another
 * user's page, version and uploads never reach the result).
 */
const { run } = await stackIsUp();

const link = (id: string, label = "Book", url = "https://example.com/book"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url,
});

describe.skipIf(!run)("M6-48 / M6-49 published versions (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/versions/core");
  let publishCore: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];
  const blockedDomains: string[] = [];
  const themeIds: string[] = [];
  const everythingStored = async () => true;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/versions/core");
    publishCore = await import("@/lib/publish/core");
  });

  afterAll(async () => {
    if (blockedDomains.length > 0) {
      await admin.from("blocked_domains").delete().in("domain", blockedDomains);
    }
    if (themeIds.length > 0) await admin.from("themes").delete().in("id", themeIds);
    await removeOwners(admin, owners);
  });

  const owner = async (label: string, plan: "free" | "pro" | "studio" = "pro", draft = draftOf) => {
    const made = await makeOwner(admin, label, (handle) => draft(handle), plan);
    owners.push(made);
    return made;
  };

  /** What Publish writes: a publish form and a fresh published_at, in one update, with the secret key. */
  let clock = Date.parse("2026-10-06T10:00:00Z");
  const stamp = () => new Date((clock += 1000)).toISOString();
  async function publishDoc(o: TestOwner, doc: unknown, at = stamp()) {
    const { error } = await admin
      .from("pages")
      .update({ published: doc as never, published_at: at })
      .eq("id", o.pageId);
    expect(error).toBeNull();
    return at;
  }
  const formOf = (name: string, blocks?: Block[], themeTokens: Partial<TokenSet> | null = null) =>
    toPublishForm(draftOf(name, blocks) as never, themeTokens);
  async function versionsOf(o: TestOwner) {
    const { data, error } = await admin
      .from("page_versions")
      .select("id, version_no, document, published_at")
      .eq("page_id", o.pageId)
      .order("version_no");
    expect(error).toBeNull();
    return data!;
  }
  const draftOfPage = async (o: TestOwner) => {
    const { data } = await admin
      .from("pages")
      .select("draft, published, published_at, updated_at")
      .eq("id", o.pageId)
      .single();
    return data!;
  };
  const restore = (
    o: TestOwner,
    versionId: string,
    userId: string | null = o.userId,
    pageId: unknown = o.pageId,
  ) =>
    core.restorePageVersionCore(
      { pageId, versionId, userId },
      { admin, mediaExists: everythingStored },
    );
  const preview = (
    o: TestOwner,
    versionId: string,
    userId: string | null = o.userId,
    pageId: unknown = o.pageId,
  ) =>
    core.loadVersionPreviewCore(
      { pageId, versionId, userId },
      { admin, mediaExists: everythingStored },
    );

  // -----------------------------------------------------------------------------------------
  describe("M6-48 recording", () => {
    it("M6-48 a Pro owner's three Publishes through the real gate are versions 1, 2 and 3", async () => {
      const a = await owner("rec1");
      const seen: PublishDoc[] = [];
      for (const bio of ["First bio.", "Second bio.", "Third bio."]) {
        const draft = draftOf("Alpha", undefined, {});
        draft.profile.bio = bio;
        draft.rev += seen.length;
        const { error } = await admin
          .from("pages")
          .update({ draft: draft as never })
          .eq("id", a.pageId);
        expect(error).toBeNull();
        const result = await publishCore.publishPageCore(
          { pageId: a.pageId, userId: a.userId },
          { admin },
        );
        expect(result.ok).toBe(true);
        const stored = await publishedOf(admin, a.pageId);
        seen.push(publishedDocSchema.parse(stored.published));
        const rows = await versionsOf(a);
        expect(rows).toHaveLength(seen.length);
        // each version is exactly what pages.published held, with the page's published_at
        expect(rows.at(-1)!.version_no).toBe(seen.length);
        expect(publishFormsEqual(rows.at(-1)!.document, stored.published)).toBe(true);
        expect(new Date(rows.at(-1)!.published_at).getTime()).toBe(
          new Date(stored.published_at!).getTime(),
        );
      }
      const rows = await versionsOf(a);
      expect(rows.map((r) => r.version_no)).toEqual([1, 2, 3]);
      expect(rows.map((r) => (r.document as PublishDoc).profile.bio)).toEqual([
        "First bio.",
        "Second bio.",
        "Third bio.",
      ]);
    });

    it("M6-48 publishing the same document again adds nothing, even through the gate", async () => {
      const a = await owner("rec2");
      expect(
        (await publishCore.publishPageCore({ pageId: a.pageId, userId: a.userId }, { admin })).ok,
      ).toBe(true);
      expect(
        (await publishCore.publishPageCore({ pageId: a.pageId, userId: a.userId }, { admin })).ok,
      ).toBe(true);
      expect(await versionsOf(a)).toHaveLength(1);
    });

    it("M6-48 a Free owner publishing three times gets no rows; Studio keeps versions", async () => {
      const f = await owner("rec3", "free");
      for (const name of ["A", "B", "C"]) await publishDoc(f, formOf(name));
      expect(await versionsOf(f)).toHaveLength(0);
      const s = await owner("rec4", "studio");
      for (const name of ["A", "B"]) await publishDoc(s, formOf(name));
      expect((await versionsOf(s)).map((r) => r.version_no)).toEqual([1, 2]);
    });

    it("M6-48 a page with no published document gets none, and a draft save records nothing", async () => {
      const a = await owner("rec5");
      const { error } = await admin
        .from("pages")
        .update({ draft: { ...draftOf("Changed"), rev: 2 } as never })
        .eq("id", a.pageId);
      expect(error).toBeNull();
      expect(await versionsOf(a)).toHaveLength(0);
    });

    it("M6-48 a rewrite of published without a new published_at (a data migration) records nothing", async () => {
      const a = await owner("rec6");
      await publishDoc(a, formOf("One"));
      const { error } = await admin
        .from("pages")
        .update({ published: formOf("Rewritten") as never })
        .eq("id", a.pageId);
      expect(error).toBeNull();
      expect(await versionsOf(a)).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M6-48 retention and concurrency", () => {
    it("M6-48 27 distinct publishes leave versions 3 to 27, and the next one is 28", async () => {
      const a = await owner("ret1");
      for (let i = 1; i <= 27; i++) await publishDoc(a, formOf(`Name ${i}`));
      let rows = await versionsOf(a);
      expect(rows.map((r) => r.version_no)).toEqual(Array.from({ length: 25 }, (_, i) => i + 3));
      expect((rows[0]!.document as PublishDoc).profile.name).toBe("Name 3");
      await publishDoc(a, formOf("Name 28"));
      rows = await versionsOf(a);
      expect(rows[0]!.version_no).toBe(4);
      expect(rows.at(-1)!.version_no).toBe(28);
      expect(rows).toHaveLength(25);
    });

    it("M6-48 simultaneous Publishes of different documents on one page get distinct, consecutive numbers and none is lost", async () => {
      const a = await owner("con1");
      const names = Array.from({ length: 8 }, (_, i) => `Racer ${i}`);
      const results = await Promise.all(
        names.map((name, i) =>
          admin
            .from("pages")
            .update({
              published: formOf(name) as never,
              published_at: new Date(Date.parse("2026-10-06T11:00:00Z") + i * 1000).toISOString(),
            })
            .eq("id", a.pageId)
            .select("id"),
        ),
      );
      for (const r of results) expect(r.error).toBeNull();
      const rows = await versionsOf(a);
      expect(rows.map((r) => r.version_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(rows.map((r) => (r.document as PublishDoc).profile.name).sort()).toEqual(
        [...names].sort(),
      );
    });

    it("M6-48 the numbering survives a downgrade and an upgrade in between", async () => {
      const a = await owner("ret2");
      await publishDoc(a, formOf("One"));
      await publishDoc(a, formOf("Two"));
      await admin.from("accounts").update({ paid_plan: "free" }).eq("id", a.userId);
      await publishDoc(a, formOf("Three while free"));
      expect(await versionsOf(a)).toHaveLength(2);
      await admin.from("accounts").update({ paid_plan: "pro" }).eq("id", a.userId);
      await publishDoc(a, formOf("Four"));
      expect((await versionsOf(a)).map((r) => r.version_no)).toEqual([1, 2, 3]);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M6-49 preview", () => {
    it("M6-49 returns the stored document and counts nothing missing when every upload is stored", async () => {
      const a = await owner("pre1");
      await publishDoc(
        a,
        formOf("Preview me", [link("lnk-aaaaaaaa", "One"), link("lnk-bbbbbbbb", "Two")]),
      );
      const [version] = await versionsOf(a);
      const before = await draftOfPage(a);
      const result = await preview(a, version!.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.missingImages).toBe(0);
      expect(publishFormsEqual(result.doc, version!.document)).toBe(true);
      // it only reads: the page row is as it was, and no version was added
      expect(await draftOfPage(a)).toEqual(before);
      expect(await versionsOf(a)).toHaveLength(1);
    });

    it("M6-49 a stored version whose photo and background point into another user's folder previews with both null and counted", async () => {
      const a = await owner("pre2");
      const b = await owner("pre3");
      const base = formOf("Tampered");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const tampered = {
        ...base,
        profile: {
          ...base.profile,
          photo: { path: `${b.userId}/avatar-aaaaaaaa.webp`, width: 400, height: 400 },
        },
        tokens: {
          ...base.tokens,
          bgType: "image",
          bgImage: `${url}/storage/v1/object/public/page-media/${b.userId}/bg-aaaaaaaa.webp`,
        },
      };
      await publishDoc(a, tampered);
      const [version] = await versionsOf(a);
      const asked: string[] = [];
      const result = await core.loadVersionPreviewCore(
        { pageId: a.pageId, versionId: version!.id, userId: a.userId },
        { admin, mediaExists: async (path) => (asked.push(path), true) },
      );
      if (!result.ok) throw new Error(`preview failed: ${result.reason}`);
      expect(result.doc.profile.photo).toBeNull();
      expect(result.doc.tokens.bgImage).toBeNull();
      expect(result.doc.tokens.bgType).toBe("solid");
      expect(result.missingImages).toBe(2);
      expect(asked.some((path) => path.startsWith(b.userId))).toBe(false);
      expect(JSON.stringify(result)).not.toContain(b.userId);
    });

    it("M6-49 a stored document that does not parse is an error and never the raw JSON", async () => {
      const a = await owner("pre4");
      await publishDoc(a, formOf("Fine"));
      // as the owner role would: a row the strict schema cannot read (tests need a different row)
      const { data } = await admin
        .from("page_versions")
        .select("id")
        .eq("page_id", a.pageId)
        .single();
      // The secret key cannot write the table, so the bad row arrives as a published document instead.
      await publishDoc(a, { version: 1, marker: "RAW-JSON-MARKER", profile: "nope" });
      const rows = await versionsOf(a);
      const bad = rows.at(-1)!;
      expect(data).not.toBeNull();
      const result = await preview(a, bad.id);
      expect(result).toEqual({ ok: false, reason: "error" });
      expect(JSON.stringify(result)).not.toContain("RAW-JSON-MARKER");
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M6-49 restore", () => {
    it("M6-49 writes the draft and nothing else: published, versions and the live document are untouched", async () => {
      const a = await owner("res1");
      await publishDoc(a, formOf("Version one", [link("lnk-aaaaaaaa", "Old link")]));
      await publishDoc(
        a,
        formOf("Version two", [link("lnk-aaaaaaaa", "New link"), link("lnk-cccccccc", "Another")]),
      );
      const [v1, v2] = await versionsOf(a);
      const before = await draftOfPage(a);
      const versionsBefore = await versionsOf(a);

      const result = await restore(a, v1!.id);
      expect(result).toEqual({
        ok: true,
        restored: 1,
        missingImages: 0,
        pagesRestored: 0,
        notRestored: [],
      });

      const after = await draftOfPage(a);
      // pages.published and published_at are exactly as they were: the live page does not change
      expect(after.published).toEqual(before.published);
      expect(after.published_at).toEqual(before.published_at);
      expect(await versionsOf(a)).toEqual(versionsBefore);
      expect(v2!.version_no).toBe(2);

      const draft = draftDocSchema.parse(after.draft);
      expect(draft.rev).toBe((before.draft as { rev: number }).rev + 1);
      expect(draft.profile.name).toBe("Version one");
      expect(draft.blocks.map((b) => b.id)).toEqual(["lnk-aaaaaaaa"]);
      expect(draft.blocks.every((b) => b.visible)).toBe(true);
      // and what Publish would write from it is version one's document again
      expect(publishFormsEqual(toPublishForm(draft, null), v1!.document)).toBe(true);
    });

    it("M6-49 an editor tab holding the old draft meets the stale-tab guard, and two simultaneous restores leave one consistent draft", async () => {
      const a = await owner("res2");
      await publishDoc(a, formOf("One", [link("lnk-aaaaaaaa", "First")]));
      await publishDoc(a, formOf("Two", [link("lnk-bbbbbbbb", "Second")]));
      const [v1, v2] = await versionsOf(a);
      const old = (await draftOfPage(a)).draft as { rev: number };

      const [x, y] = await Promise.all([restore(a, v1!.id), restore(a, v2!.id)]);
      const outcomes = [x, y].map((r) => (r.ok ? "ok" : r.reason)).sort();
      expect(outcomes).toEqual(["conflict", "ok"]);
      const draft = draftDocSchema.parse((await draftOfPage(a)).draft);
      expect(draft.rev).toBe(old.rev + 1);
      expect(["One", "Two"]).toContain(draft.profile.name);

      // the old tab saves with rev + 1 filtered on the rev it knew: no row matches
      const stale = await admin
        .from("pages")
        .update({ draft: { ...old, rev: old.rev + 1 } as never })
        .eq("id", a.pageId)
        .eq("draft->>rev", String(old.rev))
        .select("id");
      expect(stale.data).toEqual([]);
    });

    it("M6-49 a draft that changed between the read and the write is a conflict and changes nothing", async () => {
      const a = await owner("res3");
      const base = formOf("One");
      // a photo of the owner's own, so the restore asks Storage (after it has read the draft's rev)
      await publishDoc(a, {
        ...base,
        profile: {
          ...base.profile,
          photo: { path: `${a.userId}/avatar-aaaaaaaa.webp`, width: 400, height: 400 },
        },
      });
      const [v1] = await versionsOf(a);
      const typed = { ...draftOf("Typed in another tab"), rev: 50 };
      const result = await core.restorePageVersionCore(
        { pageId: a.pageId, versionId: v1!.id, userId: a.userId },
        {
          admin,
          // another tab saves after the read at the start, before the write
          mediaExists: async () => {
            const { error } = await admin
              .from("pages")
              .update({ draft: typed as never })
              .eq("id", a.pageId);
            expect(error).toBeNull();
            return true;
          },
        },
      );
      expect(result).toEqual({ ok: false, reason: "conflict" });
      expect((await draftOfPage(a)).draft).toEqual(typed);
    });

    it("M6-49 a version with a link to a site blocked since returns blocked_link with the host and changes nothing", async () => {
      const a = await owner("res4");
      const host = `zq-blk-${rand(8)}.example.test`;
      await publishDoc(
        a,
        formOf("Linked", [link("lnk-aaaaaaaa", "Shady", `https://${host}/promo`)]),
      );
      const [version] = await versionsOf(a);
      const draftBefore = (await draftOfPage(a)).draft;
      const added = await admin.from("blocked_domains").insert({ domain: host, reason: "test" });
      expect(added.error).toBeNull();
      blockedDomains.push(host);
      const result = await restore(a, version!.id);
      expect(result).toEqual({ ok: false, reason: "blocked_link", hosts: [host] });
      expect((await draftOfPage(a)).draft).toEqual(draftBefore);
    });

    it("M6-49 a stored version whose photo and background are in another user's folder restores with both null, counted", async () => {
      const a = await owner("res5");
      const b = await owner("res6");
      const base = formOf("Tampered");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      await publishDoc(a, {
        ...base,
        profile: {
          ...base.profile,
          photo: { path: `${b.userId}/avatar-aaaaaaaa.webp`, width: 400, height: 400 },
        },
        theme: {
          ref: null,
          overrides: {
            bgType: "image",
            bgImage: `${url}/storage/v1/object/public/page-media/${b.userId}/bg-aaaaaaaa.webp`,
          },
        },
        tokens: {
          ...base.tokens,
          bgType: "image",
          bgImage: `${url}/storage/v1/object/public/page-media/${b.userId}/bg-aaaaaaaa.webp`,
        },
      });
      const [version] = await versionsOf(a);
      const result = await restore(a, version!.id);
      expect(result).toEqual({
        ok: true,
        restored: 1,
        missingImages: 2,
        pagesRestored: 0,
        notRestored: [],
      });
      const draft = draftDocSchema.parse((await draftOfPage(a)).draft);
      expect(draft.profile.photo).toBeNull();
      expect(draft.theme.overrides.bgImage).toBeNull();
      expect(draft.theme.overrides.bgType).toBe("solid");
      expect(JSON.stringify(draft)).not.toContain(b.userId);
      // Publish accepts the restored draft's background: nothing in it points at the other user
      const resolved = resolveTokens(null, draft.theme.overrides);
      expect(resolved.bgImage).toBeNull();
    });

    it("M6-49 the theme: unchanged, edited after the Publish, and deleted all restore to the version's frozen tokens", async () => {
      const a = await owner("res7");
      const tokens: TokenSet = {
        ...SYSTEM_DEFAULT_TOKENS,
        bg: "#101010",
        text: "#F0F0F0",
        fontHeading: "Inter",
      };
      const created = await admin
        .from("themes")
        .insert({ owner_id: a.userId, name: "Mine", tokens })
        .select("id")
        .single();
      expect(created.error).toBeNull();
      const themeId = created.data!.id as string;
      themeIds.push(themeId);

      const draft = {
        ...draftOf("Themed"),
        theme: { ref: themeId, overrides: { accent: "#C46A4F" } },
      };
      const form = toPublishForm(draft as never, tokens);
      await publishDoc(a, form);
      const [version] = await versionsOf(a);

      const restoredTokens = async () => {
        const row = await draftOfPage(a);
        const parsed = draftDocSchema.parse(row.draft);
        const { data } = parsed.theme.ref
          ? await admin.from("themes").select("tokens").eq("id", parsed.theme.ref).maybeSingle()
          : { data: null };
        return {
          parsed,
          tokens: resolveTokens((data?.tokens ?? null) as never, parsed.theme.overrides),
        };
      };

      // unchanged: reference and overrides kept
      expect((await restore(a, version!.id)).ok).toBe(true);
      let got = await restoredTokens();
      expect(got.parsed.theme).toEqual({ ref: themeId, overrides: { accent: "#C46A4F" } });
      expect(got.tokens).toEqual(form.tokens);

      // edited since: the reference is kept and the overrides gain what differs
      await admin
        .from("themes")
        .update({ tokens: { ...tokens, bg: "#FAFAFA", fontHeading: "Lora", radius: 2 } })
        .eq("id", themeId);
      expect((await restore(a, version!.id)).ok).toBe(true);
      got = await restoredTokens();
      expect(got.parsed.theme.ref).toBe(themeId);
      expect(got.parsed.theme.overrides).toMatchObject({
        accent: "#C46A4F",
        bg: "#101010",
        fontHeading: "Inter",
        radius: 12,
      });
      expect(got.tokens).toEqual(form.tokens);

      // deleted: the reference becomes null and the overrides carry what it supplied
      await admin.from("themes").delete().eq("id", themeId);
      expect((await restore(a, version!.id)).ok).toBe(true);
      got = await restoredTokens();
      expect(got.parsed.theme.ref).toBeNull();
      expect(got.tokens).toEqual(form.tokens);
    });

    it("M6-49 a theme that now belongs to someone else is not used", async () => {
      const a = await owner("res8");
      const b = await owner("res9");
      const tokens: TokenSet = { ...SYSTEM_DEFAULT_TOKENS, bg: "#223344" };
      const theirs = await admin
        .from("themes")
        .insert({ owner_id: b.userId, name: "Theirs", tokens })
        .select("id")
        .single();
      themeIds.push(theirs.data!.id as string);
      // a version of A names B's theme (the Publish gate would resolve that to no theme; a tampered row does not)
      const form = toPublishForm(
        { ...draftOf("Borrowed"), theme: { ref: theirs.data!.id, overrides: {} } } as never,
        null,
      );
      await publishDoc(a, form);
      const [version] = await versionsOf(a);
      expect((await restore(a, version!.id)).ok).toBe(true);
      const draft = draftDocSchema.parse((await draftOfPage(a)).draft);
      expect(draft.theme.ref).toBeNull();
      expect(resolveTokens(null, draft.theme.overrides)).toEqual(form.tokens);
    });

    it("M6-49 the restored draft is not a publish: no cache call is possible here and the page's published_at never moves", async () => {
      const a = await owner("res10");
      const at = await publishDoc(a, formOf("Only"));
      const [version] = await versionsOf(a);
      expect((await restore(a, version!.id)).ok).toBe(true);
      expect(new Date((await draftOfPage(a)).published_at!).toISOString()).toBe(at);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M6-49 the abuse matrix", () => {
    it("M6-49 a Free user with their own page and a version id gets plan_required from both actions, and the draft is unchanged", async () => {
      const f = await owner("abu1", "pro");
      await publishDoc(f, formOf("Was Pro"));
      const [version] = await versionsOf(f);
      await admin.from("accounts").update({ paid_plan: "free" }).eq("id", f.userId);
      const before = await draftOfPage(f);
      expect(await restore(f, version!.id)).toEqual({ ok: false, reason: "plan_required" });
      expect(await preview(f, version!.id)).toEqual({ ok: false, reason: "plan_required" });
      expect(await draftOfPage(f)).toEqual(before);
      // the rows are kept, and an upgrade brings the answer back with no data change
      expect(await versionsOf(f)).toHaveLength(1);
      await admin.from("accounts").update({ paid_plan: "pro" }).eq("id", f.userId);
      expect((await preview(f, version!.id)).ok).toBe(true);
    });

    it("M6-49 a downgrade through the webhook makes the very next call return plan_required", async () => {
      const a = await owner("abu2");
      await publishDoc(a, formOf("Doc"));
      const [version] = await versionsOf(a);
      expect((await preview(a, version!.id)).ok).toBe(true);
      await admin.from("accounts").update({ paid_plan: "free" }).eq("id", a.userId);
      expect(await preview(a, version!.id)).toEqual({ ok: false, reason: "plan_required" });
      expect(await restore(a, version!.id)).toEqual({ ok: false, reason: "plan_required" });
    });

    it("M6-49 Pro user A with the version id of Pro user B gets not_found, with B's page id forbidden, and nothing of B's changes", async () => {
      const a = await owner("abu3");
      const b = await owner("abu4");
      await publishDoc(b, formOf("B's page"));
      const [theirs] = await versionsOf(b);
      const theirDraft = await draftOfPage(b);
      for (const act of [restore, preview]) {
        expect(await act(a, theirs!.id), "B's version id with A's page").toEqual({
          ok: false,
          reason: "not_found",
        });
        expect(await act(a, theirs!.id, a.userId, b.pageId), "B's page id").toEqual({
          ok: false,
          reason: "forbidden",
        });
      }
      expect(await draftOfPage(b)).toEqual(theirDraft);
    });

    it("M6-49 a version of the owner's other page given with this page's id is not_found", async () => {
      const a = await owner("abu5");
      const second = await admin
        .from("pages")
        .insert({
          owner_id: a.userId,
          handle: `zq-abu5b-${rand(4)}`,
          draft: draftOf("Second") as never,
        })
        .select("id")
        .single();
      expect(second.error).toBeNull();
      const other: TestOwner = { ...a, pageId: second.data!.id as string };
      await publishDoc(other, formOf("On the other page"));
      const [version] = await versionsOf(other);
      expect(await restore(a, version!.id)).toEqual({ ok: false, reason: "not_found" });
      expect(await preview(a, version!.id)).toEqual({ ok: false, reason: "not_found" });
      // and the right page id works
      expect((await restore(other, version!.id)).ok).toBe(true);
    });

    it("M6-49 hostile ids give forbidden or not_found, never a 500 and never a write", async () => {
      const a = await owner("abu6");
      await publishDoc(a, formOf("Doc"));
      const [version] = await versionsOf(a);
      const before = await draftOfPage(a);
      for (const hostile of [
        "x",
        "",
        "a".repeat(10_000),
        "'; drop table pages; --",
        "../../etc/passwd",
        "%00",
        "00000000-0000-0000-0000-000000000000",
      ]) {
        const asPage = await restore(a, version!.id, a.userId, hostile);
        expect(asPage, `page id ${hostile.slice(0, 20)}`).toMatchObject({
          ok: false,
          reason: "forbidden",
        });
        const asVersion = await restore(a, hostile);
        expect(["not_found"], `version id ${hostile.slice(0, 20)}`).toContain(
          (asVersion as { reason: string }).reason,
        );
        expect((await preview(a, hostile)) as { reason: string }).toMatchObject({
          ok: false,
          reason: "not_found",
        });
      }
      expect(await draftOfPage(a)).toEqual(before);
    });

    it("M6-49 no session is unauthorized and a suspended owner is account_suspended, both without a write", async () => {
      const a = await owner("abu7");
      await publishDoc(a, formOf("Doc"));
      const [version] = await versionsOf(a);
      const before = await draftOfPage(a);
      expect(await restore(a, version!.id, null)).toEqual({ ok: false, reason: "unauthorized" });
      await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", a.userId);
      expect(await restore(a, version!.id)).toEqual({ ok: false, reason: "account_suspended" });
      expect(await preview(a, version!.id)).toEqual({ ok: false, reason: "account_suspended" });
      expect(await draftOfPage(a)).toEqual(before);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M6-48 versions do not keep uploaded files alive (M5-14)", () => {
    it("M6-48 replacing a photo and publishing still deletes the old file, even though a stored version names it", async () => {
      const a = await owner("med1");
      const path = `${a.userId}/avatar-${rand(12)}.webp`;
      const bucket = admin.storage.from("page-media");
      const uploaded = await bucket.upload(path, Buffer.alloc(2048, 7), {
        contentType: "image/webp",
      });
      expect(uploaded.error).toBeNull();
      try {
        const withPhoto = (doc: ReturnType<typeof formOf>) => ({
          ...doc,
          profile: { ...doc.profile, photo: { path, width: 400, height: 400 } },
        });
        // draft and live page both show the photo; the Publish records it in version 1
        const draftWith = { ...draftOf("Photo"), rev: 2 };
        draftWith.profile = {
          ...draftWith.profile,
          photo: { path, width: 400, height: 400 },
        } as never;
        await admin
          .from("pages")
          .update({ draft: draftWith as never })
          .eq("id", a.pageId);
        await publishDoc(a, withPhoto(formOf("Photo")));
        // the photo is replaced in the draft and the Publish drops it from the live page
        await admin
          .from("pages")
          .update({ draft: { ...draftOf("Photo"), rev: 3 } as never })
          .eq("id", a.pageId);
        await publishDoc(a, formOf("Photo"));
        expect(JSON.stringify((await versionsOf(a))[0]!.document)).toContain(path);

        const { cleanupMediaFor } = await import("@/lib/media/cleanup-admin");
        const result = await cleanupMediaFor(a.userId, admin);
        expect(result.deleted).toContain(path);
        const gone = await bucket.exists(path);
        expect(gone.data).toBe(false);
        // the version still names the file (it is history, not a reference): nothing changed there
        expect(JSON.stringify((await versionsOf(a))[0]!.document)).toContain(path);
        // and previewing that version counts the missing file and shows no photo
        const [version] = await versionsOf(a);
        const result2 = await core.loadVersionPreviewCore(
          { pageId: a.pageId, versionId: version!.id, userId: a.userId },
          { admin },
        );
        if (!result2.ok) throw new Error(`preview failed: ${result2.reason}`);
        expect(result2.missingImages).toBe(1);
        expect(result2.doc.profile.photo).toBeNull();
      } finally {
        await bucket.remove([path]);
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M6-48 the database keeps its promises through the real client", () => {
    it("M6-48 deleting a page, and deleting the account, removes the versions", async () => {
      const a = await owner("del1");
      await publishDoc(a, formOf("One"));
      await publishDoc(a, formOf("Two"));
      expect(await versionsOf(a)).toHaveLength(2);
      const removed = await admin.from("pages").delete().eq("id", a.pageId);
      expect(removed.error).toBeNull();
      expect(await versionsOf(a)).toHaveLength(0);

      const b = await owner("del2");
      await publishDoc(b, formOf("One"));
      await admin.auth.admin.deleteUser(b.userId);
      const { count } = await admin
        .from("page_versions")
        .select("id", { count: "exact", head: true })
        .eq("page_id", b.pageId);
      expect(count).toBe(0);
    });

    it("M6-48 the secret key can read versions and cannot write them", async () => {
      const a = await owner("sec1");
      await publishDoc(a, formOf("One"));
      const [version] = await versionsOf(a);
      const insert = await admin.from("page_versions").insert({
        page_id: a.pageId,
        version_no: 50,
        document: {} as never,
        published_at: new Date().toISOString(),
      });
      expect(insert.error?.code).toBe("42501");
      const update = await admin
        .from("page_versions")
        .update({ document: { tampered: true } as never })
        .eq("id", version!.id);
      expect(update.error?.code).toBe("42501");
      const del = await admin.from("page_versions").delete().eq("id", version!.id);
      expect(del.error?.code).toBe("42501");
      expect(await versionsOf(a)).toHaveLength(1);
    });
  });
});
