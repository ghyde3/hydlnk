import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as actionsModule from "@/lib/admin/actions";
import { ADMIN_ACTIONS } from "@/lib/admin/actions";
import { executeAdminAction } from "@/lib/admin/execute";
import { ANONYMOUS, type Principal } from "@/lib/admin/principal";
import type { AdminAction, AdminDeps } from "@/lib/admin/types";

/**
 * M5-04: every admin mutation goes through one guard. The registry (ADMIN_ACTIONS) lists every
 * action; this suite calls each one as nobody and as a signed-in non-admin and expects 401 and 403
 * with no database client built and no write, then reads the source to prove an action added later
 * without the guard (not in the registry, not behind `adminRoute`, or called from anywhere else)
 * fails here.
 */

const ROOT = process.cwd();
const NON_ADMIN: Principal = {
  kind: "user",
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  email: "n@x.test",
  admin: false,
};
const ADMIN: Principal = {
  kind: "user",
  id: "11111111-2222-4333-8444-555555555555",
  email: "a@x.test",
  admin: true,
};
const TARGET = "00000000-0000-4000-8000-0000000000aa";

/** A deps factory that must never be called, and a database that records any touch. */
function untouchedDeps() {
  const touched: string[] = [];
  const db = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(String(property));
        throw new Error(`the database was touched (${String(property)})`);
      },
    },
  );
  const makeDeps = vi.fn((): AdminDeps => ({
    db: db as never,
    invalidateAccount: vi.fn(async () => 0),
    invalidateHandles: vi.fn(),
    isProtectedAccount: vi.fn(async () => false),
    now: () => new Date(),
  }));
  return { makeDeps, touched };
}

/**
 * An input each action accepts as valid (it reaches the database): the id of the thing acted on, or
 * for the blocked-links actions (M7-12) the domain, and the reason when there is one.
 */
const validInput = (action: AdminAction): unknown =>
  action.name === "add_reserved_handle"
    ? { handle: "nobrand", reason: "test" }
    : action.name === "remove_reserved_handle"
      ? { handle: "nobrand" }
      : action.name === "set_announcement"
        ? { message: "Hello", ends_at: "2099-01-01T00:00:00Z" }
        : action.name === "block_app"
          ? { client_id: "hlc_" + "a".repeat(32), reason: "abuse" }
          : action.name === "unblock_app"
            ? { client_id: "hlc_" + "a".repeat(32) }
            : action.name === "block_domain"
              ? { domain: "example.test", reason: "spam" }
              : action.name === "unblock_domain"
                ? { domain: "example.test" }
                : action.name === "gift_plan"
                  ? { id: TARGET, plan: "pro", until: null, reason: "support" }
                  : { id: TARGET };

describe("M5-04 the registry", () => {
  it("lists the admin mutations, with unique names", () => {
    const names = ADMIN_ACTIONS.map((action) => action.name);
    expect(names.sort()).toEqual([
      "add_reserved_handle",
      "block_app",
      "block_domain",
      "clear_announcement",
      "dismiss_report",
      "end_gift",
      "gift_plan",
      "recheck_domain",
      "remove_reserved_handle",
      "review_traffic_flag",
      "set_announcement",
      "suspend_account",
      "unblock_app",
      "unblock_domain",
      "unsuspend_account",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(ADMIN_ACTIONS.map((action) => [action.name, action] as const))(
    "%s: nobody signed in gets 401 and no database is built or touched",
    async (_name, action) => {
      const { makeDeps, touched } = untouchedDeps();
      for (const input of [
        { id: TARGET },
        validInput(action),
        { domain: "example.test", reason: "spam" },
        {},
        null,
        "x",
        { id: ["a"] },
      ]) {
        const result = await executeAdminAction(action, ANONYMOUS, input, makeDeps);
        expect(result).toMatchObject({ ok: false, status: 401, error: "unauthenticated" });
      }
      expect(makeDeps).not.toHaveBeenCalled();
      expect(touched).toEqual([]);
    },
  );

  it.each(ADMIN_ACTIONS.map((action) => [action.name, action] as const))(
    "%s: a signed-in non-admin gets 403 and no database is built or touched",
    async (_name, action) => {
      const { makeDeps, touched } = untouchedDeps();
      for (const input of [
        { id: TARGET },
        { id: NON_ADMIN.id },
        validInput(action),
        { domain: "example.test", reason: "spam" },
        {},
        null,
        "x",
        { id: ["a"], admin: true },
      ]) {
        const result = await executeAdminAction(action, NON_ADMIN, input, makeDeps);
        expect(result).toMatchObject({ ok: false, status: 403, error: "forbidden" });
      }
      expect(makeDeps).not.toHaveBeenCalled();
      expect(touched).toEqual([]);
    },
  );

  it.each(ADMIN_ACTIONS.map((action) => [action.name, action] as const))(
    "%s: an admin gets past the guard (the database is built) and a bad input is a 400, not a crash",
    async (_name, action) => {
      const { makeDeps } = untouchedDeps();
      for (const input of [{}, null, "x", { id: "not-a-uuid" }, { id: 5 }, { id: ["a"] }]) {
        const result = await executeAdminAction(action, ADMIN, input, makeDeps);
        expect(result).toMatchObject({ ok: false, status: 400, error: "invalid_input" });
      }
      // A valid input reaches the database, which here throws: the guard answers 500 and leaks nothing.
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = await executeAdminAction(action, ADMIN, validInput(action), makeDeps);
      spy.mockRestore();
      expect(makeDeps).toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, status: 500, error: "action_failed" });
      expect(JSON.stringify(result)).not.toContain("touched");
    },
  );

  it("a fake action registered by someone else is guarded the same way (the guard is not per action)", async () => {
    const run = vi.fn(async () => ({ ok: true as const, status: 200 as const, data: {} }));
    const fake: AdminAction = { name: "fake", run };
    const { makeDeps } = untouchedDeps();
    expect((await executeAdminAction(fake, NON_ADMIN, {}, makeDeps)).ok).toBe(false);
    expect((await executeAdminAction(fake, ANONYMOUS, {}, makeDeps)).ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const SRC = sourceFiles(resolve(ROOT, "src"));
const rel = (file: string) => relative(ROOT, file);
const read = (file: string) => readFileSync(file, "utf8");

describe("M5-04 nothing can add an unguarded admin mutation", () => {
  it("every action exported from actions.ts is in the registry", () => {
    const exported = Object.entries(actionsModule).filter(
      ([, value]) =>
        typeof value === "object" && value !== null && "run" in value && "name" in value,
    );
    expect(exported.length).toBeGreaterThanOrEqual(4);
    for (const [exportName, value] of exported) {
      expect(ADMIN_ACTIONS, `${exportName} is exported but not in ADMIN_ACTIONS`).toContain(value);
    }
  });

  it("every file under api/admin is exactly `export const POST = adminRoute(<registered action>)`", () => {
    const routes = SRC.filter((file) => /src\/app\/.*\/api\/admin\/.*route\.ts$/.test(file));
    expect(routes.length).toBe(ADMIN_ACTIONS.length);
    const used: string[] = [];
    for (const file of routes) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      const exports = [
        ...code.matchAll(/^export\s+(?:const|function|async function|let|var)\s+(\w+)/gm),
      ].map((m) => m[1]);
      expect(exports.sort(), rel(file)).toEqual(["POST", "dynamic"]);
      const match = /export const POST = adminRoute\((\w+)\);/.exec(code);
      expect(
        match,
        `${rel(file)} must be \`export const POST = adminRoute(<action>)\``,
      ).not.toBeNull();
      const exportName = match![1]!;
      expect(code, rel(file)).toMatch(/from "@\/lib\/admin\/actions"/);
      const action = (actionsModule as Record<string, unknown>)[exportName] as
        AdminAction | undefined;
      expect(action, `${exportName} is not exported by actions.ts`).toBeDefined();
      expect(ADMIN_ACTIONS).toContain(action);
      used.push(action!.name);
    }
    // One route per action: none is unreachable and none is reachable twice.
    expect(used.sort()).toEqual(ADMIN_ACTIONS.map((a) => a.name).sort());
  });

  it("only the admin routes and the admin library import the actions, deps, execute and route modules", () => {
    const FORBIDDEN_IMPORT =
      /from\s+["']@\/lib\/admin\/(actions|deps|execute|route)["']|from\s+["'](?:\.\.?\/)+(?:lib\/)?admin\/(actions|deps|execute|route)["']/;
    for (const file of SRC) {
      const path = rel(file);
      const allowed =
        path.startsWith("src/lib/admin/") || /^src\/app\/.*\/api\/admin\/.*route\.ts$/.test(path);
      if (allowed) continue;
      expect(FORBIDDEN_IMPORT.test(read(file)), `${path} imports an admin mutation module`).toBe(
        false,
      );
    }
  });

  it("no 'use server' module touches the admin actions or the admin database client", () => {
    for (const file of SRC) {
      const source = read(file);
      if (!/^\s*["']use server["']/m.test(source)) continue;
      expect(
        /lib\/admin\/(actions|deps|execute)/.test(source),
        `${rel(file)} (a Server Action file)`,
      ).toBe(false);
    }
  });

  it("the guard runs before the input is read or the database client is built", () => {
    const execute = read(resolve(ROOT, "src/lib/admin/execute.ts"));
    const deny = execute.indexOf("denyUnlessAdmin(principal)");
    const deps = execute.indexOf("makeDeps()");
    expect(deny).toBeGreaterThan(-1);
    expect(deps).toBeGreaterThan(deny);

    const route = read(resolve(ROOT, "src/lib/admin/route.ts"));
    const denied = route.indexOf("denyUnlessAdmin(principal)");
    const body = route.indexOf("request.json()");
    expect(denied).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(denied);
    expect(route).toContain("executeAdminAction(");
  });
});
