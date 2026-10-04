import * as Sentry from "@sentry/nextjs";
import { protocolFor } from "@/lib/routing/urls";
import { createBeforeBreadcrumb, createBeforeSend, createBeforeSendTransaction } from "./hooks";
import { SENTRY_OPTIONS, sentryEnvironment } from "./options";
import { stripQuery } from "./scrub";

/**
 * Starts the server SDK for the app host (M9-10). Loaded only by `register()` in
 * src/instrumentation.ts, and only when a DSN is set. Server events about anything but the app host
 * (a tenant page, the marketing site, `/r`, `/api/e`, `/media`, `/_t`) are dropped by the same
 * `beforeSend` the browser uses; see ./filter.ts.
 */

export interface ServerSentryConfig {
  dsn: string;
  rootDomain: string | undefined;
  environment: string;
}

/** The options handed to `Sentry.init`: pure, so a test can start the real SDK with a fake transport. */
export function serverSentryOptions(config: ServerSentryConfig) {
  const scrub = { rootDomain: config.rootDomain };
  return {
    ...SENTRY_OPTIONS,
    dsn: config.dsn,
    environment: config.environment,
    beforeSend: createBeforeSend(scrub),
    beforeSendTransaction: createBeforeSendTransaction(scrub),
    beforeBreadcrumb: createBeforeBreadcrumb(scrub),
    integrations: [
      // The Next.js SDK uses this integration without incoming-request spans (Next.js makes its own);
      // no release-health sessions, no request bodies, no tracing headers on outgoing requests.
      Sentry.httpIntegration({
        sessions: false,
        maxRequestBodySize: "none",
        tracePropagation: false,
        disableIncomingRequestSpans: true,
      }),
    ],
  };
}

export function initSentryServer(dsn: string): void {
  Sentry.init(
    serverSentryOptions({
      dsn,
      rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
      environment: sentryEnvironment({
        VERCEL_ENV: process.env.VERCEL_ENV,
        NODE_ENV: process.env.NODE_ENV,
      }),
    }),
  );
}

/** What Next.js hands `onRequestError`. */
export interface RequestInfo {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}
export interface RequestErrorContext {
  routerKind: string;
  routePath: string;
  routeType: string;
}

/** Next.js control flow that reaches `onRequestError` as an error: not a failure. */
const CONTROL_FLOW_DIGEST = /^(?:NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The address a request was made to, from the Host header and the path (without its query string).
 * Built here, on purpose, so the event carries the host the filter judges it by. Only the real Host
 * header is read, never X-Forwarded-Host: a client can set that one on any host that is not behind
 * a platform that overwrites it, and would label a tenant or marketing error as an app-host error
 * (the same rule as `src/proxy.ts`).
 */
export function requestUrlOf(request: RequestInfo, rootDomain: string | undefined): string | undefined {
  const host = first(request.headers.host);
  if (!host) return undefined;
  const protocol = rootDomain ? protocolFor(rootDomain) : "https";
  const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
  return `${protocol}://${host}${stripQuery(path)}`;
}

/**
 * `onRequestError` for the app: an error thrown while rendering a page, in a server action or in a
 * route handler is captured once, with the request's address (never its headers), and flushed before
 * the function can freeze. Anything that is not the app host's is dropped later by `beforeSend`.
 */
export async function captureAppRequestError(
  error: unknown,
  request: RequestInfo,
  context: RequestErrorContext,
): Promise<void> {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && CONTROL_FLOW_DIGEST.test(digest)) return;
  const url = requestUrlOf(request, process.env.NEXT_PUBLIC_ROOT_DOMAIN);
  Sentry.withScope((scope) => {
    scope.addEventProcessor((event) => {
      event.request = { url, method: request.method };
      return event;
    });
    scope.setContext("nextjs", {
      request_path: stripQuery(request.path),
      router_kind: context.routerKind,
      router_path: context.routePath,
      route_type: context.routeType,
    });
    scope.setTransactionName(`${request.method} ${context.routePath}`);
    Sentry.captureException(error, {
      mechanism: { handled: false, type: "auto.function.nextjs.on_request_error" },
    });
  });
  await Sentry.flush(2000).catch(() => false);
}
