import { KNOWN_CLIENT_IDS, VENDORS } from "./known-clients";
import { parseRedirectUri } from "./redirect-uri";

/**
 * The return-address hosts of a blocked app (Wave N admin security review, finding 1).
 *
 * "Revoke for everyone" (M13-10) marks one client id blocked, and a registered app can post to
 * /oauth/register again for a new id. So blocking an app also records the hosts it returns to
 * (`oauth_blocked_hosts`), and the register and authorize endpoints refuse a client whose return
 * address is on one. What is recorded:
 *
 *   - the host of every https return address, lower case (a loopback address has no host to record: a
 *     loopback-only app can be blocked by its id only, docs/PLAN.md, Decided);
 *   - never a host of the known clients or their vendors (`protectedHosts`), nor a subdomain of one,
 *     so blocking one Claude connector can never block claude.ai for everybody.
 */

/** Hosts that can never be recorded: the vendors' own sites and the hosts of the known clients. */
export function protectedHosts(): string[] {
  const hosts = new Set<string>();
  for (const vendor of VENDORS) for (const host of vendor.hosts) hosts.add(host.toLowerCase());
  for (const id of KNOWN_CLIENT_IDS) {
    try {
      hosts.add(new URL(id).hostname.toLowerCase());
    } catch {
      // A malformed constant would be a bug caught by the known-clients tests.
    }
  }
  return [...hosts];
}

/** The lower-case hosts of the https (not loopback) return addresses, without repeats. */
export function redirectHosts(uris: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const uri of uris) {
    const parsed = parseRedirectUri(uri);
    if (parsed.ok && !parsed.loopback) hosts.add(parsed.host.toLowerCase());
  }
  return [...hosts];
}

/** The hosts a block records: the return hosts minus the protected ones (and their subdomains). */
export function hostsToBlock(uris: readonly string[]): string[] {
  const protectedList = protectedHosts();
  return redirectHosts(uris).filter(
    (host) => !protectedList.some((guard) => host === guard || host.endsWith(`.${guard}`)),
  );
}
