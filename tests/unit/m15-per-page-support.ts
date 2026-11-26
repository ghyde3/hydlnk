import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/document";
import { draftOf, makeOwner, type TestOwner } from "./publish-support";

/**
 * Shared setup of the per-page publishing tests (M15-10): a moved site (Home is a page entry) with
 * sub-pages, against the local Supabase, and an admin client that records which database functions
 * a gate called.
 */

export const link = (id: string, label = "Book", url = "https://example.com/book"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url,
});

export const pageLink = (id: string, target: string, label = "Go"): Block =>
  ({ id, type: "page_link", visible: true, label, target }) as Block;

export interface Site {
  owner: TestOwner;
  homeId: string;
}

export function siteTools(admin: SupabaseClient) {
  const addEntry = async (siteId: string, draft: object): Promise<string> => {
    const type = await admin
      .from("content_types")
      .select("id")
      .eq("site_id", siteId)
      .eq("key", "page")
      .single();
    if (type.error) throw new Error(type.error.message);
    const made = await admin
      .from("content_entries")
      .insert({ site_id: siteId, type_id: type.data.id, draft: draft as never })
      .select("id")
      .single();
    if (made.error) throw new Error(made.error.message);
    return made.data.id as string;
  };
  return {
    addEntry,
    /** A site whose Home entry holds `blocks`. */
    async site(label: string, blocks: Block[], owners: TestOwner[]): Promise<Site> {
      const owner = await makeOwner(admin, label, () => draftOf("Alpha", []), "pro");
      owners.push(owner);
      const homeId = await addEntry(owner.pageId, {
        path: "/",
        title: "",
        description: "",
        blocks,
      });
      return { owner, homeId };
    },
    sub: (site: Site, title: string, path: string, blocks: Block[] = []) =>
      addEntry(site.owner.pageId, { path, title, description: "About it.", blocks }),
    async entry(id: string) {
      const row = await admin
        .from("content_entries")
        .select("published, published_at, rev, draft")
        .eq("id", id)
        .single();
      if (row.error) throw new Error(row.error.message);
      return row.data as {
        published: { blocks?: { id: string; label?: string }[]; title?: string } | null;
        published_at: string | null;
        rev: number;
        draft: Record<string, unknown>;
      };
    },
    async setDraft(id: string, draft: object) {
      const { error } = await admin
        .from("content_entries")
        .update({ draft: draft as never })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    async pageRow(site: Site) {
      const row = await admin
        .from("pages")
        .select("published, published_at, draft, draft_rev:draft->>rev")
        .eq("id", site.owner.pageId)
        .single();
      if (row.error) throw new Error(row.error.message);
      return row.data as unknown as {
        published: Record<string, unknown> | null;
        published_at: string | null;
        draft: Record<string, unknown>;
        draft_rev: string | null;
      };
    },
    /** Change the design draft (everything but `blocks`), keeping the frozen blocks as stored. */
    async setDesign(site: Site, patch: Record<string, unknown>) {
      const current = await admin
        .from("pages")
        .select("draft")
        .eq("id", site.owner.pageId)
        .single();
      if (current.error) throw new Error(current.error.message);
      const { error } = await admin
        .from("pages")
        .update({ draft: { ...(current.data.draft as object), ...patch } as never })
        .eq("id", site.owner.pageId);
      if (error) throw new Error(error.message);
    },
  };
}

/** The admin client with every `rpc` call's name recorded (and its arguments, by name). */
export function recording(admin: SupabaseClient): {
  client: SupabaseClient;
  calls: string[];
  args: Record<string, unknown>;
} {
  const calls: string[] = [];
  const args: Record<string, unknown> = {};
  const client = new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop !== "rpc") return Reflect.get(target, prop, receiver);
      return (name: string, params: unknown, ...rest: unknown[]) => {
        calls.push(name);
        args[name] = params;
        return (target.rpc as (...a: unknown[]) => unknown)(name, params, ...rest);
      };
    },
  });
  return { client, calls, args };
}

/** The functions that write a published copy: what a refused gate must never have called. */
export const WRITERS = ["publish_site", "publish_site_page", "publish_design"];
export const wrote = (calls: readonly string[]) => calls.filter((name) => WRITERS.includes(name));
