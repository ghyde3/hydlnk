import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { captureAppRequestError, serverSentryOptions } from "@/lib/sentry/server";

/**
 * M9-10 privacy, end to end through the real SDK with a fake transport (no network): an error whose
 * message holds an email, a share-link URL and a JWT is captured, and the envelope the SDK would
 * send contains none of them. Events about anything but the app host never reach the transport.
 */

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const SHARE = "https://app.hydlnk.com/share/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdo";
const DSN = "https://0123456789abcdef@o1.ingest.sentry.io/1";

const sent: Array<[unknown, Array<[{ type?: string }, Record<string, unknown>]>]> = [];

/** What the SDK handed to its transport, as one string. */
const wire = (): string => JSON.stringify(sent);

/** The envelopes that carry an event; the SDK's own client reports (counts of what it dropped) are not events. */
const events = () => sent.filter((envelope) => envelope[1].some(([header]) => header.type !== "client_report"));
const reports = () => sent.flatMap((envelope) => envelope[1].filter(([header]) => header.type === "client_report"));

function capture(requestUrl: string | undefined, error: Error): void {
  Sentry.withScope((scope) => {
    scope.addEventProcessor((event) => {
      if (requestUrl !== undefined) event.request = { url: requestUrl, method: "GET", headers: { cookie: "sb-x-auth-token=zzz" } };
      return event;
    });
    scope.setUser({ id: "u-1", email: "gary@example.com" });
    scope.setTag("owner", "gary@example.com");
    scope.setExtra("link", SHARE);
    Sentry.captureException(error);
  });
}

beforeAll(() => {
  Sentry.init({
    ...serverSentryOptions({ dsn: DSN, rootDomain: "hydlnk.com", environment: "test" }),
    // No hooks into the Vitest process: no default integrations, no OpenTelemetry, no network.
    defaultIntegrations: false,
    integrations: [],
    enableOpenTelemetrySetup: false,
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope as (typeof sent)[number]);
        return {};
      },
      flush: async () => true,
    }),
  });
});

afterAll(async () => {
  await Sentry.close();
});

describe("M9-10 the envelope the SDK would send", () => {
  it("holds none of the email, the share-link token or the JWT that were in the error", async () => {
    sent.length = 0;
    capture(
      `${SHARE}?token=abc`,
      new Error(`Could not send to gary@example.com about ${SHARE} using ${JWT} for mara.hydlnk.com`),
    );
    await Sentry.flush(2000);
    expect(events().length).toBe(1);
    const body = wire();
    for (const secret of ["gary@example.com", "Zm9vYmFy", "eyJhbGci", "SflKxw", "mara.hydlnk.com", "sb-x-auth-token", "token=abc", "u-1"]) {
      expect(body, secret).not.toContain(secret);
    }
    // What is left is what the brief allows: the scrubbed words, the app address, no user, no headers.
    expect(body).toContain("[email]");
    expect(body).toContain("https://app.hydlnk.com/share/[token]");
    expect(body).toContain("[handle].hydlnk.com");
    expect(body).toContain("[Filtered]");
    const event = events()[0]![1][0]![1] as { request?: Record<string, unknown>; user?: unknown; tags?: Record<string, string>; extra?: Record<string, string> };
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: "https://app.hydlnk.com/share/[token]", method: "GET" });
    expect(event.tags!.owner).toBe("[email]");
    expect(event.extra!.link).toBe("https://app.hydlnk.com/share/[token]");
  });

  it("an event about a tenant page, the marketing site or no request at all is dropped: nothing is sent", async () => {
    sent.length = 0;
    capture("https://mara.hydlnk.com/", new Error("tenant"));
    capture("https://hydlnk.com/pricing", new Error("marketing"));
    capture("https://app.hydlnk.com/r/page/block", new Error("redirect"));
    capture("https://app.hydlnk.com/media/x/y.webp", new Error("media"));
    capture(undefined, new Error("no request"));
    await Sentry.flush(2000);
    expect(events()).toEqual([]);
    // sendClientReports stays on: the SDK tells Sentry how many events it dropped and why, with no content.
    for (const [, report] of reports()) {
      expect(Object.keys(report).sort()).toEqual(["discarded_events", "timestamp"]);
      expect(JSON.stringify(report)).not.toMatch(/tenant|marketing|redirect|media|no request/);
    }
  });

  it("an event about the app host is sent exactly once", async () => {
    sent.length = 0;
    capture("https://app.hydlnk.com/editor?x=1", new Error("boom"));
    await Sentry.flush(2000);
    expect(events().length).toBe(1);
    expect(wire()).toContain("boom");
  });

  it("the SDK never sends the server's host name", async () => {
    sent.length = 0;
    capture("https://app.hydlnk.com/editor", new Error("host"));
    await Sentry.flush(2000);
    expect(wire()).not.toContain('"server_name"');
  });
});

describe("M9-10 onRequestError: a server error is captured once, with the request's address and nothing else of it", () => {
  const headers = { host: "app.hydlnk.com", cookie: "sb-x-auth-token=zzz", authorization: `Bearer ${JWT}` };
  const context = { routerKind: "App Router", routePath: "/editor", routeType: "render" };

  it("an error on the app host is sent: the address without its query string, the route as the transaction, no headers, nothing personal", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "hydlnk.com");
    sent.length = 0;
    await captureAppRequestError(
      Object.assign(new Error("Could not load the page for gary@example.com"), { digest: "123456" }),
      { path: "/editor?email=gary%40example.com&token=abc", method: "GET", headers },
      context,
    );
    expect(events().length).toBe(1);
    const body = wire();
    for (const secret of ["gary@example.com", "gary%40", "token=abc", "sb-x-auth-token", "eyJhbGci"]) {
      expect(body, secret).not.toContain(secret);
    }
    const event = events()[0]![1][0]![1] as { request?: Record<string, unknown>; transaction?: string; contexts?: { nextjs?: Record<string, string> }; exception?: { values: Array<{ value: string; mechanism: { handled: boolean; type: string } }> } };
    expect(event.request).toEqual({ url: "https://app.hydlnk.com/editor", method: "GET" });
    expect(event.transaction).toBe("GET /editor");
    expect(event.contexts?.nextjs).toEqual({ request_path: "/editor", router_kind: "App Router", router_path: "/editor", route_type: "render" });
    expect(event.exception?.values[0]?.value).toBe("Could not load the page for [email]");
    expect(event.exception?.values[0]?.mechanism).toMatchObject({ handled: false, type: "auto.function.nextjs.on_request_error" });
    vi.unstubAllEnvs();
  });

  it("an error for a tenant host, the marketing host or an app path that is not the app's sends nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "hydlnk.com");
    sent.length = 0;
    const requests: Array<[string, string]> = [["mara.hydlnk.com", "/"], ["hydlnk.com", "/pricing"], ["links.example.com", "/"], ["app.hydlnk.com", "/r/page/block"], ["app.hydlnk.com", "/api/e"], ["app.hydlnk.com", "/media/x/y.webp"]];
    for (const [host, path] of requests) {
      await captureAppRequestError(new Error(`tenant ${host}${path}`), { path, method: "GET", headers: { host } }, context);
    }
    await captureAppRequestError(new Error("no host at all"), { path: "/editor", method: "GET", headers: {} }, context);
    expect(events()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("Next.js control flow (a redirect, a not-found) is not an error", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "hydlnk.com");
    sent.length = 0;
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404", "DYNAMIC_SERVER_USAGE", "BAILOUT_TO_CLIENT_SIDE_RENDERING"]) {
      await captureAppRequestError(Object.assign(new Error("control flow"), { digest }), { path: "/editor", method: "GET", headers }, context);
    }
    expect(events()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("a server action's error carries its route type, and is captured once", async () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "hydlnk.com");
    sent.length = 0;
    await captureAppRequestError(new Error("action failed"), { path: "/domains", method: "POST", headers }, { routerKind: "App Router", routePath: "/domains", routeType: "action" });
    expect(events().length).toBe(1);
    const event = events()[0]![1][0]![1] as { transaction?: string; contexts?: { nextjs?: Record<string, string> } };
    expect(event.transaction).toBe("POST /domains");
    expect(event.contexts?.nextjs?.route_type).toBe("action");
    vi.unstubAllEnvs();
  });
});
