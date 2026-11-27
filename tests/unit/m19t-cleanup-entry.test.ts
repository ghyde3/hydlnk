// @vitest-environment node
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makePng } from "../e2e/m2/publish-helpers";
import { rand, removeOwners, stackIsUp } from "./publish-support";
import { fixtureUsers, teamFixture, type TeamFixture } from "./m19t-team-support";
import { calleeName, calls, parse, readSource, sourceFiles, unwrap } from "./ts-scan";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * Team access security re-review, finding 1 (M19-05, M19-06): a member's Publish (and a scheduled one)
 * still worked the OWNER's whole media queue, because the publish step took a bare owner id. Now there
 * is ONE cleanup entry point (`cleanupMediaFor` in src/lib/media/cleanup-admin.ts, and its quiet form):
 * it takes who is acting on which owner's site and derives the scope itself (`cleanupScopeFor`). The
 * owner's runs work the whole queue, a member's and a schedule's only the site's rows, and EVERY run
 * only rows queued more than the Undo window ago (an owner's run can no longer delete what a member
 * dropped a moment ago). This file holds the rule (units), the reviewer's race end to end (local
 * Supabase, the real Publish action), and a static scan that every cleanup call goes through the one
 * entry point.
 */
const m = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => m.user }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: vi.fn() }));

// The env first (the admin module reads it on import); the stack part is skipped when it is down.
const { run } = await stackIsUp();
const { cleanupScopeFor } = await import("@/lib/media/cleanup");
const { cleanupMediaFor } = await import("@/lib/media/cleanup-admin");
const { UNDO_WINDOW_MS } = await import("@/lib/media/cleanup-client");

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000a9";
const SITE = "00000000-0000-4000-8000-0000000000b1";
const NOW = new Date("2026-11-27T12:00:00.000Z");
const CUTOFF = new Date(NOW.getTime() - UNDO_WINDOW_MS);

describe("finding 1: the scope is derived from who acts, and every run waits out the Undo window", () => {
  it("the owner: the whole queue, past the Undo window (with or without a site)", () => {
    expect(cleanupScopeFor({ actorId: OWNER, ownerId: OWNER, siteId: null }, NOW)).toEqual({ siteId: null, before: CUTOFF });
    expect(cleanupScopeFor({ actorId: OWNER, ownerId: OWNER, siteId: SITE }, NOW)).toEqual({ siteId: null, before: CUTOFF });
  });

  it("a member: only the site's rows, past the Undo window; with no site, nothing", () => {
    expect(cleanupScopeFor({ actorId: MEMBER, ownerId: OWNER, siteId: SITE }, NOW)).toEqual({ siteId: SITE, before: CUTOFF });
    expect(cleanupScopeFor({ actorId: MEMBER, ownerId: OWNER, siteId: null }, NOW)).toBeNull();
  });

  it("a scheduled publish (the system): only the fired site's rows, past the Undo window", () => {
    expect(cleanupScopeFor({ actorId: null, ownerId: OWNER, siteId: SITE }, NOW)).toEqual({ siteId: SITE, before: CUTOFF });
    expect(cleanupScopeFor({ actorId: null, ownerId: OWNER, siteId: null }, NOW)).toBeNull();
  });

  /** A client that records the queue read and answers an empty queue. */
  function queueReader() {
    const seen: { eq: Record<string, unknown>; lte?: unknown } = { eq: {} };
    const chain = {
      select: () => chain,
      eq: (col: string, value: unknown) => ((seen.eq[col] = value), chain),
      lte: (_col: string, value: unknown) => ((seen.lte = value), chain),
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
    };
    return { client: { from: () => chain } as unknown as SupabaseClient, seen };
  }

  it("cleanupMediaFor reads the queue with the derived scope: the owner's has the cutoff and no site filter", async () => {
    const { client, seen } = queueReader();
    await cleanupMediaFor({ actorId: OWNER, ownerId: OWNER, siteId: SITE }, { admin: client, now: NOW });
    expect(seen.eq).toEqual({ owner_id: OWNER });
    expect(seen.lte).toBe(CUTOFF.toISOString());
  });

  it("cleanupMediaFor: a member's and a schedule's run reads only the site's rows, with the cutoff", async () => {
    for (const actorId of [MEMBER, null]) {
      const { client, seen } = queueReader();
      await cleanupMediaFor({ actorId, ownerId: OWNER, siteId: SITE }, { admin: client, now: NOW });
      expect(seen.eq).toEqual({ owner_id: OWNER, site_id: SITE });
      expect(seen.lte).toBe(CUTOFF.toISOString());
    }
  });

  it("cleanupMediaFor: a member with no site reads nothing at all", async () => {
    const { client, seen } = queueReader();
    expect(await cleanupMediaFor({ actorId: MEMBER, ownerId: OWNER, siteId: null }, { admin: client, now: NOW })).toEqual({
      deleted: [],
      kept: [],
      discarded: [],
    });
    expect(seen).toEqual({ eq: {} });
  });
});

/** The scan: every cleanup call in `files` goes through the one entry point, with an access, never `now`. */
const INTERNALS = new Set(["cleanupOwnerMedia", "cleanupScopeFor", "adminCleanupDeps"]);
const ENTRY = new Set(["cleanupMediaFor", "cleanupMediaQuietly"]);
const CLEANUP_MODULES = new Set(["src/lib/media/cleanup.ts", "src/lib/media/cleanup-admin.ts"]);

function bypasses(files: readonly string[], text: (file: string) => string): string[] {
  const found: string[] = [];
  for (const file of files) {
    if (CLEANUP_MODULES.has(file)) continue;
    const sf = parse(file, text(file));
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && INTERNALS.has(node.text)) found.push(`${file}: uses ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const call of calls(sf)) {
      const name = calleeName(call);
      if (!name || !ENTRY.has(name)) continue;
      const [first, options] = call.arguments;
      // The access, never an id: a string, or a name that reads as an id, is a bare owner id.
      const arg = first ? unwrap(first) : undefined;
      if (!arg || ts.isStringLiteralLike(arg) || /(^id$|Id$)/.test(arg.getText(sf).split(".").pop() ?? "")) {
        found.push(`${file}: ${name} with ${first?.getText(sf) ?? "nothing"}`);
      }
      if (options && ts.isObjectLiteralExpression(options) && options.properties.some((p) => p.name?.getText(sf) === "now")) {
        found.push(`${file}: ${name} passes now`);
      }
    }
  }
  return found;
}

describe("finding 1, static: one cleanup entry point", () => {
  it("no file outside the cleanup modules builds a scope or reaches the core; every call passes an access and never `now`", () => {
    expect(bypasses(sourceFiles(), readSource)).toEqual([]);
  });

  it("the entry point and its quiet form take a CleanupAccess, derive the scope, and the quiet form only wraps the entry point", () => {
    const file = "src/lib/media/cleanup-admin.ts";
    const sf = parse(file, readSource(file));
    const fns = new Map<string, ts.FunctionDeclaration>();
    sf.forEachChild((node) => {
      if (ts.isFunctionDeclaration(node) && node.name) fns.set(node.name.text, node);
    });
    const calledIn = (fn: ts.Node) => {
      const names: string[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) names.push(calleeName(n) ?? "");
        ts.forEachChild(n, visit);
      };
      visit(fn);
      return names;
    };
    for (const name of ENTRY) {
      expect(fns.get(name)?.parameters[0]?.type?.getText(sf), name).toBe("CleanupAccess");
    }
    expect(calledIn(fns.get("cleanupMediaFor")!)).toEqual(expect.arrayContaining(["cleanupScopeFor", "cleanupOwnerMedia"]));
    const quiet = calledIn(fns.get("cleanupMediaQuietly")!);
    expect(quiet).toContain("cleanupMediaFor");
    expect(quiet).not.toContain("cleanupOwnerMedia");
  });

  it("the scan catches each bypass form (a throwaway file)", () => {
    const forms = [
      `import { cleanupMediaQuietly } from "@/lib/media/cleanup-admin";\nexport const f = (ownerId: string) => cleanupMediaQuietly(ownerId as never);`,
      `import { cleanupMediaFor } from "@/lib/media/cleanup-admin";\nexport const f = (row: { ownerId: string }) => cleanupMediaFor(row.ownerId as never);`,
      `import { cleanupMediaFor } from "@/lib/media/cleanup-admin";\nexport const f = (a: never) => cleanupMediaFor(a, { now: new Date(0) });`,
      `import { cleanupOwnerMedia } from "@/lib/media/cleanup";\nexport const f = (o: string, d: never) => cleanupOwnerMedia(o, d);`,
      `import { cleanupScopeFor } from "@/lib/media/cleanup";\nexport const f = (a: never) => cleanupScopeFor(a);`,
    ];
    for (const source of forms) {
      expect(bypasses(["src/throwaway.ts"], () => source), source).not.toEqual([]);
    }
  });
});

describe.skipIf(!run)("finding 1: the reviewer's race, with the real Publish action (local Supabase)", () => {
  let admin: SupabaseClient;
  let f: TeamFixture;
  let publishPage: typeof import("@/lib/publish/actions").publishPage;
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    f = await teamFixture(admin, "m19ce");
    ({ publishPage } = await import("@/lib/publish/actions"));
  });
  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    if (f) await removeOwners(admin, fixtureUsers(f));
  });

  type Draft = { profile: Record<string, unknown> };
  /**
   * An image of the owner's folder, set as `siteId`'s profile photo in the draft and removed again (the
   * trigger queues it as that site's row; the design stays in `pages.draft` once a site's blocks moved
   * to its entries). `undo` puts the photo back, as the editor's Undo saves it.
   */
  const dropFrom = async (siteId: string) => {
    const path = `${f.owner.userId}/img-${rand(12)}.webp`;
    const stored = await admin.storage.from("page-media").upload(path, makePng(8, 8), { contentType: "image/webp" });
    expect(stored.error).toBeNull();
    objects.push(path);
    const row = await admin.from("pages").select("draft").eq("id", siteId).single();
    const draft = row.data!.draft as Draft;
    const withImage = { ...draft, profile: { ...draft.profile, photo: { path, width: 8, height: 8 } } };
    expect((await admin.from("pages").update({ draft: withImage }).eq("id", siteId)).error).toBeNull();
    expect((await admin.from("pages").update({ draft }).eq("id", siteId)).error).toBeNull();
    const undo = async () => {
      expect((await admin.from("pages").update({ draft: withImage }).eq("id", siteId)).error).toBeNull();
    };
    return { path, undo };
  };
  const exists = async (path: string) => (await admin.storage.from("page-media").exists(path)).data === true;
  const queued = async (path: string) =>
    ((await admin.from("image_cleanup_queue").select("path").eq("path", path)).data ?? []).length > 0;
  const publishAs = async (userId: string, siteId: string) => {
    m.user = { id: userId };
    expect(await publishPage(siteId)).toMatchObject({ ok: true });
  };

  it("the reviewer's race: the owner drops an image on S2, a publisher publishes S within the Undo window, and Undo still finds the image", async () => {
    const onS2 = await dropFrom(f.s2);
    expect(await queued(onS2.path)).toBe(true);
    await publishAs(f.publisher.userId, f.owner.pageId);
    expect(await exists(onS2.path)).toBe(true);
    await onS2.undo();
    expect(await exists(onS2.path)).toBe(true);
    expect(await queued(onS2.path)).toBe(false); // the draft names it again: nothing to clean up
  });

  it("the integrity note: an editor drops an image on S, the owner publishes S2 at once, and the editor's Undo still finds it", async () => {
    const onS = await dropFrom(f.owner.pageId);
    await publishAs(f.owner.userId, f.s2);
    expect(await exists(onS.path)).toBe(true);
    await onS.undo();
    expect(await exists(onS.path)).toBe(true);
  });

  it("past the Undo window the owner's run is still account-wide: an S2 row goes on the owner's run, not on a publisher's of S", async () => {
    const onS2 = await dropFrom(f.s2);
    const later = { admin, now: new Date(Date.now() + UNDO_WINDOW_MS + 1_000) };
    const site = { ownerId: f.owner.userId, siteId: f.owner.pageId };
    expect((await cleanupMediaFor({ ...site, actorId: f.publisher.userId }, later)).deleted).not.toContain(onS2.path);
    expect(await exists(onS2.path)).toBe(true);
    expect((await cleanupMediaFor({ ...site, actorId: f.owner.userId }, later)).deleted).toContain(onS2.path);
    expect(await exists(onS2.path)).toBe(false);
  });
});
