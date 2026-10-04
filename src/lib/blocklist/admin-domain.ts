import { browserHostOf, judgeHost } from "./published";

/**
 * Turning what an admin types at /admin/blocked-links (M7-12) into a `blocked_domains` row, and the
 * sentences that explain a refusal. Pure and client-safe: the server action and the form both use it,
 * so what the form accepts and what the server stores can never differ.
 *
 * A domain is read with the platform's URL parser, the same one the Publish check uses
 * (`browserHostOf`), so a pasted URL works and what is stored is what a browser would resolve:
 *
 *   'https://user:pw@Shop.Example.COM:8080/a?b#c'  ->  shop.example.com
 *   'EXAMPLE.com.'                                 ->  example.com
 *   'https://www.example.com/x'                    ->  example.com
 *   'xample.com' with a Cyrillic first letter  ->  xn--xample-2of.com  (punycode)
 *
 * The result has to satisfy the table's own `blocked_domains_normalized` check (lower case, letters,
 * digits, hyphens and dots, 1 to 253 characters) and contain a dot. A public-suffix list is out of
 * scope on purpose: 'co.uk' passes, so an admin types the whole domain they mean.
 */

/** Longest text the server will look at for either field: past this is not a mistake, it is abuse. */
export const DOMAIN_INPUT_MAX = 2048;
export const REASON_INPUT_MAX = 1000;
/** Longest stored reason (characters, as people count them). */
export const REASON_MAX = 120;
/** Longest domain a DNS name can be, and what the table's check allows. */
export const DOMAIN_MAX = 253;
/** The most live pages an add lists back to the admin. */
export const IMPACT_LIST_MAX = 100;

export const DOMAIN_MESSAGES = {
  empty: "Enter a domain, such as example.com.",
  oneLabel: "Use the full domain, such as example.com.",
  ip: "IP addresses are blocked already.",
  tooLong: "That domain is too long.",
} as const;

export const REASON_MESSAGES = {
  empty: "Add a reason so others know why.",
  tooLong: "Use 120 characters or fewer for the reason.",
  plain: "Use plain text for the reason.",
} as const;

/** A request the shape of which is wrong (not a string, far too long): the generic sentence. */
export const INVALID_REQUEST_MESSAGE = "That request isn’t valid.";
/** The server failed after the request was fine. */
export const FAILED_MESSAGE = "That didn’t work. Try again.";
export const alreadyBlockedMessage = (domain: string): string => `${domain} is already blocked.`;

/** The same rule as the table's `blocked_domains_normalized` check (the length is tested apart). */
const TABLE_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export type Normalized = { ok: true; value: string } | { ok: false; message: string };

/** The stored form of a typed domain or URL, or the sentence that says what is wrong with it. */
export function normalizeBlockedDomain(input: string): Normalized {
  const text = input.trim();
  if (text === "") return { ok: false, message: DOMAIN_MESSAGES.empty };
  // A bare domain gets a scheme so the URL parser can read it; a pasted URL is left as it is.
  const host = browserHostOf(HAS_SCHEME.test(text) ? text : `https://${text}`);
  if (host === null) return { ok: false, message: DOMAIN_MESSAGES.empty };
  if (host.length > DOMAIN_MAX) return { ok: false, message: DOMAIN_MESSAGES.tooLong };

  // One leading "www." goes, as long as a dot is left ('www.com' is a domain of its own).
  const domain = host.startsWith("www.") && host.slice(4).includes(".") ? host.slice(4) : host;

  const reason = judgeHost(domain, []);
  if (reason === "ip_literal") return { ok: false, message: DOMAIN_MESSAGES.ip };
  if (reason === "single_label") return { ok: false, message: DOMAIN_MESSAGES.oneLabel };
  if (reason !== null || !TABLE_SHAPE.test(domain)) {
    return { ok: false, message: DOMAIN_MESSAGES.empty };
  }
  return { ok: true, value: domain };
}

/** Control characters and the characters that reorder text (bidi), which a reason must not hold. */
const CONTROL_OR_BIDI =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** A reason is trimmed plain text, 1 to 120 characters. */
export function normalizeReason(input: string): Normalized {
  const reason = input.trim();
  if (reason === "") return { ok: false, message: REASON_MESSAGES.empty };
  if (CONTROL_OR_BIDI.test(reason)) return { ok: false, message: REASON_MESSAGES.plain };
  // Code points, not UTF-16 units: an emoji is one character to the person typing it.
  if ([...reason].length > REASON_MAX) return { ok: false, message: REASON_MESSAGES.tooLong };
  return { ok: true, value: reason };
}

/**
 * A domain read from a path segment to be removed: trimmed and lower-cased, and it has to be the
 * exact shape a stored entry has. Nothing is parsed as a URL here: the remove route only ever names
 * an entry that is already in the table.
 */
export function storedDomainOf(input: string): string | null {
  const domain = input.trim().toLowerCase();
  return domain.length >= 1 && domain.length <= DOMAIN_MAX && TABLE_SHAPE.test(domain)
    ? domain
    : null;
}

/** Which field of the form a refusal belongs under. Everything else is about the form as a whole. */
export function fieldOfMessage(message: string): "domain" | "reason" | "form" {
  if ((Object.values(REASON_MESSAGES) as string[]).includes(message)) return "reason";
  if ((Object.values(DOMAIN_MESSAGES) as string[]).includes(message)) return "domain";
  if (/ is already blocked\.$/.test(message)) return "domain";
  return "form";
}
