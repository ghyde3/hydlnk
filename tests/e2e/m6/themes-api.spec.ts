import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, makeUser } from "../fixtures/data";
import { restAs } from "../fixtures/http";
import { SYSTEM_DEFAULT_TOKENS } from "@/lib/theme";
import {
  SYSTEM_IDS,
  SYSTEM_NAMES,
  messageOf,
  openDesignWithCard,
  seedTheme,
  themeUser,
} from "./themes-helpers";

/**
 * Direct-API abuse of the sixteen system themes (M6-43, extending M3-03 and M3-22) with a user JWT
 * and the publishable key, the way curl would: RLS and the database triggers are the only barrier.
 * The same rules are proven row by row in supabase/tests/database/130-more-themes.test.sql. Nothing
 * here depends on the viewport, so it runs once (desktop).
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "API only: one project is enough");
});
test.afterAll(cleanupUsers);

const tokens = (accent: string) => ({ ...SYSTEM_DEFAULT_TOKENS, accent });
const IDS = Object.values(SYSTEM_IDS);

async function systemSnapshot() {
  const { data, error } = await adminClient()
    .from("themes")
    .select("id, name, owner_id, tokens")
    .is("owner_id", null)
    .order("id", { ascending: true });
  if (error) throw new Error(`reading the system themes failed: ${error.message}`);
  return data;
}

test.describe("M6-43 the sixteen are readable by everyone and writable by no client", () => {
  test("M6-43 anon and signed-in users read all 16 system rows", async () => {
    const user = await makeUser("t43-read");
    const token = await accessTokenFor(user.email);

    const signedIn = await restAs(token, "/themes?owner_id=is.null&select=id,name&order=id.asc");
    expect(signedIn.status).toBe(200);
    expect((signedIn.body as { id: string }[]).map((row) => row.id)).toEqual(IDS);
    expect((signedIn.body as { name: string }[]).map((row) => row.name)).toEqual(SYSTEM_NAMES);

    const anon = await fetch(`${supabaseUrl()}/rest/v1/themes?select=id,owner_id&order=id.asc`, {
      headers: { apikey: publishableKey() },
    });
    expect(anon.status).toBe(200);
    const rows = (await anon.json()) as { id: string; owner_id: string | null }[];
    expect(rows.map((row) => row.id)).toEqual(IDS);
    expect(rows.every((row) => row.owner_id === null)).toBe(true);
  });

  test("M6-43 PATCH and DELETE on each of the 16 rows change nothing, and a POST with owner_id null is rejected", async () => {
    const user = await makeUser("t43-write");
    const token = await accessTokenFor(user.email);
    const before = await systemSnapshot();
    expect(before).toHaveLength(16);

    for (const id of IDS) {
      const patch = await restAs(token, `/themes?id=eq.${id}`, {
        method: "PATCH",
        body: { name: "Hacked", tokens: {} },
      });
      expect(patch.status, `PATCH ${id}`).toBeLessThan(500);
      expect(patch.body, `PATCH ${id} affected no row`).toEqual([]);
      const del = await restAs(token, `/themes?id=eq.${id}`, { method: "DELETE" });
      expect(del.body, `DELETE ${id} removed no row`).toEqual([]);
    }
    // The same for every system row at once.
    expect(
      (
        await restAs(token, "/themes?owner_id=is.null", {
          method: "PATCH",
          body: { name: "Hacked" },
        })
      ).body,
    ).toEqual([]);
    expect((await restAs(token, "/themes?owner_id=is.null", { method: "DELETE" })).body).toEqual(
      [],
    );

    // Re-read: every row is exactly as it was.
    expect(await systemSnapshot()).toEqual(before);

    const insert = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: null, name: "Fake system", tokens: tokens("#000000") },
    });
    expect(insert.status).toBeGreaterThanOrEqual(400);
    expect(insert.status).toBeLessThan(500);
    const { data } = await adminClient().from("themes").select("id").eq("name", "Fake system");
    expect(data).toEqual([]);
    expect(await systemSnapshot()).toEqual(before);
  });

  test("M6-43 the sixteen do not count towards the Free limit: three saved themes, the limit message in the UI, the 4th insert rejected", async ({
    page,
    context,
  }) => {
    const user = await themeUser(context, "t43-free", "free");
    for (const n of [1, 2, 3]) await seedTheme(user.userId, `Mine ${n}`, { accent: "#C46A4F" });
    await openDesignWithCard(page);

    // 16 system cards and the user's three: the list is longer than the limit, and the limit still reads 3.
    await expect(page.getByTestId("theme-card")).toHaveCount(19);
    await page.getByTestId("save-as-theme").click();
    await expect(messageOf(page)).toContainText(
      "You’ve used 3 of 3 saved themes. Delete one or upgrade to Pro.",
    );

    // The same through the API: a 4th insert is refused by the database (HL002) and the count stays 3.
    const token = await accessTokenFor(user.email);
    expect(token).toBeTruthy();
    const fourth = await restAs(token, "/themes", {
      method: "POST",
      body: { owner_id: user.userId, name: "Mine 4", tokens: tokens("#C46A4F") },
    });
    expect(fourth.status).toBeGreaterThanOrEqual(400);
    expect(fourth.status).toBeLessThan(500);
    expect((fourth.body as { code?: string }).code).toBe("HL002");
    const { count } = await adminClient()
      .from("themes")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.userId);
    expect(count).toBe(3);
  });
});

test.describe("M6-44 another user's saved theme", () => {
  test("M6-44 with user B's JWT, a read of user A's themes returns an empty array", async () => {
    const a = await makeUser("t44-a");
    const b = await makeUser("t44-b");
    const aTheme = await seedTheme(a.id, "A private", { accent: "#FF00AA" });
    const token = await accessTokenFor(b.email);

    const byOwner = await restAs(token, `/themes?owner_id=eq.${a.id}`);
    expect(byOwner.status).toBe(200);
    expect(byOwner.body).toEqual([]);
    const byId = await restAs(token, `/themes?id=eq.${aTheme.id}`);
    expect(byId.body).toEqual([]);
    // B's whole readable set is the sixteen and B's own: never A's.
    const all = (await restAs(token, "/themes?select=id,owner_id")).body as {
      id: string;
      owner_id: string | null;
    }[];
    expect(all.filter((row) => row.owner_id !== null)).toEqual([]);
    expect(all).toHaveLength(16);
  });
});
