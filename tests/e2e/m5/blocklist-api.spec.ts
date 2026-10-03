import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { accessTokenFor, cleanupUsers, desktopOnly, insertPage, makeUser, rand } from "../fixtures/data";

/**
 * M5-03 direct-API abuse: the draft is saved with the publishable key and the owner's JWT straight
 * to PostgREST, so the `pages` trigger is the only thing between a user and a phishing link. Each
 * test lists its own (random) blocked domain and removes it again; nothing here touches mara.
 */

test.describe.configure({ timeout: 120_000 });

const domains: string[] = [];
async function listDomain(): Promise<string> {
  const domain = `blk-${rand(8)}.example`;
  const { error } = await adminClient().from("blocked_domains").insert({ domain, reason: "e2e" });
  if (error) throw new Error(`blocked_domains insert failed: ${error.message}`);
  domains.push(domain);
  return domain;
}

test.afterAll(async () => {
  if (domains.length > 0) await adminClient().from("blocked_domains").delete().in("domain", domains);
  await cleanupUsers();
});

const rest = (token: string | null, path: string, init: RequestInit = {}) =>
  fetch(`${supabaseUrl()}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: publishableKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const linkBlock = (id: string, url: string) => ({ id, type: "link", visible: true, label: "Link", url });
const draftOf = (handle: string, rev: number, blocks: unknown[]) => ({
  version: 1,
  rev,
  profile: { name: handle, bio: "", photo: null },
  theme: { ref: null, overrides: {} },
  blocks,
});

async function owner(label: string) {
  const user = await makeUser(label);
  const handle = `zq-${label}-${rand(5)}`;
  const pageId = await insertPage(user.id, handle, { draft: draftOf(handle, 1, []) });
  const token = await accessTokenFor(user.email);
  return { ...user, handle, pageId, token };
}

const storedDraft = async (pageId: string) => {
  const { data, error } = await adminClient().from("pages").select("draft").eq("id", pageId).single();
  if (error) throw new Error(error.message);
  return data.draft as { rev: number; blocks: { url?: string }[] };
};

test.describe("M5-03 the draft write refuses a blocked link", () => {
  test("M5-03 PATCH of a draft with a blocklisted URL answers 4xx blocked_link and the stored draft is unchanged; an allowed URL saves", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const blocked = await listDomain();
    const o = await owner("bl-api");

    const bad = await rest(o.token, `/pages?id=eq.${o.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: draftOf(o.handle, 2, [linkBlock("lnk-aaaaaaaa", `https://${blocked}/x`)]) }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const body = (await bad.json()) as { code: string; message: string; details: string; hint: string };
    expect(body.message).toContain("blocked_link");
    expect(body.code).toBe("HL005");
    expect(body.details).toBe(blocked);
    expect(body.hint).toBe("lnk-aaaaaaaa");
    const after = await storedDraft(o.pageId);
    expect(after.rev).toBe(1);
    expect(after.blocks).toEqual([]);

    const good = await rest(o.token, `/pages?id=eq.${o.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: draftOf(o.handle, 2, [linkBlock("lnk-aaaaaaaa", "https://ok.example")]) }),
    });
    expect(good.status).toBe(200);
    expect((await storedDraft(o.pageId)).blocks[0]?.url).toBe("https://ok.example");
  });

  test("M5-03 subdomains, grid cells, social icons, upper case, trailing dots, credentials, ports and encoded hosts are all refused through the API", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const blocked = await listDomain();
    const o = await owner("bl-forms");
    const attempts: [string, unknown][] = [
      ["subdomain", linkBlock("b-1", `https://www.${blocked}/a?b=1`)],
      ["upper case", linkBlock("b-1", `https://${blocked.toUpperCase()}`)],
      ["trailing dot", linkBlock("b-1", `https://${blocked}.`)],
      ["credentials", linkBlock("b-1", `https://good.example@${blocked}/`)],
      ["port", linkBlock("b-1", `https://${blocked}:8443/`)],
      ["encoded dot", linkBlock("b-1", `https://${blocked.replace(".", "%2E")}/`)],
      [
        "grid cell",
        {
          id: "b-1",
          type: "grid",
          visible: true,
          cells: [
            { id: "c-1", title: "A", subtitle: "", url: "https://ok.example" },
            { id: "c-2", title: "B", subtitle: "", url: `https://${blocked}` },
          ],
        },
      ],
      [
        "social icon",
        { id: "b-1", type: "social", visible: true, icons: [{ id: "i-1", platform: "github", url: `https://${blocked}` }] },
      ],
      ["card", { id: "b-1", type: "card", visible: true, title: "T", caption: "", image: null, url: `https://${blocked}` }],
      ["embed", { id: "b-1", type: "embed", visible: true, caption: "", url: `https://${blocked}` }],
    ];
    for (const [name, block] of attempts) {
      const res = await rest(o.token, `/pages?id=eq.${o.pageId}`, {
        method: "PATCH",
        body: JSON.stringify({ draft: draftOf(o.handle, 9, [block]) }),
      });
      const text = await res.text();
      expect(res.status, `${name}: ${text}`).toBeGreaterThanOrEqual(400);
      expect(res.status, name).toBeLessThan(500);
      expect(text, name).toContain("blocked_link");
    }
    const after = await storedDraft(o.pageId);
    expect(after.rev).toBe(1);
    expect(after.blocks).toEqual([]);
  });

  test("M5-03 localhost, IP literals and single-label hosts are refused through the API; a theme background image URL on the local storage origin is not a link", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const o = await owner("bl-builtin");
    for (const url of ["http://localhost:3000/x", "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "https://intranet/"]) {
      const res = await rest(o.token, `/pages?id=eq.${o.pageId}`, {
        method: "PATCH",
        body: JSON.stringify({ draft: draftOf(o.handle, 9, [linkBlock("b-1", url)]) }),
      });
      const text = await res.text();
      expect(res.status, `${url}: ${text}`).toBe(400);
      expect(text, url).toContain("blocked_link");
    }
    const withBackground = {
      ...draftOf(o.handle, 2, [linkBlock("b-1", "https://ok.example")]),
      theme: {
        ref: null,
        overrides: { bgImage: `http://127.0.0.1:54321/storage/v1/object/public/page-media/${o.id}/bg-0123abcd.webp` },
      },
    };
    const ok = await rest(o.token, `/pages?id=eq.${o.pageId}`, { method: "PATCH", body: JSON.stringify({ draft: withBackground }) });
    expect(ok.status).toBe(200);
  });

  test("M5-03 a domain listed after the draft was saved refuses the next save, and an unrelated edit of the draft cannot slip past it", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const o = await owner("bl-late");
    const late = `blk-${rand(8)}.example`;
    const saved = await rest(o.token, `/pages?id=eq.${o.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: draftOf(o.handle, 2, [linkBlock("b-1", `https://${late}/x`)]) }),
    });
    expect(saved.status).toBe(200);
    const { error } = await adminClient().from("blocked_domains").insert({ domain: late, reason: "e2e" });
    expect(error).toBeNull();
    domains.push(late);
    const edit = await rest(o.token, `/pages?id=eq.${o.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: { ...draftOf(o.handle, 3, [linkBlock("b-1", `https://${late}/x`)]), profile: { name: "New name", bio: "", photo: null } } }),
    });
    expect(edit.status).toBe(400);
    expect(await edit.text()).toContain("blocked_link");
    expect((await storedDraft(o.pageId)).rev).toBe(2);
  });

  test("M5-03 another owner's page is untouched, and the list and the check function are closed to the publishable key", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const blocked = await listDomain();
    const a = await owner("bl-a");
    const b = await owner("bl-b");

    // A PATCH of someone else's page matches no row: nothing is written, and nothing about the list leaks.
    const cross = await rest(a.token, `/pages?id=eq.${b.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ draft: draftOf(b.handle, 9, [linkBlock("b-1", "https://ok.example")]) }),
    });
    expect(await cross.json()).toEqual([]);
    expect((await storedDraft(b.pageId)).rev).toBe(1);

    for (const [who, token] of [["anon", null], ["authenticated", a.token]] as const) {
      const list = await rest(token, "/blocked_domains?select=domain");
      expect([401, 403], `${who} select`).toContain(list.status);
      expect(await list.text(), `${who} select`).not.toContain(blocked);

      const insert = await rest(token, "/blocked_domains", { method: "POST", body: JSON.stringify({ domain: `${who}-x.example` }) });
      expect([401, 403], `${who} insert`).toContain(insert.status);

      const patch = await rest(token, `/blocked_domains?domain=eq.${blocked}`, { method: "PATCH", body: JSON.stringify({ reason: "x" }) });
      expect([401, 403], `${who} update`).toContain(patch.status);
      const del = await rest(token, `/blocked_domains?domain=eq.${blocked}`, { method: "DELETE" });
      expect([401, 403], `${who} delete`).toContain(del.status);

      const rpc = await rest(token, "/rpc/blocked_links_in", { method: "POST", body: JSON.stringify({ p_draft: draftOf("x", 1, []) }) });
      expect([401, 403], `${who} rpc`).toContain(rpc.status);
      const host = await rest(token, "/rpc/blocklist_url_host", { method: "POST", body: JSON.stringify({ p_url: "https://x.example" }) });
      expect([401, 403], `${who} host rpc`).toContain(host.status);
    }
    const still = await adminClient().from("blocked_domains").select("domain, reason").eq("domain", blocked).single();
    expect(still.data).toEqual({ domain: blocked, reason: "e2e" });
  });
});
