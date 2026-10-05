import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, PublishDoc, SubPagePublish } from "@/lib/document";
import {
  homeForSite,
  nameErrors,
  pageTitleOf,
  siteErrors,
  type SiteSubPage,
} from "@/lib/publish/site-checks";
import { draftOf, makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M11-05 whole-site Publish: the pure cross-document checks, then `publishPageCore` against the
 * local Supabase (sub-pages are `site_pages` rows written with the secret key).
 */

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const GONE = "00000000-0000-4000-8000-00000000000f";

const link = (id: string, label = "Book"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url: "https://example.com/book",
});
const pageLink = (id: string, target: string): Block => ({
  id,
  type: "page_link",
  visible: true,
  label: "Go",
  target,
});
const sub = (id: string, title: string, path: string, blocks: Block[]): SiteSubPage => ({
  id,
  title,
  form: { path, title, description: "", blocks } as SubPagePublish,
});
const home = (blocks: Block[], nav?: PublishDoc["nav"]) =>
  ({
    profile: { name: "Mara", bio: "" },
    blocks,
    ...(nav ? { nav } : {}),
  }) as unknown as PublishDoc;

describe("M11-05 the checks that span documents", () => {
  it("is empty for a site whose paths and ids are unique and whose links resolve", () => {
    expect(
      siteErrors(home([link("h-link-0001"), pageLink("h-pl-0001", A)]), [
        sub(A, "Items", "items", [link("a-link-0001"), pageLink("a-pl-0001", "home")]),
        sub(B, "Map", "map", [pageLink("b-pl-0001", A)]),
      ]),
    ).toEqual([]);
  });

  it("names both pages of a path clash", () => {
    const errors = siteErrors(home([]), [
      sub(A, "Items", "shop", []),
      sub(B, "Directions", "shop", []),
    ]);
    expect(errors.map((e) => [e.subPageId, e.pageTitle, e.field])).toEqual([
      [A, "Items", "path"],
      [B, "Directions", "path"],
    ]);
    expect(errors[0]!.message).toContain("Items");
  });

  it("flags a block id repeated across Home and a sub-page, or across two sub-pages, on the later page", () => {
    const errors = siteErrors(home([link("dup-link-0001")]), [
      sub(A, "Items", "items", [link("dup-link-0001"), link("own-link-0001")]),
      sub(B, "Map", "map", [link("own-link-0001")]),
    ]);
    expect(errors.map((e) => [e.blockId, e.subPageId])).toEqual([
      ["dup-link-0001", A],
      ["own-link-0001", B],
    ]);
    expect(errors.every((e) => e.message.includes("“"))).toBe(true);
  });

  it("flags a repeat inside one page", () => {
    const errors = siteErrors(home([]), [
      sub(A, "Items", "items", [link("same-link-001"), link("same-link-001")]),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ blockId: "same-link-001", subPageId: A });
  });

  it("flags a page link whose target is not in the site, naming the page and the block", () => {
    const errors = siteErrors(home([pageLink("h-pl-0001", GONE)]), [
      sub(A, "Items", "items", [pageLink("a-pl-0001", GONE)]),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ blockId: "h-pl-0001", field: "target" });
    expect(errors[0]!.subPageId).toBeUndefined();
    expect(errors[0]!.message).toContain("Home");
    expect(errors[1]).toMatchObject({ blockId: "a-pl-0001", subPageId: A, pageTitle: "Items" });
    expect(errors[1]!.message).toContain("Items");
  });

  it("names a title for an error, with a stand-in for an empty one", () => {
    expect(pageTitleOf({ title: "  Items  " })).toBe("Items");
    expect(pageTitleOf({ title: "" })).toBe("Untitled page");
    expect(pageTitleOf(null)).toBe("Untitled page");
    expect(pageTitleOf({ title: "x".repeat(200) })).toHaveLength(60);
    const [named] = nameErrors([{ blockId: "b", field: "url", message: "Bad." }], {
      id: A,
      title: "Items",
    });
    expect(named).toEqual({
      blockId: "b",
      field: "url",
      message: "Page “Items”: Bad.",
      subPageId: A,
      pageTitle: "Items",
    });
  });

  it("drops menu entries that are not pages of the site, and stores a default menu as none", () => {
    const stored = homeForSite(home([], { show: true, items: [GONE, A, GONE, B] }), [A, B]);
    expect(stored.nav).toEqual({ show: true, items: [A, B] });
    expect("nav" in homeForSite(home([], { show: true, items: [GONE] }), [A])).toBe(false);
    expect(homeForSite(home([], { show: false, items: [GONE] }), [A]).nav).toEqual({
      show: false,
      items: [],
    });
    expect("nav" in homeForSite(home([]), [])).toBe(false);
  });
});

const { run } = await stackIsUp();

describe.skipIf(!run)("M11-05 publishPageCore publishes the whole site (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  const owner = async (label: string, blocks?: Block[], extra = {}) => {
    const made = await makeOwner(admin, label, () => draftOf("Alpha", blocks, extra));
    owners.push(made);
    return made;
  };
  const addSub = async (o: TestOwner, title: string, path: string, blocks: Block[] = []) => {
    const { data, error } = await admin
      .from("site_pages")
      .insert({ page_id: o.pageId, draft: { path, title, description: "About it.", blocks } })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  const publish = (o: TestOwner) =>
    core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
  const subRow = async (id: string) =>
    (
      await admin
        .from("site_pages")
        .select("published, published_at, live_path")
        .eq("id", id)
        .single()
    ).data!;
  const homeRow = async (o: TestOwner) =>
    (await admin.from("pages").select("published, published_at").eq("id", o.pageId).single()).data!;

  it("publishes Home and two sub-pages together, and drops hidden blocks", async () => {
    const o = await owner("ws1");
    const a = await addSub(o, "Items", "items", [
      link("a-link-00001"),
      { ...link("a-hid-000001"), visible: false },
    ]);
    const b = await addSub(o, "Directions", "directions", [link("b-link-00001")]);
    const result = await publish(o);
    expect(result).toMatchObject({ ok: true });
    const ra = await subRow(a);
    const rb = await subRow(b);
    expect(ra.live_path).toBe("items");
    expect(rb.live_path).toBe("directions");
    expect((ra.published as { blocks: { id: string }[] }).blocks.map((x) => x.id)).toEqual([
      "a-link-00001",
    ]);
    const h = await homeRow(o);
    expect(h.published).not.toBeNull();
    expect(h.published_at).toBe(ra.published_at);
    expect(h.published_at).toBe(rb.published_at);
  });

  it("a site without sub-pages publishes exactly as before (no nav key)", async () => {
    const o = await owner("ws2");
    expect(await publish(o)).toMatchObject({ ok: true });
    const h = await homeRow(o);
    expect(h.published).not.toBeNull();
    expect("nav" in (h.published as object)).toBe(false);
  });

  it("an invalid sub-page publishes nothing and the error names that page", async () => {
    const o = await owner("ws3");
    const good = await addSub(o, "Items", "items", [link("a-link-00001")]);
    const bad = await addSub(o, "Directions", "directions", [
      { ...link("b-link-00001"), label: "" },
    ]);
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        blockId: "b-link-00001",
        field: "label",
        subPageId: bad,
        pageTitle: "Directions",
        message: expect.stringContaining("Directions"),
      }),
    ]);
    expect((await homeRow(o)).published).toBeNull();
    expect((await subRow(good)).published).toBeNull();
  });

  it("an empty title or a reserved path is refused, naming the page", async () => {
    const o = await owner("ws4");
    await addSub(o, "", "items");
    await addSub(o, "Other", "api");
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors.map((e) => e.field).sort()).toEqual(["path", "title"]);
    expect(result.errors.find((e) => e.field === "title")!.pageTitle).toBe("Untitled page");
  });

  it("two pages with one path are refused, nothing is written", async () => {
    const o = await owner("ws5");
    const a = await addSub(o, "Items", "shop");
    await addSub(o, "Directions", "shop");
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((e) => e.field === "path")).toBe(true);
    expect((await subRow(a)).published).toBeNull();
    expect((await homeRow(o)).published).toBeNull();
  });

  it("a block id repeated across the site is refused", async () => {
    const o = await owner("ws6", [link("dup-link-0001")]);
    await addSub(o, "Items", "items", [link("dup-link-0001")]);
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ blockId: "dup-link-0001", pageTitle: "Items" });
  });

  it("a page link to a page that is not in the site is refused naming the page and the block; one to a page of the site passes", async () => {
    const o = await owner("ws7", [pageLink("h-pl-000001", GONE)]);
    const a = await addSub(o, "Items", "items", [pageLink("a-pl-000001", "home")]);
    const refused = await publish(o);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    if (refused.ok) return;
    expect(refused.errors).toEqual([
      expect.objectContaining({ blockId: "h-pl-000001", field: "target" }),
    ]);

    await admin
      .from("pages")
      .update({ draft: draftOf("Alpha", [pageLink("h-pl-000001", a)]) as never })
      .eq("id", o.pageId);
    expect(await publish(o)).toMatchObject({ ok: true });
  });

  it("drops stale menu items at Publish", async () => {
    const o = await owner("ws8", undefined, { nav: { show: true, items: [GONE] } });
    const a = await addSub(o, "Items", "items");
    await admin
      .from("pages")
      .update({
        draft: draftOf("Alpha", undefined, { nav: { show: true, items: [GONE, a] } }) as never,
      })
      .eq("id", o.pageId);
    expect(await publish(o)).toMatchObject({ ok: true });
    expect((await homeRow(o)).published).toMatchObject({ nav: { show: true, items: [a] } });
  });

  it("editing a published sub-page's draft changes nothing live until the next Publish", async () => {
    const o = await owner("ws9");
    const a = await addSub(o, "Items", "items", [link("a-link-00001")]);
    expect(await publish(o)).toMatchObject({ ok: true });
    await admin
      .from("site_pages")
      .update({ draft: { path: "items", title: "Changed", description: "", blocks: [] } })
      .eq("id", a);
    expect(((await subRow(a)).published as { title: string }).title).toBe("Items");
    expect(await publish(o)).toMatchObject({ ok: true });
    expect(((await subRow(a)).published as { title: string }).title).toBe("Changed");
  });

  it("a sub-page created after the last Publish is not live until the next one", async () => {
    const o = await owner("ws10");
    expect(await publish(o)).toMatchObject({ ok: true });
    const later = await addSub(o, "Later", "later");
    expect((await subRow(later)).published).toBeNull();
    expect(await publish(o)).toMatchObject({ ok: true });
    expect((await subRow(later)).live_path).toBe("later");
  });

  it("another user's site is forbidden and writes nothing", async () => {
    const o = await owner("ws11");
    const other = await owner("ws12");
    const a = await addSub(o, "Items", "items");
    const result = await core.publishPageCore(
      { pageId: o.pageId, userId: other.userId },
      { admin },
    );
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect((await subRow(a)).published).toBeNull();
  });
});
