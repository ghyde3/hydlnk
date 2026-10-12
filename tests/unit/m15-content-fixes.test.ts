// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { markdownUrls } from "@/lib/content/blocklist";
import { createEntryWithClient, updateEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient } from "@/lib/content/publish-core";
import { postDraftSchema, postPublishSchema } from "@/lib/content/schemas";
import { publishedSubPageSchema } from "@/lib/document/sub-page";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

vi.mock("server-only", () => ({}));

describe("markdownUrls", () => {
  it("reaches links and images in table cells", () => {
    const body =
      "| a | b |\n|---|---|\n| [x](https://t.example/p) | ![i](https://i.example/i.png) |";
    expect(markdownUrls(body).sort()).toEqual(["https://i.example/i.png", "https://t.example/p"]);
  });
  it("reaches a link in a blockquote in a list", () => {
    expect(markdownUrls("- item\n  > [q](https://q.example/p)")).toContain("https://q.example/p");
  });
  it("judges a protocol-relative link as https", () => {
    expect(markdownUrls("[x](//proto.example/p)")).toEqual(["https://proto.example/p"]);
  });
  it("leaves a relative link as written", () => {
    expect(markdownUrls("[x](/about)")).toEqual(["/about"]);
  });
  it("decodes character references in an address", () => {
    expect(markdownUrls("[x](https://www.ent&#46;example/p)")).toEqual([
      "https://www.ent.example/p",
    ]);
    expect(markdownUrls("[x](https://www.ent&#x2e;example/p)")).toEqual([
      "https://www.ent.example/p",
    ]);
  });
});

describe("post schemas", () => {
  it("refuse an unknown top-level key, draft and publish", () => {
    expect(postDraftSchema.safeParse({ title: "x", path: "evil" }).success).toBe(false);
    expect(postPublishSchema.safeParse({ title: "x", slug: "x", path: "evil" }).success).toBe(
      false,
    );
  });
  it("publish refuses a blank title and hidden characters", () => {
    expect(postPublishSchema.safeParse({ title: "   ", slug: "x" }).success).toBe(false);
    expect(postPublishSchema.safeParse({ title: "a‮b", slug: "x" }).success).toBe(false);
    expect(postPublishSchema.safeParse({ title: "ok", slug: "x" }).success).toBe(true);
  });
});

const { run } = await stackIsUp();
describe.skipIf(!run)("content writer review fixes", () => {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const owners: TestOwner[] = [];
  let a: TestOwner;
  let b: TestOwner;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });
  const link = (id: string, url: string, extra: object = {}) => ({
    id,
    type: "link",
    visible: true,
    label: "Hi",
    url,
    ...extra,
  });
  const page = (path: string, blocks: unknown[] = []) => ({
    path,
    title: "T",
    description: "",
    blocks,
  });

  beforeAll(async () => {
    a = await makeOwner(admin as never, "cf-a", undefined, "studio");
    b = await makeOwner(admin as never, "cf-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
  });
  afterAll(async () => {
    await admin.from("blocked_domains").delete().like("domain", "zq-cf-%");
    await removeOwners(admin as never, owners);
  });

  const create = (o: TestOwner, typeKey: string, draft: unknown) =>
    createEntryWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey, draft });
  const update = (o: TestOwner, id: string, expectedRev: number, draft: unknown) =>
    updateEntryWithClient(admin, { actor: actor(o), entryId: id, expectedRev, draft });
  const publish = (o: TestOwner, id: string, expectedRev: number) =>
    publishEntryWithClient(admin, { actor: actor(o), entryId: id, expectedRev });
  const ok = async (p: ReturnType<typeof create>) => {
    const out = await p;
    if (!out.ok) throw new Error(`failed: ${out.error}`);
    return out;
  };
  const row = async (id: string) =>
    (await admin.from("content_entries").select("*").eq("id", id).single()).data!;
  const block = async (domain: string) => admin.from("blocked_domains").upsert({ domain } as never);

  it("publishing a page stores the publish form: hidden blocks are dropped", async () => {
    const made = await ok(
      create(
        a,
        "page",
        page("zq-hidden", [
          link("lnk-aaaaaaaa", "https://example.com/"),
          link("lnk-bbbbbbbb", "javascript:alert(1)", { visible: false, label: "" }),
        ]),
      ),
    );
    const out = await publish(a, made.id, 1);
    expect(out).toMatchObject({ ok: true, rev: 2 });
    const stored = (await row(made.id)).published as { blocks: Array<{ id: string }> };
    expect(stored.blocks.map((x) => x.id)).toEqual(["lnk-aaaaaaaa"]);
    expect(publishedSubPageSchema.safeParse(stored).success).toBe(true);
  });

  it("a page draft path with surrounding whitespace is refused at save and at publish", async () => {
    expect(await create(a, "page", page("zq-ws "))).toMatchObject({ ok: false, error: "invalid" });
    const made = await ok(create(a, "page", page("zq-ws2")));
    expect(await update(a, made.id, 1, page(" zq-ws2"))).toMatchObject({
      ok: false,
      error: "invalid",
    });
    // A row saved before the rule (written straight to the table) is still refused at publish.
    await admin
      .from("content_entries")
      .update({ draft: page("zq-ws3 ") as never })
      .eq("id", made.id);
    expect(await publish(a, made.id, 1)).toMatchObject({ ok: false, error: "invalid" });
  });

  it("a page published after its link's domain was blocked is refused with the host", async () => {
    const made = await ok(
      create(a, "page", page("zq-later", [link("lnk-cccccccc", "https://zq-cf-later.example/p")])),
    );
    await block("zq-cf-later.example");
    const out = await publish(a, made.id, 1);
    expect(out).toMatchObject({ ok: false, error: "blocked_link", hosts: ["zq-cf-later.example"] });
    expect((await row(made.id)).published).toBeNull();
  });

  it("a blocked link at page save carries the hosts", async () => {
    const out = await create(
      a,
      "page",
      page("zq-hl5", [link("lnk-dddddddd", "https://zq-cf-later.example/p")]),
    );
    expect(out).toMatchObject({ ok: false, error: "blocked_link", hosts: ["zq-cf-later.example"] });
  });

  it("post bodies: table cells, // links and entity links reach the blocklist", async () => {
    await block("zq-cf-body.example");
    const bodies = [
      "| a |\n|---|\n| [x](https://zq-cf-body.example/p) |",
      "[x](//zq-cf-body.example/p)",
      "[x](https://www.zq-cf-body&#46;example/p)".replace("www.zq-cf-body", "zq-cf-body"),
    ];
    for (const body of bodies) {
      const out = await create(a, "post", { title: "t", body });
      expect(out, body).toMatchObject({
        ok: false,
        error: "blocked_link",
        hosts: ["zq-cf-body.example"],
      });
    }
  });

  it("a post image under another user's folder is refused at publish", async () => {
    const image = { path: `${b.userId}/abcd1234.webp`, width: 10, height: 10 };
    const made = await ok(
      create(a, "post", { title: "Img", slug: "zq-cf-img", featuredImage: image }),
    );
    const out = await publish(a, made.id, 1);
    expect(out).toMatchObject({ ok: false, error: "invalid" });
    expect((await row(made.id)).published).toBeNull();
  });

  it("a post image in the owner's folder that does not exist is refused at publish", async () => {
    const image = { path: `${a.userId}/abcd1234.webp`, width: 10, height: 10 };
    const made = await ok(
      create(a, "post", { title: "Img2", slug: "zq-cf-img2", featuredImage: image }),
    );
    expect(await publish(a, made.id, 1)).toMatchObject({ ok: false, error: "invalid" });
  });

  it("a page image block under another user's folder is refused at publish", async () => {
    const image = { path: `${b.userId}/abcd1234.webp`, width: 10, height: 10 };
    const card = {
      id: "crd-aaaaaaaa",
      type: "card",
      visible: true,
      title: "C",
      caption: "",
      url: "https://example.com/",
      image,
    };
    const made = await ok(create(a, "page", page("zq-cf-pimg", [card])));
    expect(await publish(a, made.id, 1)).toMatchObject({ ok: false, error: "invalid" });
  });

  it("an oversized schema-valid draft is a typed refusal, not a 500", async () => {
    const out = await create(a, "post", { title: "big", fields: { a: "x".repeat(1_100_000) } });
    expect(out).toMatchObject({ ok: false, error: "too_large", status: 413 });
  });

  it("the page limit holds when a page is created at '/' and then moved", async () => {
    const free = await makeOwner(admin as never, "cf-lim");
    owners.push(free);
    const mk = (path: string) => create(free, "page", page(path));
    expect(await mk("zq-p1")).toMatchObject({ ok: true });
    expect(await mk("zq-p2")).toMatchObject({ ok: true });
    expect(await mk("zq-p3")).toMatchObject({ ok: false, error: "page_limit" });
    const home = await ok(mk("/"));
    const moved = await update(free, home.id, 1, page("zq-p4"));
    expect(moved).toMatchObject({ ok: false, error: "page_limit" });
    expect((await row(home.id)).draft).toMatchObject({ path: "/" });
  });
});
