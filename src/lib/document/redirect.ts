import { codePointLength, truncateToCodePoints } from "./limits";
import { lockMarker } from "./lock";
import { isHttpUrl } from "./url";

/**
 * Redirect mode (M9-31, M9-32): a page setting, `redirect: {linkId}`, that makes the live page answer
 * with a counted redirect to one link instead of showing the page. Pro and Studio only.
 *
 * This leaf module holds the wording and the pure rules the Publish gate, the editor's Share tab and
 * the tests share: which links are eligible and what is wrong with a chosen one. It imports nothing
 * from schema.ts at run time (the schema imports it). Safe in server and client code.
 */

export const REDIRECT_PICK_MESSAGE = "Pick a link from your page.";
export const REDIRECT_LOCKED_MESSAGE = "Pick a link that isn’t locked.";
export const REDIRECT_LOOP_MESSAGE = "A link back to this page can’t be used for redirect mode.";
/** Under the select in the editor when the chosen link was hidden, locked or removed since. */
export const REDIRECT_GONE_MESSAGE = "This link is no longer available for redirect mode.";

/** The longest label the select shows, in code points. */
export const REDIRECT_LABEL_MAX = 60;

/** The part of a block these rules read; a draft block and a published one both fit. */
interface BlockLike {
  id?: unknown;
  type?: unknown;
  visible?: unknown;
  url?: unknown;
  label?: unknown;
  lock?: unknown;
}

const asBlock = (value: unknown): BlockLike =>
  typeof value === "object" && value !== null ? (value as BlockLike) : {};

/** A link block that can be the target: visible, a valid http(s) address, no lock. */
export function isEligibleRedirectLink(value: unknown): boolean {
  const block = asBlock(value);
  return (
    block.type === "link" &&
    block.visible !== false &&
    typeof block.url === "string" &&
    isHttpUrl(block.url.trim()) &&
    lockMarker(block.lock) === null
  );
}

export interface RedirectOption {
  id: string;
  /** The link's label cut to 60 characters (empty when it has none). */
  label: string;
}

/** The links the Share tab's select offers, in page order, each by its label. */
export function redirectOptions(blocks: readonly unknown[]): RedirectOption[] {
  const options: RedirectOption[] = [];
  for (const raw of blocks) {
    const block = asBlock(raw);
    if (!isEligibleRedirectLink(block) || typeof block.id !== "string") continue;
    const label = typeof block.label === "string" ? block.label.trim() : "";
    options.push({
      id: block.id,
      label:
        codePointLength(label) > REDIRECT_LABEL_MAX
          ? truncateToCodePoints(label, REDIRECT_LABEL_MAX)
          : label,
    });
  }
  return options;
}

/**
 * What is wrong with `linkId` as the redirect target of a page with these (published-form) blocks,
 * or null when it is fine. `ownHosts` are the hostnames the page itself answers on (its handle host
 * and its verified custom domains, lower case, no port): a target on one of them would loop.
 *
 *   not a link block of the page, hidden, or without a valid address   'Pick a link from your page.'
 *   a locked link                                                      'Pick a link that isn’t locked.'
 *   a link back to this page                                           'A link back to this page ...'
 */
export function redirectTargetIssue(
  blocks: readonly unknown[],
  linkId: unknown,
  ownHosts: readonly string[] = [],
): string | null {
  if (typeof linkId !== "string") return REDIRECT_PICK_MESSAGE;
  const block = asBlock(blocks.find((candidate) => asBlock(candidate).id === linkId));
  if (
    block.type !== "link" ||
    block.visible === false ||
    typeof block.url !== "string" ||
    !isHttpUrl(block.url.trim())
  ) {
    return REDIRECT_PICK_MESSAGE;
  }
  if (lockMarker(block.lock) !== null) return REDIRECT_LOCKED_MESSAGE;
  let host: string;
  try {
    host = new URL(block.url.trim()).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return REDIRECT_PICK_MESSAGE;
  }
  if (ownHosts.some((own) => own.toLowerCase().replace(/\.+$/, "") === host)) {
    return REDIRECT_LOOP_MESSAGE;
  }
  return null;
}
