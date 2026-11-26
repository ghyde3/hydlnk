import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import {
  HASH,
  adminClient,
  publishableClient,
  publishedOwner,
  record,
  signIn,
} from "./m17f-forms-db-support";

/**
 * M17-01 step 5: a probe with the publishable key over PostgREST (the path curl would take). Anon can
 * read, insert, update and delete nothing; a signed-in owner reads their own rows (never
 * visitor_hash) and may delete them, but can neither insert nor update; another user reads and
 * deletes nothing; no client can call the secret-key functions.
 */
const { run } = await stackIsUp();

/** The columns the owner may read (the grant in the migration): every column but visitor_hash. */
const SUBMISSION_COLUMNS =
  "id, site_id, entry_id, block_id, kind, email, name, message, created_at";

describe.skipIf(!run)("M17-01 form_submissions with the publishable key (local Supabase)", () => {
  let admin: SupabaseClient;
  let a: TestOwner;
  let b: TestOwner;
  let asA: SupabaseClient;
  let asB: SupabaseClient;
  let anon: SupabaseClient;

  const row = () => ({
    site_id: a.pageId,
    block_id: "formSignup01",
    kind: "signup",
    email: "probe@example.test",
    visitor_hash: HASH,
  });
  const countA = async () => {
    const { count, error } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("site_id", a.pageId);
    if (error) throw new Error(error.message);
    return count;
  };

  beforeAll(async () => {
    admin = adminClient();
    a = await publishedOwner(admin, "frls-a");
    b = await publishedOwner(admin, "frls-b");
    expect(await record(admin, a, "one@example.test")).toBe("stored");
    expect(await record(admin, a, "two@example.test")).toBe("stored");
    asA = await signIn(admin, a);
    asB = await signIn(admin, b);
    anon = publishableClient();
  }, 60_000);

  afterAll(async () => {
    await removeOwners(admin, [a, b].filter(Boolean));
  });

  it("anon cannot read, insert, update or delete", async () => {
    const read = await anon.from("form_submissions").select(SUBMISSION_COLUMNS);
    expect(read.error?.code).toBe("42501");
    expect((await anon.from("form_submissions").insert(row())).error?.code).toBe("42501");
    expect(
      (
        await anon
          .from("form_submissions")
          .update({ email: "x@example.test" })
          .eq("site_id", a.pageId)
      ).error?.code,
    ).toBe("42501");
    expect((await anon.from("form_submissions").delete().eq("site_id", a.pageId)).error?.code).toBe(
      "42501",
    );
    expect(await countA()).toBe(2);
  });

  it("the owner reads their rows but never visitor_hash, and cannot insert or update", async () => {
    const read = await asA.from("form_submissions").select(SUBMISSION_COLUMNS);
    expect(read.error).toBeNull();
    expect(read.data).toHaveLength(2);
    expect((await asA.from("form_submissions").select("visitor_hash")).error?.code).toBe("42501");
    expect((await asA.from("form_submissions").insert(row())).error?.code).toBe("42501");
    const update = await asA
      .from("form_submissions")
      .update({ email: "changed@example.test" })
      .eq("site_id", a.pageId);
    expect(update.error?.code).toBe("42501");
    expect(await countA()).toBe(2);
  });

  it("another user reads none of them and deletes none", async () => {
    const read = await asB
      .from("form_submissions")
      .select(SUBMISSION_COLUMNS)
      .eq("site_id", a.pageId);
    expect(read.data).toEqual([]);
    await asB.from("form_submissions").delete().eq("site_id", a.pageId);
    expect(await countA()).toBe(2);
    const counts = await asB.rpc("form_submission_counts", { p_site_id: a.pageId });
    expect(counts.data).toEqual([]);
  });

  it("no client can call the secret-key functions", async () => {
    for (const client of [anon, asA]) {
      const recorded = await client.rpc("record_form_submission", {
        p_site_id: a.pageId,
        p_block_id: "formSignup01",
        p_entry_id: null,
        p_kind: "signup",
        p_email: "rpc@example.test",
        p_name: "",
        p_message: "",
        p_visitor_hash: HASH,
      });
      expect(recorded.error?.code).toBe("42501");
      expect((await client.rpc("form_usage", { p_uid: a.userId })).error?.code).toBe("42501");
    }
    expect((await asA.from("form_submission_usage").select("stored")).error?.code).toBe("42501");
    expect(await countA()).toBe(2);
  });

  it("the owner sees the counts of their own site and deletes their own row", async () => {
    const counts = await asA.rpc("form_submission_counts", { p_site_id: a.pageId });
    expect(counts.data).toEqual([
      expect.objectContaining({ block_id: "formSignup01", kind: "signup", total: 2 }),
    ]);
    const deleted = await asA.from("form_submissions").delete().eq("email", "one@example.test");
    expect(deleted.error).toBeNull();
    expect(await countA()).toBe(1);
  });
});
