/**
 * The one options object of the Sentry SDK on the app side (M9-10). The client starter
 * (client.ts) and the server starter (server.ts) both spread it into `Sentry.init`, so what the
 * SDK collects is decided here and read by one test.
 *
 * The brief: errors, and 10% of traces. Nothing personal: no default PII, no user, no cookies, no
 * headers, no bodies, no query strings, no variables from stack frames, no database or queue
 * payloads. No session replay and no feedback widget (neither integration is ever added). No
 * tunnel and no extra route on any host. The DSN is the only destination and is never in here: it
 * comes from the environment, once, at start.
 *
 * `sendDefaultPii: false` is the flag the Sentry docs of every earlier major version name. Version
 * 11 of the SDK no longer has it: its `dataCollection` option replaces it, and every category is
 * turned off there. Both are set, so a reader who looks for either finds it, and an SDK that still
 * reads the old one is told the same thing.
 */
export const SENTRY_OPTIONS = {
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [] as never[],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  /** 10% of traces. Read by the tests; the SDK reads the same number. */
  tracesSampleRate: 0.1,
  /**
   * Transactions are sent whole (not streamed span by span), so `beforeSendTransaction` can drop a
   * trace that is not the app host's and scrub every span of one that is.
   */
  traceLifecycle: "static" as const,
  /** No `sentry-trace` or `baggage` header goes to any outgoing request, same origin or not. */
  tracePropagationTargets: [] as never[],
  maxBreadcrumbs: 20,
  /** The SDK's reports of what it dropped. They carry counts and reasons, no event content. */
  sendClientReports: true,
  /** The machine's host name is not sent. */
  includeServerName: false,
  /** Errors that are not errors: Next.js control flow and a browser's own noise. */
  ignoreErrors: [
    "NEXT_REDIRECT",
    "NEXT_NOT_FOUND",
    "NEXT_HTTP_ERROR_FALLBACK",
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
  ] as string[],
};

/** The name Sentry files events under: the Vercel environment, else NODE_ENV, else "production". */
export function sentryEnvironment(env: {
  VERCEL_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
}): string {
  return env.VERCEL_ENV || env.NODE_ENV || "production";
}
