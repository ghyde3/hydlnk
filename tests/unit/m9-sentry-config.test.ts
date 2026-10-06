import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sentryBuildOptions } from "../../src/lib/sentry/build";

/**
 * M9-10 source maps: next.config.ts wraps the config with `withSentryConfig` only when
 * SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are all set at build; otherwise it exports the
 * plain config. Each combination is imported fresh. A wrapped config carries the SDK's build
 * variables (`env._sentryRewriteFramesDistDir`), which is how the two are told apart here.
 */

const KEYS = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "NEXT_PUBLIC_SENTRY_DSN"] as const;

/** The parts of a Next config these tests read. */
interface LoadedConfig {
  env?: Record<string, string>;
  headers?: unknown;
  redirects?: unknown;
  rewrites?: unknown;
  experimental?: { clientTraceMetadata?: string[] };
}

async function loadConfig(env: Partial<Record<(typeof KEYS)[number], string>>): Promise<LoadedConfig> {
  vi.resetModules();
  for (const key of KEYS) vi.stubEnv(key, env[key] ?? "");
  const { default: config } = await import("../../next.config");
  return config as LoadedConfig;
}

const isWrapped = (config: LoadedConfig): boolean => config.env?._sentryRewriteFramesDistDir !== undefined;

describe("M9-10 next.config.ts", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("with none of the three set, the plain config is exported: no wrapper, the headers and redirects as before", async () => {
    const config = await loadConfig({});
    expect(isWrapped(config)).toBe(false);
    expect(Object.keys(config).sort()).toEqual(["env", "headers", "redirects"]);
    expect(typeof config.headers).toBe("function");
    expect(config.env).toEqual({ NEXT_PUBLIC_SENTRY_DSN: "" });
  });

  it.each([
    ["only the token", { SENTRY_AUTH_TOKEN: "t" }],
    ["only the organisation", { SENTRY_ORG: "o" }],
    ["only the project", { SENTRY_PROJECT: "p" }],
    ["the token and the organisation", { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o" }],
    ["the token and the project", { SENTRY_AUTH_TOKEN: "t", SENTRY_PROJECT: "p" }],
    ["the organisation and the project", { SENTRY_ORG: "o", SENTRY_PROJECT: "p" }],
    ["the DSN alone", { NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" }],
  ])("with %s, the plain config is exported", async (_label, env) => {
    expect(isWrapped(await loadConfig(env))).toBe(false);
  });

  it("with all three set, the config is wrapped with the SDK's wrapper, quiet, with no tunnel and no trace metadata in the HTML", async () => {
    const config = await loadConfig({ SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" });
    expect(isWrapped(config)).toBe(true);
    // Everything of the plain config is still there.
    expect(typeof config.headers).toBe("function");
    expect(typeof config.redirects).toBe("function");
    expect(config.env!.NEXT_PUBLIC_SENTRY_DSN).toBe("");
    // No tunnel: no rewrite was added for it.
    expect(config.rewrites).toBeUndefined();
    // The wrapper's `sentry-trace` and `baggage` meta tags are not written into marketing HTML.
    expect(config.experimental?.clientTraceMetadata).toBeUndefined();
  });

  it("the DSN is inlined as the validated value, or as an empty string", async () => {
    expect((await loadConfig({ NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" })).env!.NEXT_PUBLIC_SENTRY_DSN).toBe("https://k@o1.ingest.sentry.io/1");
    expect((await loadConfig({ NEXT_PUBLIC_SENTRY_DSN: "http://k@o1.ingest.sentry.io/1" })).env!.NEXT_PUBLIC_SENTRY_DSN).toBe("");
    expect((await loadConfig({ NEXT_PUBLIC_SENTRY_DSN: "garbage" })).env!.NEXT_PUBLIC_SENTRY_DSN).toBe("");
  });
});

describe("M9-10 the wrapper's options", () => {
  const options = sentryBuildOptions({ SENTRY_AUTH_TOKEN: " tok ", SENTRY_ORG: " org ", SENTRY_PROJECT: " proj " });

  it("take the three values trimmed, and nothing else from the environment", () => {
    expect(options.authToken).toBe("tok");
    expect(options.org).toBe("org");
    expect(options.project).toBe("proj");
  });

  it("are quiet, send no telemetry about the build, add no tunnel route and no route manifest", () => {
    expect(options.silent).toBe(true);
    expect(options.telemetry).toBe(false);
    expect(options.tunnelRoute).toBeUndefined();
    expect(options.routeManifestInjection).toBe(false);
    expect(options.widenClientFileUpload).toBe(false);
  });

  it("wrap nothing at build time: no auto-instrumentation of routes, pages or middleware, no cron monitors", () => {
    expect(options.buildTimeInstrumentation).toBe(false);
    expect(options.webpack).toEqual({
      autoInstrumentServerFunctions: false,
      autoInstrumentMiddleware: false,
      autoInstrumentAppDirectory: false,
      automaticVercelMonitors: false,
    });
  });

  it("delete the source maps after the upload", () => {
    expect(options.sourcemaps.deleteSourcemapsAfterUpload).toBe(true);
  });
});
