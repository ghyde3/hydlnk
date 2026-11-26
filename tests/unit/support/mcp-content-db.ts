/* eslint-disable @typescript-eslint/no-explicit-any -- rows and tool results are JSON whose shape each test checks */
import type { SupabaseClient } from "@supabase/supabase-js";
import { enablePost } from "../content-support";
import { draftOf, makeOwner, moveHome, removeOwners, type TestOwner } from "../publish-support";
import { adminForTests, makeRuntime, type Outcome } from "./mcp-db";

/**
 * The content tools against the local database (M18). A test file mocks `@/lib/supabase/admin` to
 * hand the content writer the test client (`mocks.admin`), and `@/lib/publish/invalidate` to spy on
 * the cache tags; this module is everything else they share: owners with a blog, posts made through
 * the tools, raw rows to compare before and after, and uploads in a person's own folder.
 */

export interface BlogOwner extends TestOwner {
  homeId: string;
}

export type Scopes = readonly ("hydlnk.read" | "hydlnk.write" | "hydlnk.publish")[];
export const READ: Scopes = ["hydlnk.read"];
export const READ_WRITE: Scopes = ["hydlnk.read", "hydlnk.write"];
export const ALL: Scopes = ["hydlnk.read", "hydlnk.write", "hydlnk.publish"];

export async function contentHarness() {
  const admin = adminForTests();
  const rt = await makeRuntime(admin);
  const owners: TestOwner[] = [];
  const uploaded: string[] = [];
  const blocked: string[] = [];
  let counter = 0;

  /** A person with one moved site (Home is an entry) and, unless told otherwise, the blog on. */
  async function owner(
    label: string,
    options: {
      plan?: "free" | "pro" | "studio";
      blog?: boolean;
      /** A complete draft the Publish gate accepts (a name, a bio, one link), for the publish tests. */
      publishable?: boolean;
    } = {},
  ): Promise<BlogOwner> {
    const made = await makeOwner(
      admin,
      label,
      options.publishable ? () => draftOf("Mara Okafor") : undefined,
      options.plan ?? "free",
    );
    owners.push(made);
    const homeId = await moveHome(admin, made.pageId);
    if (options.blog !== false) await enablePost(admin as never, made.pageId);
    return { ...made, homeId };
  }

  /** A second site for the same person, with the blog on. */
  async function secondSite(o: TestOwner, label: string): Promise<string> {
    const handle = `zq-${label}-${Math.random().toString(36).slice(2, 8)}`;
    const page = await admin
      .from("pages")
      .insert({ owner_id: o.userId, handle, draft: { version: 1, rev: 1 } as never })
      .select("id")
      .single();
    if (page.error) throw new Error(`second site: ${page.error.message}`);
    await enablePost(admin as never, page.data.id);
    return page.data.id as string;
  }

  const call = (
    name: string,
    input: unknown,
    o: TestOwner,
    scopes: Scopes = ALL,
  ): Promise<Outcome> => rt.call(name, input, { userId: o.userId, scopes });

  /** A draft post made through `create_entry`; throws when the tool refuses. */
  async function post(
    o: TestOwner,
    fields: Record<string, unknown> = {},
    pageId: string = o.pageId,
  ): Promise<{ id: string; rev: number; slug: string }> {
    counter += 1;
    const out = await call(
      "create_entry",
      {
        pageId,
        title: `Post ${counter}`,
        slug: `zq-post-${counter}-${Date.now() % 100000}`,
        ...fields,
      },
      o,
    );
    if (out.isError) throw new Error(`create_entry: ${JSON.stringify(out.error)}`);
    return out.json as { id: string; rev: number; slug: string };
  }

  /** The entry's row as the database holds it, rev as a number. */
  async function row(id: string): Promise<Record<string, any>> {
    const { data, error } = await admin.from("content_entries").select("*").eq("id", id).single();
    if (error) throw new Error(`row: ${error.message}`);
    return { ...(data as any), rev: Number((data as any).rev) };
  }

  /** What a visitor could see of an entry: the columns no write-scope tool may change. */
  async function liveState(id: string) {
    const r = await row(id);
    return {
      published: r.published,
      published_at: r.published_at,
      first_published_at: r.first_published_at,
      live_slug: r.live_slug,
      live_path: r.live_path,
      deleted_at: r.deleted_at,
    };
  }

  async function termLinks(entryId: string): Promise<string[]> {
    const { data, error } = await admin
      .from("content_entry_terms")
      .select("term_id")
      .eq("entry_id", entryId);
    if (error) throw new Error(`term links: ${error.message}`);
    return (data ?? []).map((link: any) => link.term_id).sort();
  }

  async function revisions(entryId: string): Promise<Array<Record<string, any>>> {
    const { data, error } = await admin
      .from("content_entry_revisions")
      .select("rev, source, was_published, snapshot")
      .eq("entry_id", entryId)
      .order("rev", { ascending: true });
    if (error) throw new Error(`revisions: ${error.message}`);
    return (data ?? []).map((r: any) => ({ ...r, rev: Number(r.rev) }));
  }

  async function postType(siteId: string): Promise<Record<string, any>> {
    const { data, error } = await admin
      .from("content_types")
      .select("*")
      .eq("site_id", siteId)
      .eq("key", "post")
      .single();
    if (error) throw new Error(`post type: ${error.message}`);
    return data as any;
  }

  /** A sub-page entry of the site, written as the editor would have saved it. */
  async function subPage(o: TestOwner, path: string, title = "About"): Promise<string> {
    const type = await admin
      .from("content_types")
      .select("id")
      .eq("site_id", o.pageId)
      .eq("key", "page")
      .single();
    if (type.error) throw new Error(`subPage: ${type.error.message}`);
    const made = await admin
      .from("content_entries")
      .insert({
        site_id: o.pageId,
        type_id: type.data.id,
        draft: {
          path,
          title,
          description: "",
          blocks: [{ id: `hdr-${path.slice(0, 7)}`, type: "header", visible: true, text: title }],
        } as never,
      })
      .select("id")
      .single();
    if (made.error) throw new Error(`subPage: ${made.error.message}`);
    return made.data.id as string;
  }

  /**
   * Everything a visitor could see of a site, and every rev: the design's live copy and date, and for
   * each entry its live copy, dates, live address, rev and trash state. Two snapshots that are equal
   * mean nothing live and no rev moved; `except` leaves entries out of the comparison.
   */
  async function siteSnapshot(siteId: string, except: readonly string[] = []) {
    const site = await admin
      .from("pages")
      .select("published, published_at, draft")
      .eq("id", siteId)
      .single();
    if (site.error) throw new Error(`snapshot: ${site.error.message}`);
    const entries = await admin
      .from("content_entries")
      .select(
        "id, rev, published, published_at, first_published_at, live_slug, live_path, deleted_at",
      )
      .eq("site_id", siteId)
      .order("id", { ascending: true });
    if (entries.error) throw new Error(`snapshot: ${entries.error.message}`);
    const types = await admin
      .from("content_types")
      .select("id, key, enabled, archive_path, label, label_plural")
      .eq("site_id", siteId)
      .order("key", { ascending: true });
    if (types.error) throw new Error(`snapshot: ${types.error.message}`);
    return {
      design: {
        published: site.data.published,
        published_at: site.data.published_at,
        draftRev: (site.data.draft as any)?.rev,
      },
      entries: (entries.data as any[])
        .filter((entry) => !except.includes(entry.id))
        .map((entry) => ({ ...entry, rev: Number(entry.rev) })),
      types: types.data,
    };
  }

  /** A small file in the person's own upload folder; returns its path. */
  async function upload(o: TestOwner, name: string): Promise<string> {
    const path = `${o.userId}/${name}.webp`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "), {
        contentType: "image/webp",
        upsert: true,
      });
    if (error) throw new Error(`upload: ${error.message}`);
    uploaded.push(path);
    return path;
  }

  /** Puts an uploaded image on the person's site design, so a tool can reuse it by its imageId. */
  async function giveImage(o: TestOwner, name: string): Promise<{ imageId: string; path: string }> {
    const imageId = `${name}.webp`;
    // The file exists too, so a publish that checks the design's images still passes.
    const path = await upload(o, name);
    const current = await admin.from("pages").select("draft").eq("id", o.pageId).single();
    if (current.error) throw new Error(`giveImage: ${current.error.message}`);
    const draft = current.data.draft as Record<string, any>;
    const saved = await admin
      .from("pages")
      .update({
        draft: {
          ...draft,
          profile: { ...draft.profile, photo: { path, width: 640, height: 480 } },
        } as never,
      })
      .eq("id", o.pageId);
    if (saved.error) throw new Error(`giveImage: ${saved.error.message}`);
    return { imageId, path };
  }

  async function block(domain: string): Promise<void> {
    const { error } = await admin
      .from("blocked_domains")
      .insert({ domain, reason: "test" } as never);
    if (error) throw new Error(`block: ${error.message}`);
    blocked.push(domain);
  }

  async function suspend(o: TestOwner, on: boolean): Promise<void> {
    const { error } = await admin
      .from("accounts")
      .update({ suspended_at: on ? new Date().toISOString() : null })
      .eq("id", o.userId);
    if (error) throw new Error(`suspend: ${error.message}`);
  }

  async function cleanup(): Promise<void> {
    if (uploaded.length > 0) await admin.storage.from("page-media").remove(uploaded);
    if (blocked.length > 0) await admin.from("blocked_domains").delete().in("domain", blocked);
    await removeOwners(admin, owners);
  }

  return {
    admin: admin as SupabaseClient,
    rt,
    call,
    owner,
    secondSite,
    post,
    row,
    liveState,
    termLinks,
    revisions,
    postType,
    subPage,
    siteSnapshot,
    upload,
    giveImage,
    block,
    suspend,
    cleanup,
  };
}

export type ContentHarness = Awaited<ReturnType<typeof contentHarness>>;
