import { HOSTNAME_PATTERN } from "@/lib/domains/hostname";
import { clientEnv } from "@/lib/env/client";
import { classifyHost } from "@/lib/routing/host";

/**
 * Which hosts the `/media` route answers on (Wave I review). The route runs behind no proxy, and the
 * CDN keeps one copy of an image per host, so a host nobody owns is a cache miss, a Storage fetch and
 * a transfer for every label an attacker makes up (`a1.hydlnk.com`, `a2.hydlnk.com`, ...). The images
 * stay on the page's own address (M7-15), so the rule is the one the proxy already applies to a host:
 *
 *   served   the root host and deployment hosts, the app host, a handle's host (one valid handle
 *            label under the root), and a plain domain name that is not under the root: a custom
 *            domain. In production only a domain added to the Vercel project reaches this code at
 *            all, so "a plain domain name" is a real one there; locally anything does.
 *   refused  `www` (it only redirects), anything else under the root (two labels, a label that is
 *            not a handle), the root or a handle on the wrong port, an IP address that is not the
 *            local loopback, a single label, and anything that is not a hostname.
 *
 * This is syntactic on purpose: whether the handle exists is a database question, and this route
 * holds no database key (M7-14). It narrows the hosts, it does not bound them: handle-shaped labels
 * are still too many to count. The ceiling is Vercel's per-IP rate rule on `/media/` and its spend
 * limit, which are the owner's to set (PROGRESS.md -> Open for Gary). Pure of the request: the
 * caller passes the Host header's value.
 */

/** Lower case, no port, no trailing dot ("Links.Example.com.:8443" -> "links.example.com"). */
function bare(host: string): string {
  const lowered = host
    .trim()
    .toLowerCase()
    .replace(/:\d{1,5}$/, "");
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
}

export function mediaHostAllowed(
  host: string,
  rootDomain: string = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN,
): boolean {
  const { kind } = classifyHost(host, rootDomain);
  if (kind === "marketing" || kind === "app" || kind === "tenant") return true;
  if (kind === "www") return false;

  // "custom": whatever classifyHost could not place under the root. Under the root it is one of the
  // refused shapes above (the wrong port is "custom" too, so the root's bare name is compared).
  const name = bare(host);
  const root = bare(rootDomain);
  if (root !== "" && (name === root || name.endsWith(`.${root}`))) return false;
  return name.length <= 253 && HOSTNAME_PATTERN.test(name);
}
