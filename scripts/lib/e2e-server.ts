/**
 * Which web server the Playwright suite runs against (M9-13). One pure function, used by
 * playwright.config.ts and unit-tested in tests/unit/m9-ci-e2e-server.test.ts.
 *
 * - Locally, and in any shell without the switch: `pnpm dev --port {port}`, reusing a server that
 *   already answers (the shared dev server). This is the behavior the suite always had.
 * - In CI with HL_E2E_SERVER=start: the production build the job made (`pnpm build`, with the root
 *   domain `localhost:{port}` baked in), served by `next start`. It must be a fresh server: the port
 *   is checked first and a server that is already there is an error, never reused, so a suite can
 *   not silently run against some other process. It runs with the test hooks on
 *   (HYDLNK_QUERY_COUNTER=1, see src/lib/env/test-hooks.ts: ignored on a Vercel production
 *   deployment, and VERCEL_ENV is unset on the runner) and the root domain the build has.
 *
 * Without CI the switch does nothing: a developer who exports HL_E2E_SERVER keeps the dev server.
 */

/** The environment the choice reads (`process.env`): only CI and HL_E2E_SERVER matter. */
export type E2eServerEnv = Readonly<Record<string, string | undefined>>;

/** The keys of Playwright's `webServer` option this file sets. */
export interface E2eWebServer {
  command: string;
  url: string;
  reuseExistingServer: boolean;
  timeout: number;
  /** Production server only: its log lines show up in the test output. */
  stdout?: "pipe";
  /** Production server only: added to the environment the server starts with. */
  env?: Record<string, string>;
}

/** True when the suite is to run against the production build (`next start`). */
export function usesProductionServer(env: E2eServerEnv): boolean {
  return Boolean(env.CI) && env.HL_E2E_SERVER === "start";
}

/** The Playwright `webServer` entry for the app under test, listening on `port`. */
export function e2eWebServer(port: number, env: E2eServerEnv): E2eWebServer {
  const url = `http://localhost:${port}`;
  if (usesProductionServer(env)) {
    return {
      command: `./node_modules/.bin/next start -p ${port}`,
      url,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      env: { NEXT_PUBLIC_ROOT_DOMAIN: `localhost:${port}`, HYDLNK_QUERY_COUNTER: "1" },
    };
  }
  return {
    command: `pnpm dev --port ${port}`,
    url,
    reuseExistingServer: true,
    // A cold `next dev` on a CI runner (a shard starting while the others compile) took longer than
    // two minutes to answer the first request in the full-suite run; locally two minutes is plenty.
    timeout: env.CI ? 300_000 : 120_000,
  };
}
