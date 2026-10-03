import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { draftOf, makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M6-10 server half against the local Supabase: what a share link shows. The loader reads the link
 * by the SHA-256 of its token, then that page's saved draft, and answers `inactive` for every way a
 * link can fail to be active, so nothing tells one cause from another.
 */
const { run } = await stackIsUp();

const DAY = 24 * 3600 * 1000;

describe("M6-10 loadSharedPreview: token shapes (no database)", () => {
  it("a token that is not 43 base64url characters never makes a query", async () => {
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    const from = vi.fn(() => {
      throw new Error("the database must not be reached");
    });
    const spy = { from } as never;
    const malformed: unknown[] = [
      "",
      "abc",
      "a".repeat(42),
      "a".repeat(44),
      "a".repeat(100),
      "../x",
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)}+`,
      `${"a".repeat(42)}/`,
      `${"a".repeat(40)}%2F`,
      `${"a".repeat(42)} `,
      `${"a".repeat(42)}\n`,
      `${"a".repeat(42)}é`,
      "' or 1=1 --",
      null,
      undefined,
      42,
      { token: "a".repeat(43) },
      ["a".repeat(43)],
    ];
    for (const token of malformed) {
      expect(await loadSharedPreview(spy, token), JSON.stringify(token)).toEqual({
        kind: "inactive",
      });
    }
    expect(from).not.toHaveBeenCalled();
  });
});

describe.skipIf(!run)("M6-10 loadSharedPreview (local Supabase)", () => {
  let admin: SupabaseClient;
  let shared: typeof import("@/lib/previews/shared");
  let core: typeof import("@/lib/previews/core");
  const owners: TestOwner[] = [];

  const deps = () => ({
    admin: admin as never,
    isSuspended: async () => false,
    limit: async () => ({ allowed: true, retryAfter: 0 }),
    appOrigin: "http://app.localhost:3000",
  });
  const linkFor = async (owner: TestOwner) => {
    const result = await core.createPreviewLinkCore(deps(), owner.userId, owner.pageId);
    if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
    return { id: result.id, token: result.url.slice(result.url.lastIndexOf("/") + 1) };
  };
  const load = (token: unknown, now?: Date) => shared.loadSharedPreview(admin as never, token, now);
  const owner = async (
    label: string,
    name = "Zq Owner",
    plan: "free" | "pro" | "studio" = "free",
  ) => {
    const made = await makeOwner(admin, label, () => draftOf(name), plan);
    owners.push(made);
    return made;
  };

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    shared = await import("@/lib/previews/shared");
    core = await import("@/lib/previews/core");
  });

  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("an active link shows the draft as saved: page id, the publish form, the owner's plan and the expiry", async () => {
    const a = await owner("sl-a", "Draft Name", "pro");
    const { token } = await linkFor(a);
    const result = await load(token);
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    expect(result.pageId).toBe(a.pageId);
    expect(result.doc.profile.name).toBe("Draft Name");
    expect(result.plan).toBe("pro");
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(Object.keys(result.doc)).toEqual(
      expect.arrayContaining(["blocks", "profile", "tokens"]),
    );
    expect(Object.keys(result.doc)).not.toContain("rev");
  });

  it("no snapshot: an edit after the link was made shows at the next load, and only the draft has it", async () => {
    const a = await owner("sl-snap");
    const { token } = await linkFor(a);
    const edited = draftOf("Edited", undefined, {});
    edited.profile.bio = "DRAFT-ONLY-7f3a";
    const { error } = await admin
      .from("pages")
      .update({ draft: edited as never })
      .eq("id", a.pageId);
    expect(error).toBeNull();
    const result = await load(token);
    expect(result.kind === "active" && result.doc.profile.bio).toBe("DRAFT-ONLY-7f3a");
    const stored = await admin.from("pages").select("published").eq("id", a.pageId).single();
    expect(JSON.stringify(stored.data?.published)).not.toContain("DRAFT-ONLY-7f3a");
  });

  it("hidden blocks are absent and incomplete blocks stay in (the renderer draws their placeholders)", async () => {
    const a = await owner("sl-blocks");
    const { token } = await linkFor(a);
    const draft = draftOf("Blocks", [
      {
        id: "lnk-visible1",
        type: "link",
        visible: true,
        label: "Shown",
        url: "https://example.com/a",
      },
      {
        id: "lnk-hidden01",
        type: "link",
        visible: false,
        label: "Hidden",
        url: "https://example.com/b",
      },
      { id: "img-incompl1", type: "image", visible: true, image: null, alt: "", link: "" } as never,
    ]);
    await admin
      .from("pages")
      .update({ draft: draft as never })
      .eq("id", a.pageId);
    const result = await load(token);
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    const ids = result.doc.blocks.map((block) => block.id);
    expect(ids).toContain("lnk-visible1");
    expect(ids).not.toContain("lnk-hidden01");
  });

  it("hidden control and bidi characters of a lenient draft are removed; a text block keeps its line breaks", async () => {
    const a = await owner("sl-hidden");
    const { token } = await linkFor(a);
    const draft = draftOf("Ada\u202Elovelace", [
      {
        id: "lnk-hidden001",
        type: "link",
        visible: true,
        label: "Pay\u202Epal\u0007now",
        url: "https://example.com/pay",
      },
      {
        id: "txt-hidden001",
        type: "text",
        visible: true,
        text: "One\nTwo\u2067\u0001\n\nThree",
      },
    ]);
    draft.profile.bio = "Bi\u0008o\u2066";
    const saved = await admin
      .from("pages")
      .update({ draft: draft as never })
      .eq("id", a.pageId);
    expect(saved.error).toBeNull();

    const result = await load(token);
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    expect(result.doc.profile.name).toBe("Adalovelace");
    expect(result.doc.profile.bio).toBe("Bio");
    const [label, text] = result.doc.blocks as unknown as { label?: string; text?: string }[];
    expect(label?.label).toBe("Paypalnow");
    expect(text?.text).toBe("One\nTwo\n\nThree");
    // The stored draft is not touched: only what is shown is cleaned.
    const stored = await admin.from("pages").select("draft").eq("id", a.pageId).single();
    expect(JSON.stringify(stored.data?.draft)).toContain("\u202E");
  });

  it("every way a link can be not active answers the same `inactive`", async () => {
    const unknown = "Q".repeat(43);
    expect(await load(unknown)).toEqual({ kind: "inactive" });

    // turned off
    const off = await owner("sl-off");
    const offLink = await linkFor(off);
    await core.revokePreviewLinkCore(deps(), off.userId, offLink.id);
    expect(await load(offLink.token)).toEqual({ kind: "inactive" });

    // expired (the whole lifetime moved into the past, as the check requires)
    const old = await owner("sl-old");
    const oldLink = await linkFor(old);
    // A 6 day span: well inside the check (at most 7 days between created_at and expires_at).
    const now = Date.now();
    const moved = await admin
      .from("preview_links")
      .update({
        created_at: new Date(now - 9 * DAY).toISOString(),
        expires_at: new Date(now - 3 * DAY).toISOString(),
      })
      .eq("id", oldLink.id);
    expect(moved.error).toBeNull();
    expect(await load(oldLink.token)).toEqual({ kind: "inactive" });

    // a link exactly at its expiry is over
    const edge = await owner("sl-edge");
    const edgeLink = await linkFor(edge);
    const row = await admin
      .from("preview_links")
      .select("expires_at")
      .eq("id", edgeLink.id)
      .single();
    expect(await load(edgeLink.token, new Date(row.data!.expires_at))).toEqual({
      kind: "inactive",
    });
    expect(
      (await load(edgeLink.token, new Date(new Date(row.data!.expires_at).getTime() - 1))).kind,
    ).toBe("active");

    // the page was deleted: its links go with it
    const gone = await owner("sl-gone");
    const goneLink = await linkFor(gone);
    expect((await load(goneLink.token)).kind).toBe("active");
    await admin.from("pages").delete().eq("id", gone.pageId);
    expect(await load(goneLink.token)).toEqual({ kind: "inactive" });
  });

  it("a suspended owner's link is inactive and works again after the unsuspend", async () => {
    const a = await owner("sl-susp");
    const { token } = await linkFor(a);
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    expect(await load(token)).toEqual({ kind: "inactive" });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", a.userId);
    expect((await load(token)).kind).toBe("active");
  });

  it("a token for page A never draws page B, and a token of one account does nothing for another", async () => {
    const a = await owner("sl-pa", "Page A Name");
    const b = await owner("sl-pb", "Page B Name");
    const linkA = await linkFor(a);
    const linkB = await linkFor(b);
    const resultA = await load(linkA.token);
    const resultB = await load(linkB.token);
    expect(resultA.kind === "active" && resultA.doc.profile.name).toBe("Page A Name");
    expect(resultB.kind === "active" && resultB.doc.profile.name).toBe("Page B Name");
    expect(resultA.kind === "active" && resultA.pageId).toBe(a.pageId);
    // One character off is a different token: nothing.
    const flipped = `${linkA.token.slice(0, 42)}${linkA.token.endsWith("A") ? "B" : "A"}`;
    expect(await load(flipped)).toEqual({ kind: "inactive" });
    // The hash is not the token: using a stored hash as a token finds nothing either.
    const stored = await admin
      .from("preview_links")
      .select("token_hash")
      .eq("id", linkA.id)
      .single();
    expect(await load(stored.data!.token_hash)).toEqual({ kind: "inactive" });
  });

  it("the draft's own theme is used when it is a system theme or the owner's, and not when it is someone else's", async () => {
    const a = await owner("sl-theme");
    const other = await owner("sl-theme-o");
    const mine = await admin
      .from("themes")
      .insert({ owner_id: a.userId, name: "Mine", tokens: { bg: "#123456" } })
      .select("id")
      .single();
    const theirs = await admin
      .from("themes")
      .insert({ owner_id: other.userId, name: "Theirs", tokens: { bg: "#654321" } })
      .select("id")
      .single();
    expect(mine.error).toBeNull();
    expect(theirs.error).toBeNull();
    const { token } = await linkFor(a);

    const useTheme = async (ref: string) =>
      admin
        .from("pages")
        .update({ draft: { ...draftOf("Themed"), theme: { ref, overrides: {} } } as never })
        .eq("id", a.pageId);

    await useTheme(mine.data!.id);
    const own = await load(token);
    expect(own.kind === "active" && own.doc.tokens.bg).toBe("#123456");

    await useTheme(theirs.data!.id);
    const foreign = await load(token);
    expect(foreign.kind === "active" && foreign.doc.tokens.bg).not.toBe("#654321");

    await useTheme("00000000-0000-4000-8000-000000000001"); // Noir, a system theme
    const system = await load(token);
    expect(system.kind).toBe("active");
    expect(system.kind === "active" && system.doc.tokens.bg).not.toBe("#654321");
  });

  it("selects named columns only, and nothing of the owner's account but the plan and the suspension state", async () => {
    const a = await owner("sl-cols");
    const { token } = await linkFor(a);
    const selects: string[] = [];
    const spy = new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "from") return Reflect.get(target, prop, receiver);
        return (table: string) => {
          const builder = target.from(table);
          return new Proxy(builder, {
            get(inner, key, innerReceiver) {
              const value = Reflect.get(inner, key, innerReceiver);
              if (key !== "select" || typeof value !== "function") return value;
              return (columns?: string, ...rest: unknown[]) => {
                selects.push(`${table}: ${columns ?? "*"}`);
                return (value as (...args: unknown[]) => unknown).call(inner, columns, ...rest);
              };
            },
          });
        };
      },
    });
    const result = await shared.loadSharedPreview(spy as never, token);
    expect(result.kind).toBe("active");
    expect(selects.length).toBeGreaterThan(0);
    for (const line of selects) {
      expect(line).not.toMatch(/\*/);
      expect(line).not.toMatch(/\bemail\b|stripe|customer/i);
    }
    const links = selects.find((line) => line.startsWith("preview_links"))!;
    expect(links).toContain("accounts!inner(plan, suspended_at)");
    expect(links).not.toContain("token_hash");
  });

  it("a database error is thrown (a 500), never read as an inactive link", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
        }),
      }),
    };
    await expect(shared.loadSharedPreview(broken as never, "A".repeat(43))).rejects.toThrow(
      /Loading a shared preview failed/,
    );
  });
});
