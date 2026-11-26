import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { HASH, adminClient, publishedOwner, record } from "./m17f-forms-db-support";

/**
 * M17-02 step 3, the concurrency case (pgTAP 220 covers the rest): calls that reach the cap at the
 * same time, each over its own connection, store exactly what fits. The HL016 trigger holds the
 * usage row's lock in one `insert ... on conflict do update ... where stored < max` statement.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("M17-02 the monthly cap under concurrency (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];

  beforeAll(() => {
    admin = adminClient();
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  /** A Free owner whose month already holds `count` submissions (direct inserts: HL016 counts them). */
  async function ownerAt(label: string, count: number): Promise<TestOwner> {
    const owner = await publishedOwner(admin, label);
    owners.push(owner);
    const rows = Array.from({ length: count }, (_, i) => ({
      site_id: owner.pageId,
      block_id: "formSeed0001",
      kind: "signup",
      email: `seed${i}@example.test`,
      visitor_hash: HASH,
    }));
    const { error } = await admin.from("form_submissions").insert(rows);
    if (error) throw new Error(`seed: ${error.code}`);
    return owner;
  }

  const stored = async (owner: TestOwner) => {
    const { count } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("site_id", owner.pageId);
    return count;
  };

  it("two concurrent calls at 99 store exactly one", async () => {
    const owner = await ownerAt("frace-a", 99);
    const statuses = await Promise.all([
      record(admin, owner, "first@example.test"),
      record(admin, owner, "second@example.test"),
    ]);
    expect(statuses.sort()).toEqual(["over_limit_first", "stored"]);
    expect(await stored(owner)).toBe(100);
  }, 60_000);

  it("ten concurrent calls at 95 store exactly five, and the refusals are counted", async () => {
    const owner = await ownerAt("frace-b", 95);
    const statuses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => record(admin, owner, `burst${i}@example.test`)),
    );
    expect(statuses.filter((s) => s === "stored")).toHaveLength(5);
    expect(statuses.filter((s) => s === "over_limit_first")).toHaveLength(1);
    expect(statuses.filter((s) => s === "over_limit")).toHaveLength(4);
    expect(await stored(owner)).toBe(100);
    const usage = await admin.rpc("form_usage", { p_uid: owner.userId });
    expect(usage.data).toEqual([expect.objectContaining({ stored: 100, refused: 5 })]);
  }, 60_000);
});
