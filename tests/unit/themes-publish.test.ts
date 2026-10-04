import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, DraftDoc, PublishDoc } from "@/lib/document";
import { SYSTEM_DEFAULT_TOKENS, TOKEN_KEYS, type TokenSet } from "@/lib/theme";
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
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M3-05 (publish validates tokens and theme ownership) and the Publish half of M3-18 (block
 * overrides), against the local Supabase with the secret key: `publishPageCore`, the gate behind
 * the Publish button. Drafts are written straight into `pages.draft`, the way a client holding the
 * publishable key can, then Publish is attempted. The same cases run through the real editor in
 * tests/e2e/m3/themes-publish.spec.ts.
 */
const { run } = await stackIsUp();

const SYSTEM_NOIR = "00000000-0000-4000-8000-000000000001";

const link = (overrides?: unknown): Block =>
  ({
    id: "lnk-aaaaaaaa",
    type: "link",
    visible: true,
    label: "Book",
    url: "https://example.com/book",
    ...(overrides === undefined ? {} : { overrides }),
  }) as Block;

describe.skipIf(!run)("M3-05 / M3-18 publish gate for tokens, themes and overrides", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let storageUrl: (path: string) => string;
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
    ({ storageUrl } = await import("@/lib/media/url"));
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  const owner = async (label: string, draft?: (handle: string) => DraftDoc) => {
    const made = await makeOwner(admin, label, draft);
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
  const publish = (
    o: TestOwner,
    mediaExists: (path: string) => Promise<boolean> = async () => true,
  ) => core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin, mediaExists });
  const saveTheme = async (o: TestOwner, name: string, tokens: Partial<TokenSet>) => {
    const { data, error } = await admin
      .from("themes")
      .insert({
        owner_id: o.userId,
        name,
        tokens: { ...SYSTEM_DEFAULT_TOKENS, ...tokens } as never,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  const doc = (name: string, theme: DraftDoc["theme"], blocks: Block[] = [link()]) =>
    draftOf(name, blocks, { theme });

  /** A failed Publish: invalid, one message of the wanted shape, and nothing written. */
  async function expectStopped(
    o: TestOwner,
    expected: { field?: string; message: RegExp | string; blockId?: string | null },
  ) {
    const before = await publishedOf(admin, o.pageId);
    const result = await publish(o);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    const hit = result.errors.find((error) =>
      expected.field === undefined ? true : error.field === expected.field,
    );
    expect(hit, JSON.stringify(result.errors)).toBeDefined();
    if (typeof expected.message === "string") expect(hit!.message).toBe(expected.message);
    else expect(hit!.message).toMatch(expected.message);
    if (expected.blockId !== undefined) expect(hit!.blockId).toBe(expected.blockId);
    expect(await publishedOf(admin, o.pageId)).toEqual(before);
    return result;
  }

  // -----------------------------------------------------------------------------------------
  describe("M3-05 step 1: invalid page overrides", () => {
    it("valid theme and overrides publish the complete resolved token set", async () => {
      const a = await owner("tp1", () =>
        doc("A", { ref: SYSTEM_NOIR, overrides: { accent: "#C46A4F", radius: 20 } }),
      );
      expect((await publish(a)).ok).toBe(true);
      const { published } = await publishedOf(admin, a.pageId);
      const tokens = (published as PublishDoc).tokens;
      expect(Object.keys(tokens).sort()).toEqual([...TOKEN_KEYS].sort());
      expect(tokens.accent).toBe("#C46A4F");
      expect(tokens.radius).toBe(20);
      expect(tokens.bg).toBe("#16120E"); // Noir
    });

    it("a bg of 'red;}' fails Publish naming the field and the fix, and writes nothing", async () => {
      const a = await owner("tp2", () => doc("A", { ref: null, overrides: {} }));
      expect((await publish(a)).ok).toBe(true);
      await writeDraft(a, doc("A", { ref: null, overrides: { bg: "red;}" } as never }));
      await expectStopped(a, {
        field: "theme.overrides.bg",
        message: "Publish stopped: Page background isn’t a valid color. Reset it in Design.",
        blockId: null,
      });
    });

    it("an Evil fontHeading fails the same way", async () => {
      const a = await owner("tp3", () => doc("A", { ref: null, overrides: {} }));
      expect((await publish(a)).ok).toBe(true);
      await writeDraft(a, doc("A", { ref: null, overrides: { fontHeading: "Evil;}" } as never }));
      await expectStopped(a, {
        field: "theme.overrides.fontHeading",
        message: "Publish stopped: Heading font isn’t an available font. Reset it in Design.",
      });
    });

    it("an unknown override key, a bad reference and a bad number fail too", async () => {
      const a = await owner("tp4", () => doc("A", { ref: null, overrides: {} }));
      await writeDraft(a, doc("A", { ref: null, overrides: { customCss: "x" } as never }));
      await expectStopped(a, { field: "theme.overrides", message: /customCss/ });
      await writeDraft(a, doc("A", { ref: "not-a-uuid", overrides: {} }));
      await expectStopped(a, { field: "theme.ref", message: /^Publish stopped:/ });
      await writeDraft(a, doc("A", { ref: null, overrides: { radius: 99 } }));
      await expectStopped(a, {
        field: "theme.overrides.radius",
        message: "Publish stopped: Corner radius isn’t valid. Reset it in Design.",
      });
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M3-05 step 1 and 2: the background image", () => {
    it("an http(s) URL on another host fails, and the live page is unchanged", async () => {
      const a = await owner("tp5", () => doc("A", { ref: null, overrides: {} }));
      expect((await publish(a)).ok).toBe(true);
      await writeDraft(
        a,
        doc("A", {
          ref: null,
          overrides: { bgType: "image", bgImage: "https://evil.example/x.png" },
        }),
      );
      await expectStopped(a, {
        field: "theme.overrides.bgImage",
        message: /^Publish stopped: Background image isn’t one of your uploaded images/,
      });
    });

    it("a URL in another user's folder fails; so does an object that does not exist", async () => {
      const a = await owner("tp6", () => doc("A", { ref: null, overrides: {} }));
      const b = await owner("tp7");
      const bFile = `${b.userId}/abcdef12-0001.png`;
      await writeDraft(
        a,
        doc("A", { ref: null, overrides: { bgType: "image", bgImage: storageUrl(bFile) } }),
      );
      await expectStopped(a, {
        field: "theme.overrides.bgImage",
        message: /isn’t one of your uploaded images/,
      });

      const aFile = `${a.userId}/abcdef12-0002.png`;
      await writeDraft(
        a,
        doc("A", { ref: null, overrides: { bgType: "image", bgImage: storageUrl(aFile) } }),
      );
      const before = await publishedOf(admin, a.pageId);
      const missing = await publish(a, async () => false);
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.errors[0]!.field).toBe("theme.overrides.bgImage");
        expect(missing.errors[0]!.message).toMatch(
          /^Publish stopped: the background image is no longer available/,
        );
      }
      expect(await publishedOf(admin, a.pageId)).toEqual(before);

      // Positive control: the owner's own, existing upload publishes and is frozen into the tokens.
      const ok = await publish(a, async (path) => path === aFile);
      expect(ok.ok).toBe(true);
      expect(((await publishedOf(admin, a.pageId)).published as PublishDoc).tokens.bgImage).toBe(
        storageUrl(aFile),
      );
    });

    it("a saved theme whose own bgImage points at someone else's file fails with the theme named", async () => {
      const a = await owner("tp8");
      const b = await owner("tp9");
      const themeId = await saveTheme(a, "Sneaky", {
        bgType: "image",
        bgImage: storageUrl(`${b.userId}/abcdef12-0003.png`),
      });
      await writeDraft(a, doc("A", { ref: themeId, overrides: {} }));
      await expectStopped(a, {
        field: "theme.bgImage",
        message: /isn’t one of your uploaded images/,
      });
    });

    it("a URL with a query, an encoded slash or the wrong bucket fails", async () => {
      const a = await owner("tp10");
      const own = storageUrl(`${a.userId}/abcdef12-0004.png`);
      for (const bgImage of [
        `${own}?x=1`,
        own.replace("page-media", "other"),
        own.replace(`${a.userId}/`, `${a.userId}%2F`),
      ]) {
        await writeDraft(a, doc("A", { ref: null, overrides: { bgType: "image", bgImage } }));
        await expectStopped(a, { field: "theme.overrides.bgImage", message: /uploaded images/ });
      }
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M3-05 steps 3 to 5: theme ownership", () => {
    it("another user's saved theme is never resolved: the page publishes the system default plus its own overrides", async () => {
      const mara = await owner("tp11");
      const b = await owner("tp12");
      const bTheme = await saveTheme(b, "B private", { accent: "#FF00AA", bg: "#112233" });

      await writeDraft(mara, doc("Mara", { ref: bTheme, overrides: { radius: 20 } }));
      const result = await publish(mara);
      expect(result.ok).toBe(true);

      const { published } = await publishedOf(admin, mara.pageId);
      const tokens = (published as PublishDoc).tokens;
      expect(tokens).toEqual({ ...SYSTEM_DEFAULT_TOKENS, radius: 20 });
      const text = JSON.stringify(published);
      expect(text).not.toContain("#FF00AA");
      expect(text).not.toContain("B private");
    });

    it("positive control: her own saved theme resolves and publishes", async () => {
      const mara = await owner("tp13");
      const own = await saveTheme(mara, "Mara's look", { accent: "#8FA68A", radius: 4 });
      await writeDraft(mara, doc("Mara", { ref: own, overrides: {} }));
      expect((await publish(mara)).ok).toBe(true);
      const tokens = ((await publishedOf(admin, mara.pageId)).published as PublishDoc).tokens;
      expect(tokens.accent).toBe("#8FA68A");
      expect(tokens.radius).toBe(4);
    });

    it("a deleted theme resolves to the default (the dangling reference is not an error)", async () => {
      const mara = await owner("tp14");
      const own = await saveTheme(mara, "Short lived", { accent: "#8FA68A" });
      await writeDraft(mara, doc("Mara", { ref: own, overrides: { radius: 4 } }));
      await admin.from("themes").delete().eq("id", own);
      expect((await publish(mara)).ok).toBe(true);
      const tokens = ((await publishedOf(admin, mara.pageId)).published as PublishDoc).tokens;
      expect(tokens).toEqual({ ...SYSTEM_DEFAULT_TOKENS, radius: 4 });
    });

    it("a saved theme with tokens that do not parse resolves like no theme", async () => {
      const mara = await owner("tp15");
      const { data } = await admin
        .from("themes")
        .insert({ owner_id: mara.userId, name: "Broken", tokens: { accent: "red;}" } as never })
        .select("id")
        .single();
      await writeDraft(mara, doc("Mara", { ref: data!.id as string, overrides: {} }));
      expect((await publish(mara)).ok).toBe(true);
      expect(((await publishedOf(admin, mara.pageId)).published as PublishDoc).tokens).toEqual(
        SYSTEM_DEFAULT_TOKENS,
      );
    });
  });

  // -----------------------------------------------------------------------------------------
  describe("M3-18 block overrides at Publish", () => {
    it("only the allowed keys are stored: fontHeading and bg are dropped, the colour stays", async () => {
      const a = await owner("tp16", () =>
        doc("A", { ref: null, overrides: {} }, [
          link({ fontHeading: "Geist", bg: "#000000", accent: "#C46A4F" }),
        ]),
      );
      expect((await publish(a)).ok).toBe(true);
      const published = (await publishedOf(admin, a.pageId)).published as PublishDoc;
      expect((published.blocks[0] as { overrides?: unknown }).overrides).toEqual({
        accent: "#C46A4F",
      });
      expect(JSON.stringify(published)).not.toContain('fontHeading":"Geist');
    });

    it("a radius of -5 fails Publish naming the block, and the live page is unchanged", async () => {
      const a = await owner("tp17", () => doc("A", { ref: null, overrides: {} }));
      expect((await publish(a)).ok).toBe(true);
      await writeDraft(a, doc("A", { ref: null, overrides: {} }, [link({ radius: -5 })]));
      await expectStopped(a, {
        field: "overrides.radius",
        blockId: "lnk-aaaaaaaa",
        message: /radius/i,
      });
    });

    it("a colour of 'red' fails Publish naming the block", async () => {
      const a = await owner("tp18", () => doc("A", { ref: null, overrides: {} }));
      expect((await publish(a)).ok).toBe(true);
      await writeDraft(
        a,
        doc("A", { ref: null, overrides: {} }, [link({ accent: "red", buttonBg: "red" })]),
      );
      await expectStopped(a, {
        field: "overrides.accent",
        blockId: "lnk-aaaaaaaa",
        message: /colou?r/i,
      });
    });
  });

  it("rand is usable (keeps the helper import honest)", () => {
    expect(rand(4)).toHaveLength(4);
  });
});
