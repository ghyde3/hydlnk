import { HANDLE_PATTERN } from "@/lib/schemas/handle";

/**
 * Host-based routing decision (PLAN.md -> Architecture). Pure: no env, no request objects, so it
 * is unit-testable and safe to import from the proxy.
 *
 *   marketing  the root host (hydlnk.com, localhost:3000) and *.vercel.app deployment hosts
 *   www        www.<root>: redirected to the root host
 *   app        app.<root>: the editor
 *   tenant     <handle>.<root>: one tenant page; `handle` is set
 *   custom     anything else: a custom domain, resolved through the domains table
 */
export type HostKind = "marketing" | "www" | "app" | "tenant" | "custom";

export interface HostClassification {
  kind: HostKind;
  /** Set only when kind is "tenant". */
  handle?: string;
}

/** Splits "host:port" into its parts. Handles bracketed IPv6 ("[::1]:3000"). */
function splitHost(value: string): { hostname: string; port: string } {
  const match = /^(.*?)(?::(\d+))?$/.exec(value);
  return { hostname: match?.[1] ?? value, port: match?.[2] ?? "" };
}

/** Lowercases, trims and drops the trailing dot of a fully qualified name ("hydlnk.com."). */
function normalizeHost(value: string): string {
  const { hostname, port } = splitHost(value.trim().toLowerCase());
  const bare = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return port ? `${bare}:${port}` : bare;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * @param host        the request's Host header (a port is part of it: "mara.localhost:3000")
 * @param rootDomain  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" locally, "hydlnk.com" in production
 */
export function classifyHost(host: string, rootDomain: string): HostClassification {
  const requested = normalizeHost(host);
  const root = normalizeHost(rootDomain);
  if (requested === "" || root === "") return { kind: "custom" };

  if (requested === root) return { kind: "marketing" };
  if (requested === `www.${root}`) return { kind: "www" };
  if (requested === `app.${root}`) return { kind: "app" };

  const { hostname, port } = splitHost(requested);
  const rootParts = splitHost(root);

  // Vercel deployment URLs (hydlnk-xxxx.vercel.app) serve the marketing site. They must not fall
  // through to the custom-domain lookup.
  if (hostname.endsWith(".vercel.app")) return { kind: "marketing" };

  // Local dev only: http://127.0.0.1:3000 is the root host too, not an unknown custom domain.
  if (
    rootParts.hostname === "localhost" &&
    port === rootParts.port &&
    LOOPBACK_HOSTNAMES.has(hostname)
  ) {
    return { kind: "marketing" };
  }

  const suffix = `.${root}`;
  if (requested.endsWith(suffix)) {
    // One label only: "a.b.hydlnk.com" is not a tenant. Same rule as pages.handle.
    const label = requested.slice(0, -suffix.length);
    if (HANDLE_PATTERN.test(label)) return { kind: "tenant", handle: label };
  }

  return { kind: "custom" };
}
