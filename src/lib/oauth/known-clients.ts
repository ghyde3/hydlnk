import { foldName } from "./client-name";
import { parseRedirectUri } from "./redirect-uri";
import { TEST_STUB_ORIGIN } from "./ssrf";

/**
 * The clients this server knows by name (Wave L security review, findings 2 to 4), in one place.
 *
 * Three things hang off it:
 *
 *   - the three real client-metadata documents (Claude, Claude Code, ChatGPT), whose addresses are
 *     fixed by the vendors and are the clients nearly every person connects with. They are never
 *     counted against the document-host or service-wide fetch limits (cimd.ts), because any caller
 *     can make a made-up path on their host a cache miss and spend those budgets, and they are the
 *     only clients whose errors may be sent back to their return address before anyone has answered
 *     (authorize.ts), which keeps the authorize endpoint from acting as a redirector for a client
 *     that anyone can create;
 *   - the vendor names a client may not use unless it really returns to that vendor (`namesVendor
 *     WithoutRight`), so a registered app cannot call itself "Claude" on a consent screen;
 *   - the end-to-end stub, known only while the test hooks are on.
 *
 * A client is "known" by its address alone. Nothing here is a secret and nothing here is read from a
 * request.
 */

export const KNOWN_CLIENT_IDS: readonly string[] = [
  "https://claude.ai/oauth/mcp-oauth-client-metadata",
  "https://claude.ai/oauth/claude-code-client-metadata",
  "https://chatgpt.com/oauth/client.json",
];

export interface KnownClientOptions {
  /** The end-to-end stub's address counts as known (only while the test hooks are on). */
  allowTestStub?: boolean;
}

export function isKnownClientId(clientId: string, options: KnownClientOptions = {}): boolean {
  if (KNOWN_CLIENT_IDS.includes(clientId)) return true;
  return (
    options.allowTestStub === true &&
    clientId.startsWith(`${TEST_STUB_ORIGIN}/`) &&
    clientId.length <= 2048 &&
    !/\s/.test(clientId)
  );
}

export interface Vendor {
  id: "anthropic" | "openai";
  /** Folded (lower case, no spaces, hyphens, dots or underscores): the words a name is searched for. */
  keywords: readonly string[];
  /** The hosts of the vendor's own sites: the only https return addresses its name may come with. */
  hosts: readonly string[];
}

export const VENDORS: readonly Vendor[] = [
  {
    id: "anthropic",
    keywords: ["claude", "anthropic"],
    hosts: ["claude.ai", "claude.com", "anthropic.com"],
  },
  {
    id: "openai",
    keywords: ["chatgpt", "openai"],
    hosts: ["chatgpt.com", "chat.openai.com", "platform.openai.com", "openai.com"],
  },
];

export const VENDOR_NAME_REFUSAL =
  "The name can’t include Claude, Anthropic, ChatGPT or OpenAI unless the app returns to that company’s own site.";

/**
 * Does `name` use a vendor's name without the right to? It does when it holds one of the vendor's
 * words (folded, so 'C-l-a-u-d-e' and 'Claude Code (my server)' count) and any of the client's return
 * addresses is neither on one of that vendor's own hosts nor on this computer. A client that returns
 * only to the vendor's site hands its code to the vendor, and one that returns only to localhost hands
 * it to a program on the person's own machine, so neither can use the name to collect a code for
 * someone else. Everything else, a registered app or a metadata document on any other host, is
 * refused: it is the shape of a consent-phishing page.
 */
export function namesVendorWithoutRight(name: string, redirectUris: readonly string[]): boolean {
  const folded = foldName(name);
  for (const vendor of VENDORS) {
    if (!vendor.keywords.some((word) => folded.includes(word))) continue;
    const allReturnHome =
      redirectUris.length > 0 &&
      redirectUris.every((uri) => {
        const parsed = parseRedirectUri(uri);
        return parsed.ok && (parsed.loopback || vendor.hosts.includes(parsed.host.toLowerCase()));
      });
    if (!allReturnHome) return true;
  }
  return false;
}
