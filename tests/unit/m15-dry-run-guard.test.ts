import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  diffSnapshots,
  isLocalUrl,
  main,
  type DryRunDeps,
} from "../../scripts/content-move-dry-run";

/**
 * M15-05 (1b1-24): the content-move dry run. The script only ever talks to a local app and a local
 * database; two snapshots of the same state diff clean, and any byte or count that moved is named
 * by its site. These tests drive it with fake fetch and SQL functions, so nothing here needs a server.
 */

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";

const LOCAL_ENV = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  DRY_RUN_APP_URL: "http://localhost:3000",
};

interface Fakes {
  deps: DryRunDeps;
  fetch: ReturnType<typeof vi.fn>;
  sql: ReturnType<typeof vi.fn>;
}

function counts(site: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    livePages: [
      { id: site, path: "/", blocks: ["b2", "b1"] },
      { id: "p-" + site, path: "about", blocks: ["c1"] },
    ],
    clickPairs: [
      { block_id: "b1", sub_page_id: null },
      { block_id: "c1", sub_page_id: "p-" + site },
    ],
    navTargets: ["p-" + site],
    pageLinkTargets: [{ path: "/", target: "home" }],
    pageVersions: 3,
    accountSiteBytes: 1234,
    pageTotal: 2,
    pagesPerSite: 3,
    ...extra,
  });
}

function fakes(opts: {
  out: string;
  flipByte?: boolean;
  countsExtra?: Record<string, unknown>;
  violations?: string[];
}): Fakes {
  const fetch = vi.fn(async (req: { host: string; path: string }) => {
    let body = Buffer.from(`body of ${req.host}${req.path}`);
    if (opts.flipByte && req.host.startsWith("beta.") && req.path === "/") {
      body = Buffer.from(`body of ${req.host}${req.path}!`);
    }
    return { status: 200, contentType: "text/html", body };
  });
  const sql = vi.fn((text: string): string => {
    if (text.includes("-- sites")) {
      return JSON.stringify([
        { id: SITE_A, handle: "alpha", owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", plan: "free", domains: ["alpha.example.com"] },
        { id: SITE_B, handle: "beta", owner_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", plan: "pro", domains: [] },
      ]);
    }
    if (text.includes("-- mode")) return "entries";
    if (text.includes("-- counts")) {
      const site = text.includes(SITE_A) ? SITE_A : SITE_B;
      return counts(site, text.includes(SITE_B) ? opts.countsExtra : {});
    }
    if (text.includes("-- check")) return JSON.stringify(opts.violations ?? []);
    throw new Error("unexpected sql: " + text);
  });
  return { fetch, sql, deps: { fetch, sql, outDir: opts.out, log: () => undefined } };
}

describe("dry run guard and diff", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dryrun-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("recognises only loopback URLs as local", () => {
    expect(isLocalUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl("https://abc.supabase.co")).toBe(false);
    expect(isLocalUrl("https://localhost.evil.com")).toBe(false);
    expect(isLocalUrl("http://127.0.0.1.evil.com")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });

  it("exits non-zero before any fetch or query when a URL is not local", async () => {
    for (const env of [
      { ...LOCAL_ENV, SUPABASE_URL: "https://abc.supabase.co" },
      { ...LOCAL_ENV, DRY_RUN_APP_URL: "https://hydlnk.com" },
      { DRY_RUN_APP_URL: "http://localhost:3000" },
    ]) {
      const f = fakes({ out: dir });
      const code = await main(["snapshot", "--phase", "before"], env, f.deps);
      expect(code).not.toBe(0);
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.sql).not.toHaveBeenCalled();
    }
  });

  it("snapshots the handle and custom hosts per site", async () => {
    const f = fakes({ out: dir });
    expect(await main(["snapshot", "--phase", "before"], LOCAL_ENV, f.deps)).toBe(0);
    const base = join(dir, "before", SITE_A);
    expect(readFileSync(join(base, "handle", "home.html"), "utf8")).toBe("body of alpha.localhost:3000/");
    expect(readFileSync(join(base, "handle", "page-about.html"), "utf8")).toContain("/about");
    expect(readFileSync(join(base, "custom-alpha.example.com", "robots.txt"), "utf8")).toContain("/robots.txt");
    for (const name of ["sitemap.xml", "og.bin", "counts.json"]) {
      expect(readFileSync(join(base, name === "counts.json" ? name : join("handle", name)))).toBeTruthy();
    }
  });

  it("diffs two equal snapshots clean", async () => {
    await main(["snapshot", "--phase", "a"], LOCAL_ENV, fakes({ out: dir }).deps);
    await main(["snapshot", "--phase", "b"], LOCAL_ENV, fakes({ out: dir }).deps);
    const report = diffSnapshots(dir, "a", "b");
    expect(report.differing).toEqual([]);
    expect(await main(["diff", "a", "b"], LOCAL_ENV, fakes({ out: dir }).deps)).toBe(0);
  });

  it("fails on a one-byte change and names the site", async () => {
    await main(["snapshot", "--phase", "a"], LOCAL_ENV, fakes({ out: dir }).deps);
    await main(["snapshot", "--phase", "b"], LOCAL_ENV, fakes({ out: dir, flipByte: true }).deps);
    const report = diffSnapshots(dir, "a", "b");
    expect(report.differing).toEqual([SITE_B]);
    const logs: string[] = [];
    const deps = { ...fakes({ out: dir }).deps, log: (l: string) => logs.push(l) };
    expect(await main(["diff", "a", "b"], LOCAL_ENV, deps)).not.toBe(0);
    expect(logs.join("\n")).toContain(SITE_B);
    expect(logs.join("\n")).not.toContain(SITE_A);
  });

  it("fails on a count change and names the site", async () => {
    await main(["snapshot", "--phase", "a"], LOCAL_ENV, fakes({ out: dir }).deps);
    await main(
      ["snapshot", "--phase", "b"],
      LOCAL_ENV,
      fakes({ out: dir, countsExtra: { pageVersions: 2 } }).deps,
    );
    expect(diffSnapshots(dir, "a", "b").differing).toEqual([SITE_B]);
  });

  it("fails when a site or a file is missing from one side", async () => {
    await main(["snapshot", "--phase", "a"], LOCAL_ENV, fakes({ out: dir }).deps);
    await main(["snapshot", "--phase", "b"], LOCAL_ENV, fakes({ out: dir }).deps);
    rmSync(join(dir, "b", SITE_A, "handle", "sitemap.xml"));
    rmSync(join(dir, "b", SITE_B), { recursive: true });
    expect(diffSnapshots(dir, "a", "b").differing.sort()).toEqual([SITE_A, SITE_B].sort());
    writeFileSync(join(dir, "a", "stray.txt"), "not a site");
    expect(diffSnapshots(dir, "a", "b").differing.sort()).toEqual([SITE_A, SITE_B].sort());
  });

  it("check --phase after reports violations and fails; clean passes", async () => {
    const clean = fakes({ out: dir });
    expect(await main(["check", "--phase", "after"], LOCAL_ENV, clean.deps)).toBe(0);
    const logs: string[] = [];
    const bad = fakes({ out: dir, violations: [`${SITE_A}: no '/' entry`] });
    const code = await main(["check", "--phase", "after"], LOCAL_ENV, { ...bad.deps, log: (l) => logs.push(l) });
    expect(code).not.toBe(0);
    expect(logs.join("\n")).toContain(SITE_A);
    expect(await main(["check", "--phase", "before"], LOCAL_ENV, clean.deps)).not.toBe(0);
  });
});
