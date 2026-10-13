import { expect, test } from "@playwright/test";
import { adminClient, publishableKey, supabaseUrl } from "../fixtures/auth";
import { expectClientBlockWriteRefused, homeEntryOf, writeHomeDraft } from "../fixtures/home-abuse";
import { accessTokenFor, cleanupUsers, desktopOnly, insertPage, makeUser, rand } from "../fixtures/data";

/**
 * M5-03 direct-API abuse, on the moved model (M15-14). Home's blocks live in the '/' page entry, so
 * the owner's publishable-key write of `pages.draft` blocks is refused outright with HL013 and
 * content entries have no client write grant. The hostile document is then written with the secret
 * key straight into Home's entry, as an attacker with database access would, and the entry's blocklist
 * trigger must still refuse it with blocked_link, leaving the stored entry unchanged. Each test lists
 * its own (random) blocked domain and removes it again; nothing here touches mara.
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

const storedEntry = async (pageId: string) => {
  const home = await homeEntryOf(pageId);
  return { rev: Number(home.rev), blocks: (home.draft.blocks ?? []) as { url?: string }[] };
};

/** The hostile blocks as the browser sends them (refused, HL013) and as the attacker writes them (refused, blocked_link). */
async function expectBlockedEverywhere(o: { token: string; pageId: string }, name: string, blocks: unknown[]) {
  const before = await storedEntry(o.pageId);
  await expectClientBlockWriteRefused(o.token, o.pageId, blocks);
  const { data, error } = await writeHomeDraft(o.pageId, blocks);
  expect(error, `${name}: the entry's blocklist trigger refuses it`).not.toBeNull();
  expect(error?.message, name).toContain("blocked_link");
  expect(data ?? [], name).toHaveLength(0);
  expect(await storedEntry(o.pageId), `${name}: the stored entry is unchanged`).toEqual(before);
  return error!;
}

test.describe("M5-03 the draft write refuses a blocked link", () => {
  test("M5-03 PATCH of a draft with a blocklisted URL answers 4xx blocked_link and the stored draft is unchanged; an allowed URL saves", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const blocked = await listDomain();
    const o = await owner("bl-api");
    const before = await storedEntry(o.pageId);

    const error = await expectBlockedEverywhere(o, "blocked link", [linkBlock("lnk-aaaaaaaa", `https://${blocked}/x`)]);
    expect(error.code).toBe("HL005");
    expect(error.details).toBe(blocked);
    expect(error.hint).toBe("lnk-aaaaaaaa");
    const after = await storedEntry(o.pageId);
    expect(after.rev).toBe(before.rev);
    expect(after.blocks).toEqual([]);

    // An allowed URL saves: with the secret key into Home's entry (the browser has no write path to blocks).
    const good = await writeHomeDraft(o.pageId, [linkBlock("lnk-aaaaaaaa", "https://ok.example")]);
    expect(good.error).toBeNull();
    expect((await storedEntry(o.pageId)).blocks[0]?.url).toBe("https://ok.example");
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
    for (const [name, block] of attempts) await expectBlockedEverywhere(o, name, [block]);
    const after = await storedEntry(o.pageId);
    expect(after.blocks).toEqual([]);
  });

  test("M5-03 localhost, IP literals and single-label hosts are refused through the API; a theme background image URL on the local storage origin is not a link", async ({}, info) => {
    test.skip(!desktopOnly(info), "no UI involved");
    const o = await owner("bl-builtin");
    for (const url of ["http://localhost:3000/x", "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "https://intranet/"]) {
      await expectBlockedEverywhere(o, url, [linkBlock("b-1", url)]);
    }
    // A theme background image is a design field: it stays a PATCH of pages.draft and is not a link.
    const { data: row } = await adminClient().from("pages").select("draft").eq("id", o.pageId).single();
    const frozen = row!.draft as Record<string, unknown>;
    const withBackground = {
      ...frozen,
      rev: Number(frozen.rev ?? 1) + 1,
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
    const saved = await writeHomeDraft(o.pageId, [linkBlock("b-1", `https://${late}/x`)]);
    expect(saved.error).toBeNull();
    const { error } = await adminClient().from("blocked_domains").insert({ domain: late, reason: "e2e" });
    expect(error).toBeNull();
    domains.push(late);
    const rev = (await storedEntry(o.pageId)).rev;
    // The browser's attempt is refused at the door; the attacker's unrelated edit hits the entry trigger.
    await expectClientBlockWriteRefused(o.token, o.pageId, [linkBlock("b-1", `https://${late}/x`)]);
    const edit = await writeHomeDraft(o.pageId, [linkBlock("b-1", `https://${late}/x`)], {
      profile: { name: "New name", bio: "", photo: null },
    });
    expect(edit.error?.message).toContain("blocked_link");
    expect((await storedEntry(o.pageId)).rev).toBe(rev);
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
    expect((await storedEntry(b.pageId)).blocks).toEqual([]);

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
