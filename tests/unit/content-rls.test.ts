import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M15-02 acceptance step 2: an integration probe with the publishable key. Two signed-in users and
 * anon each try select, insert, update and delete on the six content tables against another user's
 * site, over PostgREST (the path curl would take). The owner may read and may not write; everyone else
 * reads nothing and writes nothing; nothing of the owner's changes.
 */
const { run } = await stackIsUp();

const TABLES = [
  "content_types",
  "content_entries",
  "content_entry_revisions",
  "content_terms",
  "content_entry_terms",
  "site_paths",
] as const;
type Table = (typeof TABLES)[number];

describe.skipIf(!run)("M15-02 content tables, publishable key (local Supabase)", () => {
  let admin: SupabaseClient;
  let a: TestOwner;
  let b: TestOwner;
  let asA: SupabaseClient;
  let asB: SupabaseClient;
  let anon: SupabaseClient;
  const ids = { postType: "", entry: "", pageEntry: "", revision: "", term: "" };

  const publishable = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

  async function signIn(owner: TestOwner): Promise<SupabaseClient> {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: owner.email });
    if (link.error || !link.data.properties)
      throw new Error(`generateLink: ${link.error?.message}`);
    const client = publishable();
    const session = await client.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "magiclink",
    });
    if (session.error) throw new Error(`verifyOtp: ${session.error.message}`);
    return client;
  }

  async function mustSingle(
    p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await p;
    if (error || !data) throw new Error(error?.message ?? "no row");
    return data as Record<string, unknown>;
  }

  beforeAll(async () => {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    a = await makeOwner(admin, "crls-a", undefined, "pro");
    b = await makeOwner(admin, "crls-b", undefined, "pro");

    const post = await mustSingle(
      admin.from("content_types").select("id").eq("site_id", a.pageId).eq("key", "post").single(),
    );
    ids.postType = post.id as string;
    const page = await mustSingle(
      admin.from("content_types").select("id").eq("site_id", a.pageId).eq("key", "page").single(),
    );
    const entry = await mustSingle(
      admin
        .from("content_entries")
        .insert({ site_id: a.pageId, type_id: ids.postType, draft: { title: "secret of A" } })
        .select("id")
        .single(),
    );
    ids.entry = entry.id as string;
    // A page entry claims its path in site_paths.
    const pageEntry = await mustSingle(
      admin
        .from("content_entries")
        .insert({
          site_id: a.pageId,
          type_id: page.id as string,
          draft: { title: "P", path: "crls-secret" },
        })
        .select("id")
        .single(),
    );
    ids.pageEntry = pageEntry.id as string;
    const revision = await mustSingle(
      admin
        .from("content_entry_revisions")
        .insert({
          entry_id: ids.entry,
          site_id: a.pageId,
          rev: 1,
          snapshot: { title: "secret of A" },
          source: "system",
        })
        .select("id")
        .single(),
    );
    ids.revision = revision.id as string;
    const term = await mustSingle(
      admin
        .from("content_terms")
        .insert({
          site_id: a.pageId,
          type_id: ids.postType,
          taxonomy: "tag",
          slug: "crls",
          name: "Crls",
        })
        .select("id")
        .single(),
    );
    ids.term = term.id as string;
    const link = await admin
      .from("content_entry_terms")
      .insert({ entry_id: ids.entry, term_id: ids.term });
    if (link.error) throw new Error(link.error.message);

    asA = await signIn(a);
    asB = await signIn(b);
    anon = publishable();
  });

  afterAll(async () => {
    await removeOwners(admin, [a, b].filter(Boolean));
  });

  /** Insert payloads that would be valid for the owner's site, so a refusal is the privilege, not validation. */
  const inserts = (): Record<Table, Record<string, unknown>> => ({
    content_types: {
      site_id: a.pageId,
      key: "recipes",
      label: "R",
      label_plural: "Rs",
      kind: "custom",
      body_format: "markdown",
    },
    content_entries: { site_id: a.pageId, type_id: ids.postType, draft: { title: "x" } },
    content_entry_revisions: {
      entry_id: ids.entry,
      site_id: a.pageId,
      rev: 2,
      snapshot: {},
      source: "editor",
    },
    content_terms: {
      site_id: a.pageId,
      type_id: ids.postType,
      taxonomy: "tag",
      slug: "z",
      name: "Z",
    },
    content_entry_terms: { entry_id: ids.entry, term_id: ids.term },
    site_paths: { site_id: a.pageId, path: "zz", entry_id: ids.entry },
  });
  const updates: Record<Table, Record<string, unknown>> = {
    content_types: { label: "hacked" },
    content_entries: { draft: { title: "hacked" } },
    content_entry_revisions: { snapshot: { title: "hacked" } },
    content_terms: { name: "hacked" },
    content_entry_terms: { term_id: "00000000-0000-4000-8000-000000000000" },
    site_paths: { path: "hacked" },
  };

  async function count(table: Table): Promise<number> {
    // Scoped to the two sites (and their entries) this test creates, so other tests writing to the
    // content tables at the same time cannot change the count.
    const q = admin.from(table).select("*", { count: "exact", head: true });
    const { count: n, error } = await (table === "content_entry_terms"
      ? q.in("entry_id", [ids.entry, ids.pageEntry])
      : q.in("site_id", [a.pageId, b.pageId]));
    if (error) throw new Error(error.message);
    return n ?? 0;
  }

  it("the owner reads all six tables of their site", async () => {
    for (const table of TABLES) {
      const { data, error } = await asA.from(table).select("*");
      expect(error, `${table} as owner`).toBeNull();
      expect(data?.length ?? 0, `${table} rows for the owner`).toBeGreaterThan(0);
    }
  });

  it("another signed-in user reads none of the six tables", async () => {
    for (const table of TABLES) {
      // Another user has rows of their own in some tables (their built-in types): ask for A's.
      const q = asB.from(table).select("*");
      const { data, error } = await (table === "content_entry_terms"
        ? q.eq("entry_id", ids.entry)
        : q.eq("site_id", a.pageId));
      expect(error, `${table} as another user`).toBeNull();
      expect(data, `${table} rows for another user`).toEqual([]);
    }
  });

  it("anon cannot read any of the six tables", async () => {
    for (const table of TABLES) {
      const { data, error } = await anon.from(table).select("*");
      expect(error?.code, `${table} as anon`).toBe("42501");
      expect(data).toBeNull();
    }
  });

  const writers: [string, () => SupabaseClient][] = [
    ["the owner", () => asA],
    ["another signed-in user", () => asB],
    ["anon", () => anon],
  ];

  for (const [who, client] of writers) {
    it(`${who} can neither insert, update nor delete in any of the six tables`, async () => {
      const before = await Promise.all(TABLES.map((t) => count(t)));
      for (const table of TABLES) {
        const ins = await client().from(table).insert(inserts()[table]);
        expect(ins.error?.code, `insert ${table} as ${who}`).toBe("42501");
      }
      for (const table of TABLES) {
        const col =
          table === "content_entry_terms" ? "entry_id" : table === "site_paths" ? "site_id" : "id";
        const upd = await client().from(table).update(updates[table]).not(col, "is", null);
        expect(upd.error?.code, `update ${table} as ${who}`).toBe("42501");
        const del = await client().from(table).delete().not(col, "is", null);
        expect(del.error?.code, `delete ${table} as ${who}`).toBe("42501");
      }
      const after = await Promise.all(TABLES.map((t) => count(t)));
      expect(after, `row counts after ${who}'s attempts`).toEqual(before);
    });
  }

  it("nothing of the owner's changed", async () => {
    const entry = await mustSingle(
      admin.from("content_entries").select("draft").eq("id", ids.entry).single(),
    );
    expect(entry.draft).toEqual({ title: "secret of A" });
    const term = await mustSingle(
      admin.from("content_terms").select("name").eq("id", ids.term).single(),
    );
    expect(term.name).toBe("Crls");
  });
});
