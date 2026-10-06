import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => {
    throw new Error("the unit test must pass its own client");
  },
}));

const { cleanupOwnerMedia, isOwnedMediaPath, CLEANUP_QUEUE_LIMIT } =
  await import("@/lib/media/cleanup");
const { adminCleanupDeps, cleanupMediaFor, cleanupMediaQuietly, unqueueMediaPath } =
  await import("@/lib/media/cleanup-admin");

const A = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const B = "00000000-0000-4000-8000-0000000000b2";
const path = (owner: string, name: string) => `${owner}/${name}.webp`;
const P1 = path(A, "avatar-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const P2 = path(A, "img-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const P3 = path(A, "bg-cccccccccccccccccccccccccccccccc");
const B1 = path(B, "img-dddddddddddddddddddddddddddddddd");

/**
 * M5-14: the cleanup rules, on an in-memory world that behaves like the database and Storage: a
 * queue the triggers fill, `inUse` that looks at the owner's own drafts, published documents and
 * saved themes, and a bucket. The SQL that does the real queueing and the real reference check is
 * supabase/tests/database/102-media.test.sql; the whole chain with real Storage is
 * tests/e2e/m5/images-cleanup.spec.ts.
 */
class World {
  /** Storage objects. */
  objects = new Set<string>();
  queue = new Map<string, Set<string>>(); // owner -> queued paths
  /** Documents: their text is what the reference check searches. */
  docs: { owner: string; kind: "draft" | "published" | "theme"; text: string }[] = [];
  removeFails = false;
  inUseFails = false;
  removed: string[][] = [];
  inUseCalls: string[][] = [];

  queued(owner: string): Set<string> {
    let set = this.queue.get(owner);
    if (!set) this.queue.set(owner, (set = new Set()));
    return set;
  }
  setDoc(owner: string, kind: "draft" | "published" | "theme", text: string) {
    this.docs = this.docs.filter((d) => !(d.owner === owner && d.kind === kind));
    this.docs.push({ owner, kind, text });
  }

  deps = {
    listQueue: async (owner: string, limit: number) => [...this.queued(owner)].slice(0, limit),
    inUse: async (owner: string, paths: string[]) => {
      this.inUseCalls.push(paths);
      if (this.inUseFails) throw new Error("db down");
      return paths.filter((p) => this.docs.some((d) => d.owner === owner && d.text.includes(p)));
    },
    remove: async (paths: string[]) => {
      if (this.removeFails) throw new Error("storage down");
      this.removed.push(paths);
      for (const p of paths) this.objects.delete(p);
    },
    dequeue: async (owner: string, paths: string[]) => {
      for (const p of paths) this.queued(owner).delete(p);
    },
    requeue: async (owner: string, paths: string[]) => {
      for (const p of paths) {
        this.queued(owner).delete(p);
        this.queued(owner).add(p);
      }
    },
  };
}

let world: World;
beforeEach(() => {
  world = new World();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("M5-14 isOwnedMediaPath: ownership is the uid prefix of the path", () => {
  it.each([
    [P1, true],
    [P2, true],
    [`${A}/old-photo-1234.jpg`, true],
    [`${A}/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.png`, true],
    [B1, false], // another owner's folder
    [`${A}/../${B}/img-dddddddd.webp`, false],
    [`${A}/sub/img-aaaaaaaa.webp`, false], // deeper than the flat folder
    [`${A}//img-aaaaaaaa.webp`, false],
    [`${A}/IMG-AAAAAAAA.webp`, false], // upper case never matches the reference pattern
    [`${A}/img-aaaaaaaa.gif`, false],
    [`${A}/img-aaa.webp`, false], // name too short (7 characters)
    [`${A.toUpperCase()}/img-aaaaaaaa.webp`, false],
    [`${A}/img-aaaaaaaa.webp/`, false],
    [`${A}`, false],
    [`${A}/`, false],
    ["", false],
    ["/etc/passwd", false],
    [`${A}/%2e%2e/x.webp`, false],
    [`${A}\\img-aaaaaaaa.webp`, false],
  ])("%j -> %s", (candidate, owned) => {
    expect(isOwnedMediaPath(A, candidate)).toBe(owned);
  });
});

describe("M5-14 cleanupOwnerMedia: the three acceptance paths", () => {
  it("a draft-only reference that was removed is deleted now", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1); // the trigger queued it when the draft dropped it
    world.setDoc(A, "draft", JSON.stringify({ profile: { photo: null } }));

    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result).toEqual({ deleted: [P1], kept: [], discarded: [] });
    expect(world.objects.has(P1)).toBe(false);
    expect(world.queued(A).size).toBe(0);
  });

  it("a reference the published document still holds survives; the first run after the Publish that drops it deletes it", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1);
    world.setDoc(A, "draft", JSON.stringify({ profile: { photo: null } }));
    world.setDoc(A, "published", JSON.stringify({ profile: { photo: { path: P1 } } }));

    // After the draft save: the live page needs it.
    const first = await cleanupOwnerMedia(A, world.deps);
    expect(first).toEqual({ deleted: [], kept: [P1], discarded: [] });
    expect(world.objects.has(P1)).toBe(true);
    expect(world.queued(A).has(P1)).toBe(true); // still queued for the Publish that drops it
    expect(world.removed).toEqual([]);

    // The Publish: the published document no longer names it; the Publish action runs the cleanup.
    world.setDoc(A, "published", JSON.stringify({ profile: { photo: null } }));
    const second = await cleanupOwnerMedia(A, world.deps);
    expect(second).toEqual({ deleted: [P1], kept: [], discarded: [] });
    expect(world.objects.has(P1)).toBe(false);
    expect(world.queued(A).size).toBe(0);
  });

  it("an object referenced by both draft and published stays", async () => {
    world.objects.add(P2);
    world.queued(A).add(P2);
    world.setDoc(A, "draft", JSON.stringify({ blocks: [{ image: { path: P2 } }] }));
    world.setDoc(A, "published", JSON.stringify({ blocks: [{ image: { path: P2 } }] }));
    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([P2]);
    expect(world.objects.has(P2)).toBe(true);
    expect(world.removed).toEqual([]);
  });

  it("an object only the draft references stays (the image was put back, the trigger missed nothing)", async () => {
    world.objects.add(P2);
    world.queued(A).add(P2);
    world.setDoc(A, "draft", JSON.stringify({ blocks: [{ image: { path: P2 } }] }));
    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result.deleted).toEqual([]);
    expect(world.objects.has(P2)).toBe(true);
  });
});

describe("M5-14 cleanup never deletes an image any draft, published page or theme still uses", () => {
  it("a second page of the same owner keeps it alive", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1);
    world.setDoc(A, "draft", "{}");
    world.docs.push({ owner: A, kind: "draft", text: JSON.stringify({ photo: P1 }) }); // page two
    expect((await cleanupOwnerMedia(A, world.deps)).deleted).toEqual([]);
    expect(world.objects.has(P1)).toBe(true);
  });

  it("a saved theme's background keeps it alive (the bgImage URL contains the path)", async () => {
    world.objects.add(P3);
    world.queued(A).add(P3);
    world.setDoc(
      A,
      "theme",
      JSON.stringify({
        bgImage: `http://127.0.0.1:54321/storage/v1/object/public/page-media/${P3}`,
      }),
    );
    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result.kept).toEqual([P3]);
    expect(world.objects.has(P3)).toBe(true);
  });

  it("a draft background override keeps it alive", async () => {
    world.objects.add(P3);
    world.queued(A).add(P3);
    world.setDoc(
      A,
      "draft",
      JSON.stringify({
        theme: { overrides: { bgImage: `http://x/storage/v1/object/public/page-media/${P3}` } },
      }),
    );
    expect((await cleanupOwnerMedia(A, world.deps)).deleted).toEqual([]);
  });

  it("deletes the unused ones and keeps the used ones in the same run", async () => {
    for (const p of [P1, P2, P3]) {
      world.objects.add(p);
      world.queued(A).add(p);
    }
    world.setDoc(A, "draft", JSON.stringify({ photo: P2 }));
    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result.deleted.sort()).toEqual([P1, P3].sort());
    expect(result.kept).toEqual([P2]);
    expect([...world.objects]).toEqual([P2]);
    expect([...world.queued(A)]).toEqual([P2]);
  });

  it("another account referencing the path does not keep it alive, and the owner's reference does", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1);
    world.setDoc(B, "draft", JSON.stringify({ photo: P1 })); // B names A's object: not A's reference
    expect((await cleanupOwnerMedia(A, world.deps)).deleted).toEqual([P1]);
  });
});

describe("M5-14 another user's objects are never touched", () => {
  it("a queue row naming another owner's object (or a path that climbs out) is discarded and never reaches Storage", async () => {
    world.objects.add(B1);
    const planted = [
      B1,
      `${A}/../${B}/img-dddddddddddddddd.webp`,
      "../../../etc/passwd",
      `${A}/sub/x.webp`,
      `${B}/avatar-eeeeeeeeeeeeeeee.webp`,
    ];
    for (const p of planted) world.queued(A).add(p);
    world.queued(A).add(P1);
    world.objects.add(P1);

    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result.deleted).toEqual([P1]);
    expect(result.discarded.sort()).toEqual([...planted].sort());
    // Storage saw exactly one remove call, with only A's own object.
    expect(world.removed).toEqual([[P1]]);
    expect(world.objects.has(B1)).toBe(true);
    expect(world.queued(A).size).toBe(0); // the planted rows are gone too
  });

  it("running for A never reads, removes or dequeues B's rows", async () => {
    world.objects.add(B1);
    world.queued(B).add(B1);
    world.objects.add(P1);
    world.queued(A).add(P1);
    await cleanupOwnerMedia(A, world.deps);
    expect(world.objects.has(B1)).toBe(true);
    expect(world.queued(B).has(B1)).toBe(true);
  });

  it("only ever sends paths that start with the owner's folder to remove", async () => {
    for (let i = 0; i < 30; i++) {
      const p = path(A, `img-${i.toString(16).padStart(32, "0")}`);
      world.objects.add(p);
      world.queued(A).add(p);
    }
    world.queued(A).add(B1);
    await cleanupOwnerMedia(A, world.deps);
    for (const call of world.removed) {
      for (const p of call) expect(p.startsWith(`${A}/`)).toBe(true);
    }
  });
});

describe("M5-14 cleanup is cheap and safe to run at any time", () => {
  it("an empty queue costs one read: no reference check, no Storage call", async () => {
    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result).toEqual({ deleted: [], kept: [], discarded: [] });
    expect(world.inUseCalls).toEqual([]);
    expect(world.removed).toEqual([]);
  });

  it("running twice is harmless: the second run finds nothing", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1);
    await cleanupOwnerMedia(A, world.deps);
    const again = await cleanupOwnerMedia(A, world.deps);
    expect(again).toEqual({ deleted: [], kept: [], discarded: [] });
  });

  it("a Storage failure throws and leaves every row queued, so the next run retries", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1);
    world.removeFails = true;
    await expect(cleanupOwnerMedia(A, world.deps)).rejects.toThrow("storage down");
    expect(world.queued(A).has(P1)).toBe(true);
    expect(world.objects.has(P1)).toBe(true);
    world.removeFails = false;
    expect((await cleanupOwnerMedia(A, world.deps)).deleted).toEqual([P1]);
  });

  it("a failing reference check removes nothing (it fails closed)", async () => {
    world.objects.add(P1);
    world.queued(A).add(P1);
    world.inUseFails = true;
    await expect(cleanupOwnerMedia(A, world.deps)).rejects.toThrow("db down");
    expect(world.removed).toEqual([]);
    expect(world.objects.has(P1)).toBe(true);
  });

  it("works on at most 25 queued paths per run (Wave M1 review); the rest wait for the next run", async () => {
    for (let i = 0; i < 60; i++) {
      const p = path(A, `img-${i.toString(16).padStart(32, "0")}`);
      world.objects.add(p);
      world.queued(A).add(p);
    }
    const result = await cleanupOwnerMedia(A, world.deps);
    expect(result.deleted).toHaveLength(25);
    expect(world.inUseCalls.map((c) => c.length)).toEqual([25]);
    expect(world.removed.map((c) => c.length)).toEqual([25]);
    expect(world.objects.size).toBe(35);
    expect(world.queued(A).size).toBe(35);
    await cleanupOwnerMedia(A, world.deps);
    await cleanupOwnerMedia(A, world.deps);
    expect(world.objects.size).toBe(0);
  });

  it("reads at most CLEANUP_QUEUE_LIMIT rows per run", async () => {
    const listQueue = vi.fn(async () => []);
    await cleanupOwnerMedia(A, { ...world.deps, listQueue });
    expect(listQueue).toHaveBeenCalledWith(A, CLEANUP_QUEUE_LIMIT);
    expect(CLEANUP_QUEUE_LIMIT).toBe(25);
  });

  it("images a page still uses go to the back of the queue, so they cannot fill the batch for good", async () => {
    const kept: string[] = [];
    for (let i = 0; i < 25; i++) {
      const p = path(A, `keep-${i.toString(16).padStart(32, "0")}`);
      kept.push(p);
      world.queued(A).add(p);
    }
    world.setDoc(A, "draft", kept.join(" "));
    world.objects.add(P1);
    world.queued(A).add(P1); // behind 25 kept paths
    expect((await cleanupOwnerMedia(A, world.deps)).deleted).toEqual([]);
    expect((await cleanupOwnerMedia(A, world.deps)).deleted).toEqual([P1]);
  });

  it("duplicate queue rows are handled once", async () => {
    world.objects.add(P1);
    const result = await cleanupOwnerMedia(A, {
      ...world.deps,
      listQueue: async () => [P1, P1, P1],
    });
    expect(result.deleted).toEqual([P1]);
    expect(world.removed).toEqual([[P1]]);
  });
});

describe("M5-14 the real dependencies (secret key, server-only tables and function)", () => {
  /** A stub of the slice of supabase-js the cleanup uses, recording every call. */
  function stubClient(opts: { queue?: string[]; used?: string[]; removeError?: string } = {}) {
    const calls: { op: string; args: unknown }[] = [];
    const client = {
      from(table: string) {
        const state: Record<string, unknown> = { table };
        const chain = {
          select: (cols: string) => ((state.select = cols), chain),
          delete: () => ((state.delete = true), chain),
          upsert: () => ((state.upsert = true), chain),
          eq: (col: string, value: unknown) => (
            (((state.eq ??= {}) as Record<string, unknown>)[col] = value),
            chain
          ),
          in: (col: string, values: unknown) => ((state.in = { col, values }), chain),
          order: (col: string, o: unknown) => ((state.order = { col, o }), chain),
          limit: async (n: number) => {
            calls.push({ op: "list", args: { ...state, limit: n } });
            return { data: (opts.queue ?? []).map((path) => ({ path })), error: null };
          },
          then: (resolve: (v: unknown) => unknown) => {
            calls.push({
              op: state.delete ? "delete" : state.upsert ? "upsert" : "query",
              args: { ...state },
            });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return chain;
      },
      rpc: async (fn: string, args: unknown) => {
        calls.push({ op: "rpc", args: { fn, ...(args as object) } });
        return { data: opts.used ?? [], error: null };
      },
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            calls.push({ op: "remove", args: { bucket, paths } });
            return { data: [], error: opts.removeError ? { message: opts.removeError } : null };
          },
        }),
      },
    };
    return { client: client as never, calls };
  }

  it("reads the owner's queue oldest first, asks media_paths_in_use, removes through the Storage API of page-media, and dequeues by owner and path", async () => {
    const { client, calls } = stubClient({ queue: [P1, P2], used: [P2] });
    const result = await cleanupMediaFor(A, client);
    expect(result.deleted).toEqual([P1]);
    expect(result.kept).toEqual([P2]);
    expect(calls.find((c) => c.op === "list")?.args).toMatchObject({
      table: "image_cleanup_queue",
      eq: { owner_id: A },
      order: { col: "queued_at", o: { ascending: true } },
      limit: 25,
    });
    expect(calls.find((c) => c.op === "rpc")?.args).toEqual({
      fn: "media_paths_in_use",
      p_uid: A,
      p_paths: [P1, P2],
    });
    expect(calls.find((c) => c.op === "remove")?.args).toEqual({
      bucket: "page-media",
      paths: [P1],
    });
    // The kept path is re-queued in one RPC (no delete and insert pair); the removed one is dequeued.
    expect(calls.filter((c) => c.op === "rpc").map((c) => (c.args as { fn: string }).fn)).toEqual([
      "media_paths_in_use",
      "requeue_media",
    ]);
    expect(calls.find((c) => (c.args as { fn?: string }).fn === "requeue_media")?.args).toEqual({
      fn: "requeue_media",
      p_owner: A,
      p_paths: [P2],
    });
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(1);
    expect(calls.find((c) => c.op === "delete")?.args).toMatchObject({
      table: "image_cleanup_queue",
      eq: { owner_id: A },
      in: { col: "path", values: [P1] },
    });
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("a Storage error is thrown (nothing dequeued); cleanupMediaQuietly logs it and returns null", async () => {
    const { client, calls } = stubClient({ queue: [P1], removeError: "boom" });
    await expect(cleanupMediaFor(A, client)).rejects.toThrow("Removing media failed: boom");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
    expect(await cleanupMediaQuietly(A, client)).toBeNull();
  });

  it("adminCleanupDeps.remove of nothing makes no Storage call", async () => {
    const { client, calls } = stubClient();
    await adminCleanupDeps(client).remove([]);
    await adminCleanupDeps(client).dequeue(A, []);
    expect(calls).toEqual([]);
  });

  it("unqueueMediaPath deletes one row of the owner, and ignores a path that is not the owner's", async () => {
    const { client, calls } = stubClient();
    await unqueueMediaPath(A, P1, client);
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(1);
    expect(calls[0]!.args).toMatchObject({
      table: "image_cleanup_queue",
      eq: { owner_id: A, path: P1 },
    });
    calls.length = 0;
    await unqueueMediaPath(A, B1, client);
    await unqueueMediaPath(A, `${A}/../x`, client);
    expect(calls).toEqual([]);
  });
});
