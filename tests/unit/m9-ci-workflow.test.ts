import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M9-13: the browser suite job of .github/workflows/ci.yml runs on a production build over eight
 * shards. The workflow cannot run here, so this holds its shape: the matrix, the build step and its
 * order, the cache, the server the suite uses, the cache-check step on shard 1, the diagnostics and
 * the rules that stay (pinned actions, no secrets, the integration retry, the triggers).
 */

const text = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const e2eStart = text.indexOf("\n  e2e:\n");
const verifyJob = text.slice(text.indexOf("\n  verify:\n"), e2eStart);
const e2eJob = text.slice(e2eStart);

/** The text of one step of the e2e job, from its `- name:` line to the next step's. */
function step(titleStart: string): string {
  const marker = `      - name: ${titleStart}`;
  const at = e2eJob.indexOf(marker);
  expect(at, `step "${titleStart}" not found`).toBeGreaterThan(-1);
  const next = e2eJob.indexOf("\n      - name:", at + marker.length);
  return e2eJob.slice(at, next === -1 ? undefined : next);
}

/** Position of a step in the e2e job: later steps have larger numbers. */
const at = (titleStart: string) => e2eJob.indexOf(`      - name: ${titleStart}`);

describe("the matrix", () => {
  it("is eight shards, named 'Browser suite (n/8)', and one failing shard does not cancel the rest", () => {
    expect(e2eJob).toContain("name: Browser suite (${{ matrix.shard }}/8)");
    expect(e2eJob).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
    expect(e2eJob).toContain("fail-fast: false");
    expect(e2eJob).not.toContain("/4)");
    expect(e2eJob).not.toContain("/4\n");
  });

  it("runs the suite with `pnpm test:e2e --shard=n/8`", () => {
    expect(step("End-to-end tests")).toContain("pnpm test:e2e --shard=${{ matrix.shard }}/8");
  });

  it("the header says eight runners and a production build in CI, `next dev` locally", () => {
    const header = text.slice(0, text.indexOf("\non:\n"));
    expect(header).toContain("split over 8 runners");
    expect(header).not.toContain("split over 4 runners");
    expect(header).toMatch(/production build/);
    expect(header).toMatch(/locally[^\n]*`next dev`/);
  });
});

describe("what did not change", () => {
  it("the verify job still retries the integration tests twice", () => {
    expect(verifyJob).toContain("pnpm exec vitest run --retry 2");
  });

  it("the triggers are the pull request, main, nightly and manual runs, and the full-ci label", () => {
    const triggers = text.slice(text.indexOf("\non:\n"), text.indexOf("\nconcurrency:"));
    expect(triggers).toContain("types: [opened, synchronize, reopened, labeled]");
    expect(triggers).toContain("branches: [main]");
    expect(triggers).toContain('cron: "0 7 * * *"');
    expect(triggers).toContain("workflow_dispatch:");
    expect(e2eJob).toContain("needs: verify");
    expect(e2eJob).toContain("github.event_name == 'schedule'");
    expect(e2eJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(e2eJob).toContain("contains(github.event.pull_request.labels.*.name, 'full-ci')");
  });

  it("every action is pinned to a major version, the only new one is actions/cache, no secret is used", () => {
    const uses = [...text.matchAll(/^\s+uses: (\S+)$/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(5);
    for (const use of uses) expect(use, use).toMatch(/^[\w.-]+\/[\w.-]+@v\d+$/);
    expect([...new Set(uses.map((u) => u.split("@")[0]))].sort()).toEqual([
      "actions/cache",
      "actions/checkout",
      "actions/setup-node",
      "actions/upload-artifact",
      "pnpm/action-setup",
      "supabase/setup-cli",
    ]);
    expect(text).not.toContain("secrets.");
  });
});

describe("the production build of each shard", () => {
  const build = step("Production build");

  it("is made once, after .env.local and the Next.js cache, before the browsers and the tests", () => {
    expect(at("Write .env.local")).toBeGreaterThan(-1);
    expect(at("Write .env.local")).toBeLessThan(at("Restore the Next.js build cache"));
    expect(at("Restore the Next.js build cache")).toBeLessThan(at("Production build"));
    expect(at("Production build")).toBeLessThan(at("Install Playwright browsers"));
    expect(at("Production build")).toBeLessThan(at("End-to-end tests"));
    expect((e2eJob.match(/\bpnpm build\b/g) ?? []).length).toBe(1);
    expect(build).toContain("pnpm build");
  });

  it("bakes in the root domain of the port the server answers on, and sets the test hooks flag", () => {
    expect(build).toContain("NEXT_PUBLIC_ROOT_DOMAIN: localhost:3000");
    expect(build).toContain('HYDLNK_QUERY_COUNTER: "1"');
  });

  it("reports its duration and whether the Next.js cache was hit", () => {
    expect(build).toContain("GITHUB_STEP_SUMMARY");
    expect(build).toContain("steps.next-cache.outputs.cache-hit");
  });

  it("shard 1 keeps a clean copy of the build for the cache checks, because a server writes into .next", () => {
    const build = step("Production build");
    expect(build).toContain(
      'if [ "${{ matrix.shard }}" = "1" ]; then cp -a .next .next-pristine; fi',
    );
    const checks = step("Production cache checks");
    expect(checks).toContain("rm -rf .next\n          mv .next-pristine .next");
    expect(at("Production build")).toBeLessThan(at("End-to-end tests"));
    expect(checks.indexOf("mv .next-pristine .next")).toBeLessThan(
      checks.indexOf("start_prod tmp/start-3000.log\n"),
    );
  });

  it("the Next.js cache is .next/cache, keyed on the lockfile and src/, restored by the lockfile alone", () => {
    const cache = step("Restore the Next.js build cache");
    expect(cache).toContain("uses: actions/cache@v6");
    expect(cache).toContain("id: next-cache");
    // The build cache, without what the server stores while it runs (the data cache of cached pages).
    expect(cache).toMatch(/path: \|\n\s+\.next\/cache\n\s+!\.next\/cache\/fetch-cache\n/);
    expect(cache).toContain(
      "key: nextjs-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ hashFiles('src/**') }}",
    );
    expect(cache).toMatch(
      /restore-keys: \|\n\s+nextjs-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('pnpm-lock\.yaml'\) \}\}-\n/,
    );
  });
});

describe("the suite's server", () => {
  const tests = step("End-to-end tests");

  it("is the built one: `next start` through the config, with the production-build checks on", () => {
    expect(tests).toContain("HL_E2E_SERVER: start");
    expect(tests).toContain('E2E_PROD_BUILD: "1"');
    expect(tests).not.toContain("pnpm dev");
    expect(tests).not.toContain("HL_PROD_PORT");
  });

  it("the shard's pass, skip, flaky and fail counts reach the job summary", () => {
    expect(tests).toContain("tee tmp/e2e-shard.log");
    const counts = step("Test counts of this shard");
    expect(counts).toContain("if: always()");
    expect(counts).toContain("GITHUB_STEP_SUMMARY");
  });
});

describe("the production cache checks on shard 1", () => {
  const checks = step("Production cache checks");

  it("run on shard 1 only, on the suite's own build (:3000), with the three start variants", () => {
    expect(checks).toContain("if: matrix.shard == 1");
    expect(checks).not.toContain("pnpm build");
    expect(checks).not.toContain("3100");
    expect(checks).toContain("next start -p 3000");
    expect(checks).toContain("tmp/start-3000.log");
    expect(checks).toContain("tmp/start-3000-closed.log PAID_PLANS_OPEN=false");
    expect(checks).toContain("tmp/start-3000-noflag.log HYDLNK_QUERY_COUNTER=0");
    expect(checks).not.toContain("HL_E2E_SERVER");
  });

  it("run every production-only spec of before, each with HL_PROD_PORT=3000", () => {
    for (const spec of [
      "tests/e2e/m2/publish-cache.spec.ts",
      "tests/e2e/m4/billing-badge.spec.ts",
      "tests/e2e/m5/suspend-cache.spec.ts",
      "tests/e2e/m8/render-cache.spec.ts",
      "tests/e2e/m8/assets-budget.spec.ts",
      "tests/e2e/m8/assets-served.spec.ts",
      "tests/e2e/m8/assets-fonts-live.spec.ts",
      "tests/e2e/m8/levers-domain-cache.spec.ts",
      "tests/e2e/m4/billing-plans-closed.spec.ts",
    ]) {
      expect(checks, spec).toContain(spec);
    }
    expect(checks).toContain("HL_PROD_PORT=3000 HL_PLANS_CLOSED=1 pnpm exec playwright test");
    expect(checks).toContain("HL_PROD_PORT=3000 HL_COUNTER_OFF=1 pnpm exec playwright test");
    expect(checks).toContain("--project=desktop");
  });

  it("scans the bundle of whichever build exists, and stops every server the TERM way, then KILL", () => {
    expect(checks).toContain("pnpm exec vitest run tests/unit/publish-bundle.test.ts");
    expect(checks).toContain('kill "$prod_pid"');
    expect(checks).toContain('kill -9 "$prod_pid"');
    expect(checks).toContain("something still answers on :3000 after the server was stopped");
  });

  it("the start helper waits up to 60 tries for :3000 and fails with the server log", () => {
    expect(checks).toContain("seq 1 60");
    expect(checks).toContain("next start exited before it answered on :3000");
    expect(checks).toContain('cat "$1"');
    expect(checks).toContain("wait_port_free");
  });
});

describe("what still runs after the suite", () => {
  it("the screenshots step starts the dev server and makes the three sets, then they are uploaded", () => {
    const shots = step("Screenshots at 390 and 1440");
    expect(shots).toContain("if: matrix.shard == 1");
    expect(shots).toContain("pnpm dev > tmp/dev.log");
    for (const host of [
      "pnpm screens /\n",
      "pnpm screens / --host app",
      "pnpm screens / --host mara",
    ]) {
      expect(shots).toContain(host);
    }
    expect(at("Screenshots at 390 and 1440")).toBeGreaterThan(at("Production cache checks"));
    expect(step("Upload Playwright report and traces")).toContain("playwright-report/");
    expect(step("Upload Playwright report and traces")).toContain("test-results/");
    expect(step("Upload screenshots")).toContain("tmp/screens/");
  });

  it("the production server diagnostics print the server logs on a failure", () => {
    const diagnostics = step("Production server diagnostics");
    expect(diagnostics).toContain("if: failure()");
    expect(diagnostics).toContain("tmp/start-3000.log");
    expect(diagnostics).toContain("tmp/start-3000-closed.log");
    expect(diagnostics).toContain("tmp/start-3000-noflag.log");
  });
});
