import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SENTRY_OPTIONS, sentryEnvironment } from "@/lib/sentry/options";
import { serverSentryOptions } from "@/lib/sentry/server";
import { listFiles, ROOT } from "./support/module-graph";

/** M9-10 sampling and features: 10% of traces, no PII, no replay, no widget, no tunnel, at most 20 breadcrumbs. */

describe("M9-10 the one options object", () => {
  it("tracesSampleRate is 0.1", () => {
    expect(SENTRY_OPTIONS.tracesSampleRate).toBe(0.1);
  });

  it("sendDefaultPii is false and every category of dataCollection is off", () => {
    expect(SENTRY_OPTIONS.sendDefaultPii).toBe(false);
    expect(SENTRY_OPTIONS.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it("at most 20 breadcrumbs, client reports on, no server name, no tracing headers on any outgoing request", () => {
    expect(SENTRY_OPTIONS.maxBreadcrumbs).toBeLessThanOrEqual(20);
    expect(SENTRY_OPTIONS.sendClientReports).toBe(true);
    expect(SENTRY_OPTIONS.includeServerName).toBe(false);
    expect(SENTRY_OPTIONS.tracePropagationTargets).toEqual([]);
  });

  it("no session replay, no feedback widget, no tunnel, no spotlight, no profiling", () => {
    const keys = Object.keys(SENTRY_OPTIONS);
    for (const forbidden of ["replaysSessionSampleRate", "replaysOnErrorSampleRate", "tunnel", "spotlight", "profilesSampleRate", "integrations", "replayIntegration", "feedbackIntegration", "dsn"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("the DSN is the only destination: it is not in the shared options, it comes in as an argument", () => {
    const options = serverSentryOptions({ dsn: "https://k@o1.ingest.sentry.io/1", rootDomain: "hydlnk.com", environment: "test" });
    expect(options.dsn).toBe("https://k@o1.ingest.sentry.io/1");
    expect(options).not.toHaveProperty("tunnel");
    expect(options.tracesSampleRate).toBe(0.1);
    expect(options.maxBreadcrumbs).toBeLessThanOrEqual(20);
    expect(options.sendDefaultPii).toBe(false);
    expect(options.dataCollection.userInfo).toBe(false);
  });

  it("the environment is the Vercel one, else NODE_ENV, else production", () => {
    expect(sentryEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe("preview");
    expect(sentryEnvironment({ NODE_ENV: "development" })).toBe("development");
    expect(sentryEnvironment({})).toBe("production");
  });
});

describe("M9-10 what the source never does", () => {
  const files = [...listFiles("src"), "next.config.ts"];
  const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");

  it("Sentry.setUser is never called, and no replay, feedback, tunnel or user-context API is used", () => {
    for (const file of files) {
      const text = code(read(file));
      for (const forbidden of [/\bsetUser\s*\(/, /replayIntegration/, /feedbackIntegration/, /tunnelRoute\s*:(?!\s*undefined\b)/, /\bshowReportDialog\b/, /\bcaptureFeedback\b/, /\bspotlight\s*:/, /\bsetContext\(\s*["']user["']/]) {
        expect(text, `${file}: ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("there is no instrumentation-client file (Next.js 16 would load it on every page, marketing included)", () => {
    for (const path of ["instrumentation-client.ts", "instrumentation-client.js", "src/instrumentation-client.ts", "src/instrumentation-client.js"]) {
      expect(() => readFileSync(resolve(ROOT, path), "utf8"), path).toThrow();
    }
  });

  it("no sentry.*.config file, no /monitoring route and no tunnel route exist", () => {
    for (const path of ["sentry.client.config.ts", "sentry.server.config.ts", "sentry.edge.config.ts"]) {
      expect(() => readFileSync(resolve(ROOT, path), "utf8"), path).toThrow();
    }
    const routes = listFiles("src/app", /^route\.ts$/).concat(listFiles("src/app", /^page\.tsx$/));
    expect(routes.filter((route) => /monitoring|tunnel|sentry/i.test(route))).toEqual([]);
  });
});
