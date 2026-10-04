import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { e2eWebServer, usesProductionServer } from "../../scripts/lib/e2e-server";

/**
 * M9-13: which web server the Playwright suite runs against. CI sets HL_E2E_SERVER=start and the
 * suite runs on the production build with `next start`; every other shell keeps `pnpm dev` and the
 * shared dev server it reuses. One pure function decides (scripts/lib/e2e-server.ts), read by
 * playwright.config.ts.
 */

const DEV_LOCAL = {
  command: "pnpm dev --port 3000",
  url: "http://localhost:3000",
  reuseExistingServer: true,
  timeout: 120_000,
};

describe("the development server stays the default", () => {
  it("a shell with neither variable runs `pnpm dev`, reusing a server that answers, 120 s", () => {
    expect(e2eWebServer(3000, {})).toEqual(DEV_LOCAL);
  });

  it("CI alone keeps `pnpm dev` and today's 300 s start-up timeout", () => {
    expect(e2eWebServer(3000, { CI: "true" })).toEqual({ ...DEV_LOCAL, timeout: 300_000 });
  });

  it("HL_E2E_SERVER without CI does nothing: a developer who exports it keeps the dev server", () => {
    expect(e2eWebServer(3000, { HL_E2E_SERVER: "start" })).toEqual(DEV_LOCAL);
    expect(usesProductionServer({ HL_E2E_SERVER: "start" })).toBe(false);
  });

  it.each(["", "dev", "START", "start ", "production", "1", "true"])(
    "CI with HL_E2E_SERVER=%j is still the dev server",
    (value) => {
      expect(usesProductionServer({ CI: "true", HL_E2E_SERVER: value })).toBe(false);
      expect(e2eWebServer(3000, { CI: "true", HL_E2E_SERVER: value })).toEqual({
        ...DEV_LOCAL,
        timeout: 300_000,
      });
    },
  );

  it("an empty CI counts as not CI, like `process.env.CI ? ... : ...` always did", () => {
    expect(e2eWebServer(3000, { CI: "", HL_E2E_SERVER: "start" })).toEqual(DEV_LOCAL);
  });

  it("a development result carries no option that only the production server needs", () => {
    for (const env of [{}, { CI: "true" }, { HL_E2E_SERVER: "start" }]) {
      const server = e2eWebServer(3000, env);
      expect(server).not.toHaveProperty("env");
      expect(server).not.toHaveProperty("stdout");
    }
  });
});

describe("CI with HL_E2E_SERVER=start runs the production build", () => {
  const ci = { CI: "true", HL_E2E_SERVER: "start" };

  it("is `next start` itself, never reused, with 120 s to start", () => {
    const server = e2eWebServer(3000, ci);
    expect(usesProductionServer(ci)).toBe(true);
    expect(server.command).toBe("./node_modules/.bin/next start -p 3000");
    expect(server.url).toBe("http://localhost:3000");
    expect(server.reuseExistingServer).toBe(false);
    expect(server.timeout).toBe(120_000);
  });

  it("runs with the test hooks on and the root domain of its own port", () => {
    expect(e2eWebServer(3000, ci).env).toEqual({
      NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
      HYDLNK_QUERY_COUNTER: "1",
    });
  });

  it("follows the port, like HL_DEV_PORT does for the dev server", () => {
    const dev = e2eWebServer(3200, {});
    expect(dev.command).toBe("pnpm dev --port 3200");
    expect(dev.url).toBe("http://localhost:3200");
    const prod = e2eWebServer(3200, ci);
    expect(prod.command).toBe("./node_modules/.bin/next start -p 3200");
    expect(prod.url).toBe("http://localhost:3200");
    expect(prod.env?.NEXT_PUBLIC_ROOT_DOMAIN).toBe("localhost:3200");
  });

  it("never carries a secret or the Vercel switch: the hooks stay off on a production deployment", () => {
    const env = e2eWebServer(3000, ci).env ?? {};
    expect(Object.keys(env).sort()).toEqual(["HYDLNK_QUERY_COUNTER", "NEXT_PUBLIC_ROOT_DOMAIN"]);
  });
});

describe("playwright.config.ts", () => {
  const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");

  it("takes the app server from the function and keeps everything else", () => {
    expect(config).toContain("e2eWebServer(DEV_PORT, process.env)");
    expect(config).toContain("Number(process.env.HL_DEV_PORT ?? 3000)");
    expect(config).toContain("retries: process.env.CI ? 1 : 0");
    expect(config).toContain('name: "phone"');
    expect(config).toContain('name: "desktop"');
    expect(config).toContain("tests/e2e/fixtures/vercel-stub-server.ts 12112");
    expect(config).not.toContain("pnpm dev --port");
  });

  it("lists the same tests under both servers", () => {
    const total = (env: Record<string, string | undefined>): string => {
      const out = execFileSync("pnpm", ["exec", "playwright", "test", "--list"], {
        cwd: process.cwd(),
        env: {
          // Some specs read the local Supabase settings while they are loaded; the verify job has no
          // .env.local at this step, and listing does not talk to anything, so placeholders do.
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder",
          SUPABASE_SECRET_KEY: "placeholder",
          ...process.env,
          CI: undefined,
          HL_E2E_SERVER: undefined,
          ...env,
        },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const line = out.split("\n").find((l) => l.startsWith("Total:"));
      expect(line, "playwright --list printed no total").toBeTruthy();
      return line!;
    };
    const dev = total({});
    const prod = total({ CI: "true", HL_E2E_SERVER: "start" });
    expect(prod).toBe(dev);
    expect(Number(/Total: (\d+) tests/.exec(dev)?.[1])).toBeGreaterThan(1000);
  }, 120_000);
});
