import { classifyHost } from "@/lib/routing/host";
import { BRAND_DOMAIN } from "./constants";
import { HANDLE_PATTERN } from "@/lib/schemas/handle";

/**
 * What the report form's address field means (M5-05): a page's handle address (`mara.hydlnk.com`,
 * or `mara.localhost:3000` on a dev machine, with or without a scheme and path) or a custom domain.
 * Pure: the database lookup that follows is the caller's.
 */
export type ReportAddress =
  { kind: "handle"; handle: string } | { kind: "domain"; hostname: string };

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Reads what a visitor typed. Returns null for what cannot name a page: empty text, the HYDLNK
 * hosts themselves (`hydlnk.com`, `app.hydlnk.com`), a bare word that is not a handle, or text with
 * characters a host name cannot hold. Never fetches anything.
 *
 * @param rootDomain NEXT_PUBLIC_ROOT_DOMAIN ("localhost:3000" locally, "hydlnk.com" in production)
 */
export function parseReportAddress(input: string, rootDomain: string): ReportAddress | null {
  let text = input.trim().toLowerCase();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.split(/[/?#]/, 1)[0] ?? "";
  text = text.slice(text.lastIndexOf("@") + 1);
  text = text.replace(/\.+(?=:\d+$|$)/, "");
  if (text === "" || text.length > 260) return null;

  // On this deployment's own root domain (with its port), then on the brand domain (any port).
  const own = classifyHost(text, rootDomain);
  if (own.kind === "tenant" && own.handle) return { kind: "handle", handle: own.handle };
  const bare = text.replace(/:\d+$/, "");
  const brand = classifyHost(bare, BRAND_DOMAIN);
  if (brand.kind === "tenant" && brand.handle) return { kind: "handle", handle: brand.handle };

  // A bare handle ("mara").
  if (!bare.includes(".") && !text.includes(":") && HANDLE_PATTERN.test(bare)) {
    return { kind: "handle", handle: bare };
  }

  // Anything else that is a plausible host name and not one of ours is a custom domain.
  if (
    own.kind === "custom" &&
    brand.kind === "custom" &&
    HOSTNAME.test(bare) &&
    !bare.endsWith(`.${BRAND_DOMAIN}`) &&
    bare !== BRAND_DOMAIN
  ) {
    return { kind: "domain", hostname: bare };
  }
  return null;
}

/** The address a page is shown under in the form: always `{handle}.hydlnk.com`. */
export function handleAddress(handle: string): string {
  return `${handle}.${BRAND_DOMAIN}`;
}
