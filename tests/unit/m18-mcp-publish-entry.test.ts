/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import {
  READ,
  READ_WRITE,
  contentHarness,
  type BlogOwner,
  type ContentHarness,
} from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown, tags: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
// The real expiry code runs; only Next's cache API is replaced, so the test sees the exact tags.
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, options: { expire?: number }) => {
    if (options?.expire !== 0) throw new Error("a tool must expire at once");
    mocks.tags.push(tag);
  },
  updateTag: () => {
    throw new Error("updateTag works in Server Actions only");
  },
}));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const { run } = await stackIsUp();

/**
 * M18-08 against the local database: `publish_entry` makes ONE post or ONE page live and nothing
 * else, `unpublish_entry` takes one post down. A refusal changes nothing and expires no tag. No
 * write-scope tool changes anything a visitor sees.
 */
describe.skipIf(!run)("publish_entry and unpublish_entry (local Supabase)", () => {
  let h: ContentHarness;
  let ENTRY_NOT_FOUND: { code: string; message: string };
  let storageUrl: (path: string) => string;
  const POST_CONFLICT =
    "This changed while I was working on it. Call get_entry again and redo the change.";

  /** A live site with a live Home, a live sub-page, a draft sub-page, and the blog on. */
  async function liveSite(label: string) {
    const o = await h.owner(label, { plan: "pro", publishable: true });
    const about = await h.subPage(o, "about", "About");
    const all = await h.call("publish_page", { pageId: o.pageId }, o);
    if (all.isError) throw new Error(`publish_page: ${JSON.stringify(all.error)}`);
    const draftOnly = await h.subPage(o, "soon", "Coming soon");
    return { o, about, draftOnly };
  }

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
    const { MESSAGES } = await import("@/lib/mcp/errors");
    ENTRY_NOT_FOUND = { code: "not_found", message: MESSAGES.entry_not_found };
    ({ storageUrl } = await import("@/lib/media/url"));
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    mocks.tags.length = 0;
  });

  describe("a post", () => {
    it("goes live through the writer, and nothing else of the site moves: design, every page, every other post", async () => {
      const { o } = await liveSite("pe-post");
      const other = await h.post(o, { title: "Another draft" });
      const otherLive = await h.post(o, { title: "Already live" });
      await h.call("publish_entry", { entryId: otherLive.id, ifRev: 1 }, o);
      const made = await h.post(o, { title: "Goes live", slug: "goes-live", body: "The body." });
      const before = await h.siteSnapshot(o.pageId, [made.id]);
      const type = await h.postType(o.pageId);
      mocks.tags.length = 0;

      const out = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const url = `http://${o.handle}.localhost:3000/${type.archive_path}/goes-live`;
      expect(out.json).toMatchObject({
        published: true,
        type: "post",
        id: made.id,
        pageId: o.pageId,
        url,
      });
      expect(out.json!.rev).toBeGreaterThan(1);
      expect(out.text).toContain(url);
      const row = await h.row(made.id);
      expect(row.published).toMatchObject({ title: "Goes live", slug: "goes-live" });
      expect(row.live_slug).toBe("goes-live");
      expect(row.rev).toBe(out.json!.rev);
      expect(Date.parse(row.published_at)).toBe(Date.parse(out.json!.publishedAt));
      // Read before and after: nothing else is different.
      expect(await h.siteSnapshot(o.pageId, [made.id])).toEqual(before);
      // Exactly the post's own tags: its entry and its type. Never the site's.
      expect([...mocks.tags].sort()).toEqual([`entry:${made.id}`, `type:${type.id}`].sort());
      expect(mocks.tags.some((tag) => tag.startsWith("page:"))).toBe(false);
      // The revision is the writer's, with the source mcp.
      expect((await h.revisions(made.id)).at(-1)).toMatchObject({
        source: "mcp",
        was_published: true,
      });
      void other;
    });

    it("publishing again after an edit replaces only that post's live copy", async () => {
      const { o } = await liveSite("pe-again");
      const made = await h.post(o, { title: "First", body: "One" });
      const first = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
      const edited = await h.call(
        "update_entry",
        { entryId: made.id, ifRev: first.json!.rev, body: "Two" },
        o,
      );
      expect((await h.row(made.id)).published.body).toBe("One");
      const before = await h.siteSnapshot(o.pageId, [made.id]);
      const second = await h.call(
        "publish_entry",
        { entryId: made.id, ifRev: edited.json!.rev },
        o,
      );
      expect(second.isError, JSON.stringify(second.error)).toBe(false);
      expect((await h.row(made.id)).published.body).toBe("Two");
      expect(await h.siteSnapshot(o.pageId, [made.id])).toEqual(before);
    });

    it("the post editor holding the older rev gets conflict on its next save after a publish through MCP", async () => {
      const o = await h.owner("pe-editor");
      const made = await h.post(o, { body: "As the editor loaded it" });
      const editorRev = 1;
      const live = await h.call("publish_entry", { entryId: made.id, ifRev: editorRev }, o);
      expect(live.isError, JSON.stringify(live.error)).toBe(false);
      expect(live.json!.rev).toBeGreaterThan(editorRev);
      const { updateEntryWithClient } = await import("@/lib/content");
      const save = await updateEntryWithClient(h.admin as never, {
        actor: { userId: o.userId, source: "editor" },
        entryId: made.id,
        expectedRev: editorRev,
        draft: { ...(await h.row(made.id)).draft, body: "Typed over the publish" },
      });
      expect(save).toMatchObject({ ok: false, error: "conflict", currentRev: live.json!.rev });
      expect((await h.row(made.id)).draft.body).toBe("As the editor loaded it");
    });
  });

  describe("a page", () => {
    it("a sub-page goes live through the Publish gate, and nothing else of the site moves", async () => {
      const { o, draftOnly } = await liveSite("pe-page");
      const livePost = await h.post(o, { title: "A live post" });
      await h.call("publish_entry", { entryId: livePost.id, ifRev: 1 }, o);
      const before = await h.siteSnapshot(o.pageId, [draftOnly]);
      const rev = (await h.row(draftOnly)).rev;
      mocks.tags.length = 0;

      const out = await h.call(
        "publish_entry",
        { pageId: o.pageId, subPageId: draftOnly, ifRev: rev },
        o,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({
        published: true,
        type: "page",
        pageId: o.pageId,
        subPageId: draftOnly,
        url: `http://${o.handle}.localhost:3000`,
      });
      const row = await h.row(draftOnly);
      expect(row.published).toMatchObject({ title: "Coming soon", path: "soon" });
      expect(row.live_path).toBe("soon");
      expect(row.rev).toBe(out.json!.rev);
      expect(await h.siteSnapshot(o.pageId, [draftOnly])).toEqual(before);
      // A page expires the site's tag, and only that.
      expect(mocks.tags).toEqual([`page:${o.pageId}`]);
      // The gate recorded the publish with the source mcp.
      expect((await h.revisions(draftOnly)).at(-1)).toMatchObject({
        source: "mcp",
        was_published: true,
      });
    });

    it("Home by pageId alone: its blocks go live, the design does not, and Home's entry id is never printed", async () => {
      const { o } = await liveSite("pe-home");
      const added = await h.call(
        "add_block",
        { pageId: o.pageId, type: "header", fields: { text: "New on Home" } },
        o,
      );
      expect(added.isError, JSON.stringify(added.error)).toBe(false);
      const profile = await h.call(
        "update_profile",
        { pageId: o.pageId, bio: "A bio that is not live yet" },
        o,
      );
      expect(profile.isError, JSON.stringify(profile.error)).toBe(false);
      const before = await h.siteSnapshot(o.pageId, [o.homeId]);
      const page = await h.call("get_page", { pageId: o.pageId }, o);
      mocks.tags.length = 0;

      const out = await h.call(
        "publish_entry",
        { pageId: o.pageId, ifRev: page.json!.page.rev },
        o,
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({ published: true, type: "page", pageId: o.pageId });
      expect("subPageId" in out.json!).toBe(false);
      expect(JSON.stringify(out.raw)).not.toContain(o.homeId);
      expect(JSON.stringify((await h.row(o.homeId)).published)).toContain("New on Home");
      // The design's live copy is as it was: the new bio is still only a draft.
      const after = await h.siteSnapshot(o.pageId, [o.homeId]);
      expect(after).toEqual(before);
      expect(JSON.stringify(after.design.published)).not.toContain("A bio that is not live yet");
      expect(mocks.tags).toEqual([`page:${o.pageId}`]);
      // "home" and Home's entry id as subPageId mean the same page.
      const again = await h.call(
        "publish_entry",
        { pageId: o.pageId, subPageId: "home", ifRev: out.json!.rev },
        o,
      );
      expect(again.isError, JSON.stringify(again.error)).toBe(false);
    });

    it("a page on a site that is not live yet is publish_refused, naming publish_page", async () => {
      const o = await h.owner("pe-notlive", { publishable: true });
      const sub = await h.subPage(o, "early", "Early");
      const before = await h.siteSnapshot(o.pageId);
      const out = await h.call("publish_entry", { pageId: o.pageId, subPageId: sub, ifRev: 1 }, o);
      expect(out.error).toMatchObject({ code: "publish_refused" });
      expect(out.error!.message).toContain("This site isn’t live yet. Call publish_page first");
      expect(out.error!.issues![0]!.path).toBe("document");
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
      expect(mocks.tags).toEqual([]);
    });

    it("a stale ifRev on a page is conflict with get_page's sentence and no rev", async () => {
      const { o, about } = await liveSite("pe-pconf");
      const before = await h.siteSnapshot(o.pageId);
      mocks.tags.length = 0;
      const out = await h.call(
        "publish_entry",
        { pageId: o.pageId, subPageId: about, ifRev: 999 },
        o,
      );
      expect(out.error).toEqual({
        code: "conflict",
        message:
          "This page changed while I was working on it. Call get_page again and redo the change.",
      });
      expect(JSON.stringify(out.raw)).not.toMatch(/currentRev|"rev"/);
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
      expect(mocks.tags).toEqual([]);
    });

    it("a page of another site or account is the one not_found", async () => {
      const { o, about } = await liveSite("pe-pfor");
      const stranger = await h.owner("pe-pstr");
      const before = await h.siteSnapshot(o.pageId);
      for (const input of [
        { pageId: o.pageId, subPageId: about, ifRev: 1 },
        { pageId: o.pageId, ifRev: 1 },
        { entryId: about, ifRev: 1 },
        { entryId: o.homeId, ifRev: 1 },
        { pageId: stranger.pageId, subPageId: about, ifRev: 1 },
      ]) {
        const out = await h.call("publish_entry", input, stranger);
        expect(out.error, JSON.stringify(input)).toEqual(ENTRY_NOT_FOUND);
      }
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
    });
  });

  describe("a refusal changes nothing and expires no tag", () => {
    let o: BlogOwner;
    beforeAll(async () => {
      o = await h.owner("pe-ref", { plan: "pro" });
    });

    /** An entry as the lenient editor save would have left it. */
    async function editorDraft(draft: Record<string, unknown>) {
      const type = await h.postType(o.pageId);
      const made = await h.admin
        .from("content_entries")
        .insert({ site_id: o.pageId, type_id: type.id, draft })
        .select("id")
        .single();
      if (made.error) throw new Error(made.error.message);
      return made.data.id as string;
    }
    async function refused(entryId: string, ifRev = 1) {
      const before = await h.siteSnapshot(o.pageId);
      mocks.tags.length = 0;
      const out = await h.call("publish_entry", { entryId, ifRev }, o);
      expect(out.isError).toBe(true);
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
      expect(mocks.tags).toEqual([]);
      return out;
    }

    it("publish_refused with issues by field: a missing title, a bad slug", async () => {
      const id = await editorDraft({ title: "  ", slug: "Bad Slug", body: "x" });
      const out = await refused(id);
      expect(out.error?.code).toBe("publish_refused");
      expect(out.error!.message).toContain("Publishing stopped.");
      const paths = out.error!.issues!.map((issue) => issue.path).sort();
      expect(paths).toEqual(["slug", "title"]);
      expect(out.error!.issues!.find((issue) => issue.path === "title")!.message).toBe(
        "Add a title.",
      );
    });

    it("publish_refused with the slug issue when another live post already uses the slug (M18-08 step 2)", async () => {
      const first = await h.post(o, { title: "Same slug", slug: "same-slug" });
      const live = await h.call("publish_entry", { entryId: first.id, ifRev: 1 }, o);
      expect(live.isError, JSON.stringify(live.error)).toBe(false);
      const second = await h.post(o, { title: "Same slug again", slug: "same-slug" });
      const out = await refused(second.id);
      expect(out.error?.code).toBe("publish_refused");
      expect(out.error!.message).toContain("Publishing stopped.");
      expect(out.error!.issues).toHaveLength(1);
      expect(out.error!.issues![0]!.path).toBe("slug");
    });

    it("create_entry with a repeated title and no slug suggests a free slug, and both publish", async () => {
      const title = `Repeated title ${Date.now() % 100000}`;
      const one = await h.call("create_entry", { pageId: o.pageId, title }, o);
      const two = await h.call("create_entry", { pageId: o.pageId, title }, o);
      const three = await h.call("create_entry", { pageId: o.pageId, title }, o);
      const base = one.json!.slug as string;
      expect(two.json!.slug).toBe(`${base}-2`);
      expect(three.json!.slug).toBe(`${base}-3`);
      for (const made of [one, two, three]) {
        const out = await h.call("publish_entry", { entryId: made.json!.id, ifRev: 1 }, o);
        expect(out.isError, JSON.stringify(out.error)).toBe(false);
      }
    });

    it("publish_refused for a body image that is not an upload, and for one that is not the caller's", async () => {
      const remote = await editorDraft({
        title: "Remote",
        slug: "remote-image",
        body: "![x](https://evil.example/pixel.png)",
      });
      const out = await refused(remote);
      expect(out.error).toMatchObject({ code: "publish_refused" });
      expect(out.error!.issues).toEqual([
        { path: "body", message: "Use an image from your uploads." },
      ]);
      const stranger = await h.owner("pe-img");
      const theirs = storageUrl(await h.upload(stranger, "img-0000000pe001"));
      const foreign = await editorDraft({
        title: "Foreign",
        slug: "foreign-image",
        body: `![x](${theirs})`,
      });
      const second = await refused(foreign);
      expect(second.error?.code).toBe("publish_refused");
      expect(second.error!.issues![0]!.path).toBe("body");
      const scheme = await editorDraft({
        title: "Scheme",
        slug: "bad-scheme",
        body: "[x](javascript:alert(1))",
      });
      expect((await refused(scheme)).error?.code).toBe("publish_refused");
    });

    it("blocked_link with the hosts, for a domain blocked after the draft was saved", async () => {
      const host = `zq-late-${Math.random().toString(36).slice(2, 10)}.example`;
      const made = await h.post(o, { body: `[x](https://${host}/a)` });
      await h.block(host);
      const out = await refused(made.id);
      expect(out.error).toMatchObject({ code: "blocked_link", details: { hosts: [host] } });
      expect(out.error!.message).toContain(host);
    });

    it("conflict for a stale ifRev, with no rev in the answer; a missing ifRev is invalid_input", async () => {
      const made = await h.post(o);
      await h.call("update_entry", { entryId: made.id, ifRev: 1, title: "Moved on" }, o);
      const out = await refused(made.id, 1);
      expect(out.error).toEqual({ code: "conflict", message: POST_CONFLICT });
      expect(JSON.stringify(out.raw)).not.toMatch(/currentRev|"rev"/);
      const missing = await h.call("publish_entry", { entryId: made.id }, o);
      expect(missing.error?.code).toBe("invalid_input");
      expect(missing.error!.issues![0]!.path).toBe("ifRev");
    });

    it("account_suspended, and type_disabled when the blog is off", async () => {
      const s = await h.owner("pe-susp");
      const made = await h.post(s);
      await h.suspend(s, true);
      const suspended = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, s);
      expect(suspended.error?.code).toBe("account_suspended");
      await h.suspend(s, false);
      await h.admin
        .from("content_types")
        .update({ enabled: false })
        .eq("site_id", s.pageId)
        .eq("key", "post");
      mocks.tags.length = 0;
      const off = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, s);
      expect(off.error).toEqual({
        code: "type_disabled",
        message:
          "The blog is off for this site. Turn it on with update_content_type or in the app.",
      });
      expect((await h.row(made.id)).published).toBeNull();
      expect(mocks.tags).toEqual([]);
    });

    it("another account's post, a trashed post and a random id are the one not_found", async () => {
      const stranger = await h.owner("pe-str");
      const theirs = await h.post(stranger);
      const trashed = await h.post(o);
      await h.call("delete_entry", { entryId: trashed.id, ifRev: 1 }, o);
      for (const entryId of [theirs.id, trashed.id, "00000000-0000-4000-8000-000000000000"]) {
        const out = await h.call("publish_entry", { entryId, ifRev: 1 }, o);
        expect(out.error, entryId).toEqual(ENTRY_NOT_FOUND);
        const down = await h.call("unpublish_entry", { entryId, ifRev: 1 }, o);
        expect(down.error, entryId).toEqual(ENTRY_NOT_FOUND);
      }
      expect((await h.row(theirs.id)).published).toBeNull();
    });
  });

  describe("unpublish_entry", () => {
    it("takes a post down and keeps its draft; nothing else of the site moves", async () => {
      const o = await h.owner("pe-down", { plan: "pro" });
      const keep = await h.post(o, { title: "Stays live" });
      await h.call("publish_entry", { entryId: keep.id, ifRev: 1 }, o);
      const made = await h.post(o, { title: "Comes down", body: "Kept as a draft" });
      const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
      const before = await h.siteSnapshot(o.pageId, [made.id]);
      const type = await h.postType(o.pageId);
      mocks.tags.length = 0;
      const out = await h.call("unpublish_entry", { entryId: made.id, ifRev: live.json!.rev }, o);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({ id: made.id, status: "draft", published: false });
      const row = await h.row(made.id);
      expect(row).toMatchObject({ published: null, published_at: null, live_slug: null });
      expect(row.draft).toMatchObject({ title: "Comes down", body: "Kept as a draft" });
      expect(row.deleted_at).toBeNull();
      expect(await h.siteSnapshot(o.pageId, [made.id])).toEqual(before);
      expect([...mocks.tags].sort()).toEqual([`entry:${made.id}`, `type:${type.id}`].sort());
      // It can be published again.
      const back = await h.call("publish_entry", { entryId: made.id, ifRev: out.json!.rev }, o);
      expect(back.isError, JSON.stringify(back.error)).toBe(false);
    });

    it("works after the blog was turned off", async () => {
      const o = await h.owner("pe-offdown");
      const made = await h.post(o);
      const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
      await h.admin
        .from("content_types")
        .update({ enabled: false })
        .eq("site_id", o.pageId)
        .eq("key", "post");
      const out = await h.call("unpublish_entry", { entryId: made.id, ifRev: live.json!.rev }, o);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect((await h.row(made.id)).published).toBeNull();
    });

    it("posts only: a page id is not_found and the page stays live; a stale rev is conflict", async () => {
      const { o, about } = await liveSite("pe-downpage");
      const before = await h.siteSnapshot(o.pageId);
      for (const entryId of [about, o.homeId]) {
        const out = await h.call("unpublish_entry", { entryId, ifRev: 1 }, o);
        expect(out.error, entryId).toEqual(ENTRY_NOT_FOUND);
      }
      const made = await h.post(o);
      const live = await h.call("publish_entry", { entryId: made.id, ifRev: 1 }, o);
      const snapshot = await h.siteSnapshot(o.pageId);
      mocks.tags.length = 0;
      const stale = await h.call("unpublish_entry", { entryId: made.id, ifRev: 1 }, o);
      expect(stale.error).toEqual({ code: "conflict", message: POST_CONFLICT });
      expect(await h.siteSnapshot(o.pageId)).toEqual(snapshot);
      expect(mocks.tags).toEqual([]);
      expect(snapshot.entries.length).toBe(before.entries.length + 1);
      void live;
    });
  });

  describe("no write-scope tool can change a published copy", () => {
    it("every write tool, old and new, run with a read and write token on a live site: nothing a visitor sees moves and no live entry's tag is expired", async () => {
      const { o, about } = await liveSite("pe-scan");
      const image = await h.giveImage(o, "photo-pe-000001");
      // giveImage edited the design's draft: publish everything once more so the fixture is settled.
      const settled = await h.call("publish_page", { pageId: o.pageId }, o);
      expect(settled.isError, JSON.stringify(settled.error)).toBe(false);
      const term = (
        await h.call("create_term", { pageId: o.pageId, taxonomy: "category", name: "Scan" }, o)
      ).json!.term.id;
      const post = await h.post(o, { title: "Live post", body: "Live body", categories: [term] });
      const livePost = await h.call("publish_entry", { entryId: post.id, ifRev: 1 }, o);
      const trashMe = await h.post(o, { title: "Draft to trash" });

      const live = async () => {
        const snapshot = await h.siteSnapshot(o.pageId);
        return {
          design: {
            published: snapshot.design.published,
            published_at: snapshot.design.published_at,
          },
          // Only entries that are live: a draft may come and go under the write scope.
          entries: snapshot.entries
            .filter((entry) => entry.published !== null)
            .map(({ rev: _rev, ...rest }) => {
              void _rev;
              return rest;
            }),
          types: snapshot.types,
          links: await h.termLinks(post.id),
        };
      };
      const before = await live();
      // Home, two sub-pages and the post are live.
      expect(before.entries.length).toBe(4);
      mocks.tags.length = 0;

      const { TOOLS } = await import("@/lib/mcp/tools");
      const writeTools = TOOLS.filter((tool) => tool.scope === "hydlnk.write").map(
        (tool) => tool.name,
      );
      expect(writeTools).toEqual([
        "update_profile",
        "add_block",
        "update_block",
        "move_block",
        "remove_block",
        "create_page",
        "update_page_settings",
        "set_theme",
        "create_entry",
        "update_entry",
        "delete_entry",
        "restore_entry",
        "create_term",
        "restore_revision",
        "create_preview_link",
      ]);
      const ran: string[] = [];
      const go = async (name: string, input: Record<string, unknown>) => {
        const out = await h.call(name, input, o, READ_WRITE);
        expect(out.isError, `${name}: ${JSON.stringify(out.error)}`).toBe(false);
        ran.push(name);
        return out;
      };
      const page = async () => (await h.call("get_page", { pageId: o.pageId }, o, READ)).json!;
      const postRev = async () => (await h.row(post.id)).rev as number;

      await go("update_profile", { pageId: o.pageId, bio: "Draft bio" });
      const added = await go("add_block", {
        pageId: o.pageId,
        type: "header",
        fields: { text: "Draft header" },
      });
      const blockId = added.json!.block.id as string;
      await go("update_block", { pageId: o.pageId, blockId, fields: { text: "Draft header 2" } });
      await go("move_block", { pageId: o.pageId, blockId, position: "first" });
      await go("remove_block", { pageId: o.pageId, blockId });
      const created = await go("create_page", { pageId: o.pageId, title: "Draft page" });
      await go("update_page_settings", {
        pageId: o.pageId,
        subPageId: about,
        title: "About, edited",
      });
      await go("set_theme", { pageId: o.pageId, overrides: { accent: "#123456" } });
      await go("create_entry", { pageId: o.pageId, title: "A new draft" });
      await go("update_entry", {
        entryId: post.id,
        ifRev: await postRev(),
        title: "Draft title",
        slug: "draft-slug",
        body: "Draft body",
        categories: [],
        featuredImageId: image.imageId,
      });
      await go("update_entry", {
        entryId: post.id,
        ifRev: await postRev(),
        bodyEdits: [{ find: "Draft body", replace: "Draft body, edited" }],
      });
      const trashed = await go("delete_entry", { entryId: trashMe.id, ifRev: 1 });
      await go("restore_entry", { entryId: trashMe.id, ifRev: trashed.json!.rev });
      await go("create_term", { pageId: o.pageId, taxonomy: "tag", name: "A draft tag" });
      const postRevision = (await h.revisions(post.id))[0]!.rev;
      await go("restore_revision", {
        entryId: post.id,
        revision: postRevision,
        ifRev: await postRev(),
      });
      const aboutRevision = (await h.revisions(about))[0]!.rev;
      await go("restore_revision", {
        pageId: o.pageId,
        subPageId: about,
        revision: aboutRevision,
        ifRev: (await h.row(about)).rev,
      });
      await go("create_preview_link", { pageId: o.pageId });

      expect([...new Set(ran)].sort()).toEqual([...writeTools].sort());
      expect(await live()).toEqual(before);
      // The one expiry a write-scope tool makes: trashing and restoring a DRAFT post expires that
      // post's own tag and its type's (M18-07; the writer does not ask whether it was live). Never
      // the site's tag, and never the tag of an entry that is live.
      const type = await h.postType(o.pageId);
      expect(new Set(mocks.tags)).toEqual(new Set([`entry:${trashMe.id}`, `type:${type.id}`]));
      expect(mocks.tags.some((tag) => tag.startsWith("page:"))).toBe(false);
      expect(mocks.tags).not.toContain(`entry:${post.id}`);
      void created;
      void livePost;
      void (await page());
    });
  });
});
