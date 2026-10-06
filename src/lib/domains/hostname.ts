import { HANDLE_DISPLAY_DOMAIN } from "@/lib/handles/rules";

/**
 * The one hostname validator of the custom-domains feature (M4-11). Pure: no server-only import, no
 * Node API (it uses the platform's URL parser for punycode, which browsers and Node share), so the
 * server actions and the Domain input's inline error run exactly the same code.
 *
 * `normalizeHostname` turns what the owner typed into what is stored: lower case, no trailing dot,
 * punycode for an internationalised name. It refuses anything that is not a plain domain name before
 * a row or a Vercel call exists: a URL, a path, a port, spaces, a wildcard, an underscore, a single
 * label, an IP address, a name longer than 253 characters or with a label over 63, a HYDLNK address,
 * a *.vercel.app address and local names. The final shape check is the database's own
 * `domains_hostname_format` regex, so a name this function accepts can never fail that constraint.
 *
 * Every refusal has code `invalid_hostname` and a message that says what to do.
 */

/** Same pattern as the `domains_hostname_format` check constraint (init migration). */
export const HOSTNAME_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export const HOSTNAME_MAX_LENGTH = 253;
export const LABEL_MAX_LENGTH = 63;

export type HostnameResult =
  | { ok: true; hostname: string }
  | { ok: false; code: "invalid_hostname"; message: string };

const MESSAGES = {
  empty: "Enter the domain you want to connect, like links.example.com.",
  justTheDomain: "Enter just the domain, like links.example.com.",
  characters:
    "That doesn’t look like a domain name. Use letters, numbers and hyphens, like links.example.com.",
  singleLabel: "Enter a full domain, like links.example.com.",
  ip: "Use a domain name, not an IP address, like links.example.com.",
  hydlnk: "That is a HYDLNK address. Use a domain you own.",
  vercel: "That is a Vercel address. Use a domain you own.",
  local: "That is a local address. Use a domain you own.",
  tooLong: "That domain is too long. Domain names can be up to 253 characters.",
  labelTooLong: "Each part of a domain can be up to 63 characters. Shorten it.",
} as const;

const refuse = (message: string): HostnameResult => ({
  ok: false,
  code: "invalid_hostname",
  message,
});

function isUnder(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export interface NormalizeOptions {
  /**
   * NEXT_PUBLIC_ROOT_DOMAIN ("localhost:3000", "hydlnk.com"): that host and everything under it is
   * refused too. Optional: hydlnk.com is always refused.
   */
  rootDomain?: string;
}

export function normalizeHostname(input: unknown, options: NormalizeOptions = {}): HostnameResult {
  if (typeof input !== "string") return refuse(MESSAGES.empty);
  const typed = input.trim();
  if (typed === "") return refuse(MESSAGES.empty);
  // Longer than any name could be even in Unicode form: cheap guard before any parsing.
  if (typed.length > HOSTNAME_MAX_LENGTH * 4) return refuse(MESSAGES.tooLong);

  // A scheme, path, query, port, credentials, a wildcard or whitespace: not "just the domain".
  if (/[\s/\\?#@:*]/.test(typed)) return refuse(MESSAGES.justTheDomain);

  // One trailing dot is the fully qualified spelling of the same name.
  const withoutDot = typed.endsWith(".") ? typed.slice(0, -1) : typed;
  const lower = withoutDot.toLowerCase();
  if (lower === "" || lower.startsWith(".") || lower.includes("..")) {
    return refuse(MESSAGES.characters);
  }
  // Letters (any script), digits, hyphens and dots. An underscore or a symbol is out.
  if (!/^[\p{L}\p{N}.-]+$/u.test(lower)) return refuse(MESSAGES.characters);
  // An IPv4 address in any notation (1.2.3.4, 0x7f.1, 2130706433): its last label is a number, and
  // a real top-level domain never is. Checked before the URL parser, which refuses some of them.
  const lastTyped = lower.slice(lower.lastIndexOf(".") + 1);
  if (/^[0-9]+$/.test(lastTyped) || /^0x[0-9a-f]*$/.test(lastTyped)) return refuse(MESSAGES.ip);
  if (!lower.includes(".")) return refuse(MESSAGES.singleLabel);

  // Punycode through the platform's IDNA implementation (it also folds width variants and the like).
  let ascii: string;
  try {
    ascii = new URL(`http://${lower}`).hostname;
  } catch {
    return refuse(MESSAGES.characters);
  }
  ascii = ascii.endsWith(".") ? ascii.slice(0, -1) : ascii;
  if (ascii === "" || !/^[a-z0-9.-]+$/.test(ascii)) return refuse(MESSAGES.characters);

  if (ascii.length > HOSTNAME_MAX_LENGTH) return refuse(MESSAGES.tooLong);
  const labels = ascii.split(".");
  if (labels.some((label) => label === "" || label.length > LABEL_MAX_LENGTH)) {
    return refuse(labels.some((label) => label === "") ? MESSAGES.characters : MESSAGES.labelTooLong);
  }

  // Our own and local names, before the IP check so "hydlnk.com" says what it is.
  if (isUnder(ascii, HANDLE_DISPLAY_DOMAIN)) return refuse(MESSAGES.hydlnk);
  const root = (options.rootDomain ?? "").split(":")[0]?.toLowerCase() ?? "";
  if (root !== "" && root.includes(".") && isUnder(ascii, root)) return refuse(MESSAGES.hydlnk);
  if (isUnder(ascii, "vercel.app")) return refuse(MESSAGES.vercel);
  if (labels[labels.length - 1] === "localhost") return refuse(MESSAGES.local);

  if (/^[0-9]+$/.test(labels[labels.length - 1]!)) return refuse(MESSAGES.ip);

  if (!HOSTNAME_PATTERN.test(ascii)) return refuse(MESSAGES.characters);
  return { ok: true, hostname: ascii };
}
