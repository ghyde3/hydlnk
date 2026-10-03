import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, signedInUser } from "../fixtures/data";
import { postgrest, rawRequest, restAs } from "../fixtures/http";
import { makeVersions, versionRows, type MadeVersion } from "./versions-helpers";

/**
 * M6-48: what a user with the publishable key and curl can do to `page_versions`. Everything here is
 * PostgREST with a user JWT (or none): the read gate (the owner, and only while the plan keeps
 * versions), no write for anybody, no RPC that returns a version, and nothing public.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.afterAll(cleanupUsers);

interface Owner {
  userId: string;
  email: string;
  handle: string;
  pageId: string;
  jwt: string;
  versions: MadeVersion[];
}

async function owner(
  context: import("@playwright/test").BrowserContext,
  label: string,
  plan: "pro" | "free",
): Promise<Owner> {
  // Versions are written while the account is Pro (that is the only time the trigger records them).
  const user = await signedInUser(context, { label, plan: "pro" });
  const versions = await makeVersions(user.pageId, 3, { label: `${label}-bio` });
  if (plan === "free") {
    await adminClient().from("accounts").update({ plan: "free" }).eq("id", user.userId);
  }
  return { ...user, jwt: await accessTokenFor(user.email), versions };
}

let a: Owner;
let b: Owner;
let f: Owner;

test.beforeAll(async ({ browser }) => {
  a = await owner(await browser.newContext(), "pva", "pro");
  b = await owner(await browser.newContext(), "pvb", "pro");
  f = await owner(await browser.newContext(), "pvf", "free");
});

const rows = (body: unknown) => body as { id: string; version_no: number; document?: unknown }[];

test.describe("M6-48 the read gate over the API", () => {
  test("M6-48 a Free user selecting their own page's versions gets [] (the rows exist, they are just not readable)", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    expect(await versionRows(f.pageId)).toHaveLength(3);
    const byPage = await restAs(f.jwt, `/page_versions?page_id=eq.${f.pageId}`);
    expect(byPage.status).toBe(200);
    expect(byPage.body).toEqual([]);
    const all = await restAs(f.jwt, `/page_versions?select=*`);
    expect(all.body).toEqual([]);
    const byId = await restAs(f.jwt, `/page_versions?id=eq.${f.versions[0]!.id}`);
    expect(byId.body).toEqual([]);
  });

  test("M6-48 a Pro user reads their own versions, and with another user's page id or version id gets []", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const own = await restAs(a.jwt, `/page_versions?page_id=eq.${a.pageId}&order=version_no`);
    expect(own.status).toBe(200);
    expect(rows(own.body).map((r) => r.version_no)).toEqual([1, 2, 3]);
    // the exact stored document, readable by its owner
    const first = await restAs(a.jwt, `/page_versions?id=eq.${a.versions[0]!.id}&select=document`);
    expect((rows(first.body)[0]!.document as { profile: { bio: string } }).profile.bio).toBe(
      a.versions[0]!.bio,
    );

    const theirPage = await restAs(a.jwt, `/page_versions?page_id=eq.${b.pageId}`);
    expect(theirPage.status).toBe(200);
    expect(theirPage.body).toEqual([]);
    const theirVersion = await restAs(a.jwt, `/page_versions?id=eq.${b.versions[0]!.id}`);
    expect(theirVersion.body).toEqual([]);
    const everything = await restAs(a.jwt, `/page_versions?select=id,page_id`);
    expect(rows(everything.body)).toHaveLength(3);
    expect(JSON.stringify(everything.body)).not.toContain(b.pageId);
  });

  test("M6-48 with the anon key (no session) a select is denied", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const res = await postgrest(`page_versions?page_id=eq.${a.pageId}`);
    expect([401, 403]).toContain(res.status);
    expect(await res.text()).not.toContain(a.versions[0]!.bio);
    // a made-up token is no better
    const forged = await postgrest(`page_versions?page_id=eq.${a.pageId}`, "not-a-jwt");
    expect([401, 403]).toContain(forged.status);
  });

  test("M6-48 a plan flip takes effect on the next request, in both directions, with no data change", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const admin = adminClient();
    const get = async () =>
      rows((await restAs(a.jwt, `/page_versions?page_id=eq.${a.pageId}`)).body).length;
    expect(await get()).toBe(3);
    await admin.from("accounts").update({ plan: "free" }).eq("id", a.userId);
    expect(await get()).toBe(0);
    expect(await versionRows(a.pageId)).toHaveLength(3);
    await admin.from("accounts").update({ plan: "studio" }).eq("id", a.userId);
    expect(await get()).toBe(3);
    await admin.from("accounts").update({ plan: "pro" }).eq("id", a.userId);
    expect(await get()).toBe(3);
  });
});

test.describe("M6-48 nobody writes through the API", () => {
  test("M6-48 POST, PATCH and DELETE are rejected for Pro, Free and anon, and every row is unchanged", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const before = JSON.stringify(await versionRows(a.pageId));
    const beforeF = JSON.stringify(await versionRows(f.pageId));
    const beforeB = JSON.stringify(await versionRows(b.pageId));
    const REJECTED = [401, 403];

    for (const [who, jwt] of [
      ["pro", a.jwt],
      ["free", f.jwt],
    ] as const) {
      const target = who === "pro" ? a : f;
      const post = await restAs(jwt, "/page_versions", {
        method: "POST",
        body: {
          page_id: target.pageId,
          version_no: 99,
          document: { version: 1, forged: true },
          published_at: new Date().toISOString(),
        },
      });
      expect(REJECTED, `${who} POST`).toContain(post.status);
      const patch = await restAs(jwt, `/page_versions?page_id=eq.${target.pageId}`, {
        method: "PATCH",
        body: { document: { version: 1, forged: true } },
      });
      expect(REJECTED, `${who} PATCH`).toContain(patch.status);
      const del = await restAs(jwt, `/page_versions?page_id=eq.${target.pageId}`, {
        method: "DELETE",
      });
      expect(REJECTED, `${who} DELETE`).toContain(del.status);
      // another user's page, too
      const post2 = await restAs(jwt, "/page_versions", {
        method: "POST",
        body: {
          page_id: b.pageId,
          version_no: 99,
          document: { version: 1 },
          published_at: new Date().toISOString(),
        },
      });
      expect(REJECTED, `${who} POST to B`).toContain(post2.status);
      const del2 = await restAs(jwt, `/page_versions?page_id=eq.${b.pageId}`, { method: "DELETE" });
      expect(REJECTED, `${who} DELETE of B`).toContain(del2.status);
    }

    // anon
    const anonPost = await fetch(`${supabaseUrl()}/rest/v1/page_versions`, {
      method: "POST",
      headers: {
        apikey: publishableKey(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        page_id: a.pageId,
        version_no: 99,
        document: {},
        published_at: new Date().toISOString(),
      }),
    });
    expect(REJECTED).toContain(anonPost.status);

    expect(JSON.stringify(await versionRows(a.pageId))).toBe(before);
    expect(JSON.stringify(await versionRows(f.pageId))).toBe(beforeF);
    expect(JSON.stringify(await versionRows(b.pageId))).toBe(beforeB);
  });

  test("M6-48 an owner cannot make a version by publishing: published and published_at are not writable", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    const patch = await restAs(a.jwt, `/pages?id=eq.${a.pageId}`, {
      method: "PATCH",
      body: { published: { version: 1, forged: true }, published_at: new Date().toISOString() },
    });
    expect([401, 403]).toContain(patch.status);
    expect(await versionRows(a.pageId)).toHaveLength(3);
  });

  test("M6-48 no RPC returns a version, and none writes one", async ({}, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    for (const name of [
      "record_page_version",
      "get_page_versions",
      "page_versions",
      "list_versions",
      "restore_page_version",
    ]) {
      for (const jwt of [a.jwt, undefined]) {
        const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: {
            apikey: publishableKey(),
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
            "content-type": "application/json",
          },
          body: JSON.stringify({ p_page_id: a.pageId }),
        });
        expect(res.ok, `${name} as ${jwt ? "owner" : "anon"}`).toBe(false);
        expect(await res.text()).not.toContain(a.versions[0]!.bio);
      }
    }
    // the API's own description lists no function with "version" in its name
    const spec = await postgrest("");
    if (spec.ok) {
      const paths = Object.keys(
        ((await spec.json()) as { paths?: Record<string, unknown> }).paths ?? {},
      );
      expect(paths.filter((p) => p.startsWith("/rpc/") && /version/i.test(p))).toEqual([]);
    }
  });
});

test.describe("M6-48 versions are never public", () => {
  test("M6-48 the public page, its OG image and the click route carry nothing from an older version", async ({
    page,
  }, info) => {
    test.skip(!desktopOnly(info), "an API-level check; one project is enough");
    // an older version holds a marker that the live document does not
    const marker = `OLDERVERSIONMARKER${Date.now().toString(36)}`;
    const admin = adminClient();
    const state = (await admin.from("pages").select("published").eq("id", b.pageId).single()).data!;
    const base = state.published as { profile: Record<string, unknown> };
    await admin
      .from("pages")
      .update({
        published: { ...base, profile: { ...base.profile, bio: marker } } as never,
        published_at: new Date(Date.now() - 20_000).toISOString(),
      })
      .eq("id", b.pageId);
    await admin
      .from("pages")
      .update({
        published: { ...base, profile: { ...base.profile, bio: "The current bio" } } as never,
        published_at: new Date(Date.now() - 10_000).toISOString(),
      })
      .eq("id", b.pageId);
    expect(JSON.stringify(await versionRows(b.pageId))).toContain(marker);

    const host = `${b.handle}.localhost:3000`;
    for (const path of ["/", "/og", "/does-not-exist"]) {
      const res = await rawRequest(host, path);
      expect(res.body, path).not.toContain(marker);
      expect(JSON.stringify(res.headers), path).not.toContain(marker);
    }
    await page.goto(`http://${host}/`);
    await expect(page.getByText("The current bio", { exact: true })).toBeVisible();
    await expect(page.locator("html")).not.toContainText(marker);
    expect(await page.content()).not.toContain(marker);
    // the click route knows a block id, never a version
    const click = await rawRequest("localhost:3000", `/r/${b.pageId}/Bt5rJ1fGz6Os`);
    expect(JSON.stringify(click)).not.toContain(marker);
  });
});
