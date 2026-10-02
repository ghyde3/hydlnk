import { expect, test } from "@playwright/test";
import { SYSTEM_DEFAULT_TOKENS } from "@/lib/theme";
import { adminClient } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, makeUser, type TestUser } from "../fixtures/data";
import { restAs } from "../fixtures/http";

/**
 * Direct-API abuse of the themes table with a user JWT and the publishable key, the way curl would
 * (M3-03, M3-05, M3-19, M3-22, M3-23, M3-24). RLS and the database triggers are the only barrier
 * here: no browser, no Next.js. The same rules are proven row by row in
 * supabase/tests/database/090-system-themes.test.sql. Runs once (desktop project): nothing in it
 * depends on the viewport.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "API only: one project is enough");
});
test.afterAll(cleanupUsers);

const tokens = (accent: string) => ({ ...SYSTEM_DEFAULT_TOKENS, accent });

async function seedTheme(owner: TestUser, name: string, accent = "#FF00AA"): Promise<string> {
  const { data, error } = await adminClient()
    .from("themes")
    .insert({ owner_id: owner.id, name, tokens: tokens(accent) as never })
    .select("id")
    .single();
  if (error) throw new Error(`seedTheme failed: ${error.message}`);
  return data.id as string;
}

async function rowOf(id: string) {
  const { data } = await adminClient()
    .from("themes")
    .select("id, name, owner_id, tokens")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function countOf(ownerId: string): Promise<number> {
  const { count } = await adminClient()
    .from("themes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  return count ?? 0;
}

const SYSTEM = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

test.describe("M3-03 system themes are read-only for clients", () => {
  test("M3-03 PATCH and DELETE on a system row change nothing, and an insert with owner_id null is rejected", async () => {
    const user = await makeUser("th-sys");
    const token = await accessTokenFor(user.email);

    for (const id of SYSTEM) {
      const before = await rowOf(id);
      expect(before).not.toBeNull();

      const patch = await restAs(token, `/themes?id=eq.${id}`, {
        method: "PATCH",
        body: { name: "Hacked", tokens: {} },
      });
      expect(patch.status).toBeLessThan(500);
      expect(patch.body).toEqual([]); // zero rows affected

      const del = await restAs(token, `/themes?id=eq.${id}`, { method: "DELETE" });
      expect(del.body).toEqual([]);

      expect(await rowOf(id)).toEqual(before);
    }

    // The same for every system row at once.
    const sweep = await restAs(token, "/themes?owner_id=is.null", {
      method: "PATCH",
      body: { name: "Hacked" },
    });
    expect(sweep.body).toEqual([]);
    const sweepDelete = await restAs(token, "/themes?owner_id=is.null", { method: "DELETE" });
    expect(sweepDelete.body).toEqual([]);

    const insert = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: null, name: "Fake system", tokens: tokens("#000000") },
    });
    expect(insert.status).toBeGreaterThanOrEqual(400);
    expect(insert.status).toBeLessThan(500);
    const { data } = await adminClient().from("themes").select("id").eq("name", "Fake system");
    expect(data).toEqual([]);

    // Every system theme is readable by this user, and by anyone with the publishable key.
    const read = await restAs(token, "/themes?owner_id=is.null&select=id,name");
    expect((read.body as { id: string }[]).length).toBeGreaterThanOrEqual(6);
  });
});

test.describe("M3-05 / M3-19 other users' saved themes", () => {
  test("M3-05 M3-19 a user's JWT reads none of another user's saved themes", async () => {
    const mara = await makeUser("th-a");
    const b = await makeUser("th-b");
    const bTheme = await seedTheme(b, "B private");
    const maraTheme = await seedTheme(mara, "Mara one", "#8FA68A");
    const maraToken = await accessTokenFor(mara.email);
    const bToken = await accessTokenFor(b.email);

    const byId = await restAs(maraToken, `/themes?id=eq.${bTheme}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toEqual([]);

    const byOwner = await restAs(bToken, `/themes?owner_id=eq.${mara.id}`);
    expect(byOwner.body).toEqual([]);

    // B's whole readable set: the system themes and B's own, never Mara's.
    const all = (await restAs(bToken, "/themes?select=id,owner_id,name")).body as {
      id: string;
      owner_id: string | null;
    }[];
    expect(all.some((row) => row.id === maraTheme)).toBe(false);
    expect(all.filter((row) => row.owner_id !== null).map((row) => row.id)).toEqual([bTheme]);
    expect(JSON.stringify(all)).not.toContain("Mara one");

    // Without a JWT only the system themes are readable.
    const { publishableKey, supabaseUrl } = await import("../fixtures/auth");
    const anon = await fetch(`${supabaseUrl()}/rest/v1/themes?select=owner_id`, {
      headers: { apikey: publishableKey() },
    });
    const anonRows = (await anon.json()) as { owner_id: string | null }[];
    expect(anonRows.length).toBeGreaterThanOrEqual(6);
    expect(anonRows.every((row) => row.owner_id === null)).toBe(true);
  });
});

test.describe("M3-22 the Free limit is enforced on insert", () => {
  test("M3-22 a 4th saved theme is rejected, and the row count stays 3", async () => {
    const user = await makeUser("th-free");
    const token = await accessTokenFor(user.email);
    for (const n of [1, 2, 3]) {
      const ok = await restAs(token, "/themes", {
        method: "POST",
        body: { owner_id: user.id, name: `Mine ${n}`, tokens: tokens("#C46A4F") },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    }
    const fourth = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: user.id, name: "Mine 4", tokens: tokens("#C46A4F") },
    });
    expect(fourth.status).toBeGreaterThanOrEqual(400);
    expect(fourth.status).toBeLessThan(500);
    expect((fourth.body as { code?: string }).code).toBe("HL002");
    expect(await countOf(user.id)).toBe(3);
  });

  test("M3-22 six concurrent inserts starting from 2 saved themes leave exactly 3 rows", async () => {
    const user = await makeUser("th-race");
    await seedTheme(user, "Race one");
    await seedTheme(user, "Race two");
    const token = await accessTokenFor(user.email);

    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        restAs(token, "/themes", {
          method: "POST",
          body: { owner_id: user.id, name: `Racer ${n}`, tokens: tokens("#C46A4F") },
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => (r.body as { code?: string }).code === "HL002")).toHaveLength(5);
    expect(await countOf(user.id)).toBe(3);
  });

  test("M3-22 an insert with another user's owner_id, a missing user's, or null is rejected, and answers the same for all", async () => {
    const user = await makeUser("th-own");
    const victim = await makeUser("th-victim");
    const pro = await makeUser("th-pro", { plan: "pro" });
    const full = await makeUser("th-full");
    for (const n of [1, 2, 3]) await seedTheme(full, `Full ${n}`);
    const token = await accessTokenFor(user.email);

    const attempts = [victim.id, pro.id, full.id, crypto.randomUUID(), null];
    const answers: string[] = [];
    for (const ownerId of attempts) {
      const res = await restAs(token, "/themes", {
        method: "POST",
        body: { owner_id: ownerId, name: "Planted", tokens: tokens("#000000") },
      });
      expect(res.status, `owner ${ownerId}`).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // Same status and code whatever the target: nothing about the other account leaks (an
      // account that exists, its plan, or whether it is at its limit).
      answers.push(`${res.status}:${(res.body as { code?: string }).code}`);
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toMatch(/:42501$/);
    expect(await countOf(victim.id)).toBe(0);
    expect(await countOf(pro.id)).toBe(0);
    expect(await countOf(full.id)).toBe(3);
  });

  test("M3-22 a Pro account set through the secret key saves 10 and more", async () => {
    const user = await makeUser("th-prolim", { plan: "pro" });
    const token = await accessTokenFor(user.email);
    for (let n = 1; n <= 10; n++) {
      const res = await restAs(token, "/themes", {
        method: "POST",
        body: { owner_id: user.id, name: `Pro ${n}`, tokens: tokens("#C46A4F") },
      });
      expect(res.status, `insert ${n}: ${JSON.stringify(res.body)}`).toBe(201);
    }
    expect(await countOf(user.id)).toBe(10);
  });
});

test.describe("M3-23 / M3-24 update, rename and delete are owner only", () => {
  test("M3-23 user B's PATCH (rename or tokens) of a shared theme changes nothing; the owner's does", async () => {
    const owner = await makeUser("th-pat-a", { plan: "pro" });
    const b = await makeUser("th-pat-b");
    const shared = await seedTheme(owner, "Shared look", "#8FA68A");
    const before = await rowOf(shared);
    const bToken = await accessTokenFor(b.email);

    const rename = await restAs(bToken, `/themes?id=eq.${shared}`, {
      method: "PATCH",
      body: { name: "Night Market" },
    });
    expect(rename.body).toEqual([]);
    const retoken = await restAs(bToken, `/themes?id=eq.${shared}`, {
      method: "PATCH",
      body: { tokens: tokens("#000000") },
    });
    expect(retoken.body).toEqual([]);
    const reown = await restAs(bToken, `/themes?id=eq.${shared}`, {
      method: "PATCH",
      body: { owner_id: b.id },
    });
    expect(reown.status).toBeGreaterThanOrEqual(400);
    expect(await rowOf(shared)).toEqual(before);

    // The owner can rename and change tokens (the Update button's write).
    const ownerToken = await accessTokenFor(owner.email);
    const own = await restAs(ownerToken, `/themes?id=eq.${shared}`, {
      method: "PATCH",
      body: { name: "Night Market", tokens: tokens("#123456") },
    });
    expect(own.status).toBe(200);
    expect((own.body as { name: string }[])[0]!.name).toBe("Night Market");
    const after = await rowOf(shared);
    expect(after!.name).toBe("Night Market");
    expect((after!.tokens as { accent: string }).accent).toBe("#123456");
  });

  test("M3-23 a 41-character name is rejected by a database constraint; 40 is accepted; blank is rejected", async () => {
    const owner = await makeUser("th-len");
    const id = await seedTheme(owner, "Length test");
    const token = await accessTokenFor(owner.email);

    const long = await restAs(token, `/themes?id=eq.${id}`, {
      method: "PATCH",
      body: { name: "x".repeat(41) },
    });
    expect(long.status).toBe(400);
    expect((long.body as { code?: string }).code).toBe("23514");
    expect((await rowOf(id))!.name).toBe("Length test");

    const blank = await restAs(token, `/themes?id=eq.${id}`, {
      method: "PATCH",
      body: { name: "   " },
    });
    expect(blank.status).toBe(400);

    const ok = await restAs(token, `/themes?id=eq.${id}`, {
      method: "PATCH",
      body: { name: "y".repeat(40) },
    });
    expect(ok.status).toBe(200);
    expect((await rowOf(id))!.name).toBe("y".repeat(40));
  });

  test("M3-24 DELETE on a system theme or another user's theme removes nothing; the owner's DELETE is allowed", async () => {
    const owner = await makeUser("th-del-a", { plan: "pro" });
    const b = await makeUser("th-del-b");
    const shared = await seedTheme(owner, "Shared look");
    const bToken = await accessTokenFor(b.email);
    const ownerToken = await accessTokenFor(owner.email);

    const foreign = await restAs(bToken, `/themes?id=eq.${shared}`, { method: "DELETE" });
    expect(foreign.body).toEqual([]);
    expect(await rowOf(shared)).not.toBeNull();

    for (const id of SYSTEM) {
      const system = await restAs(bToken, `/themes?id=eq.${id}`, { method: "DELETE" });
      expect(system.body).toEqual([]);
      expect(await rowOf(id)).not.toBeNull();
    }

    const own = await restAs(ownerToken, `/themes?id=eq.${shared}`, { method: "DELETE" });
    expect(own.status).toBe(200);
    expect(await rowOf(shared)).toBeNull();
  });

  test("M3-24 after a delete a Free user at 3 saved themes can save again", async () => {
    const user = await makeUser("th-free-del");
    const ids = [
      await seedTheme(user, "One"),
      await seedTheme(user, "Two"),
      await seedTheme(user, "Three"),
    ];
    const token = await accessTokenFor(user.email);
    const blocked = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: user.id, name: "Four", tokens: tokens("#000000") },
    });
    expect((blocked.body as { code?: string }).code).toBe("HL002");

    const del = await restAs(token, `/themes?id=eq.${ids[0]}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await countOf(user.id)).toBe(2);
    const again = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: user.id, name: "Four", tokens: tokens("#000000") },
    });
    expect(again.status).toBe(201);
    expect(await countOf(user.id)).toBe(3);
  });
});
