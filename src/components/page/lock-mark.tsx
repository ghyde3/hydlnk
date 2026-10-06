import { LOCK_HIDDEN_TEXT, lockMarker, type LockKind } from "@/lib/document";
import type { OutboundAttrs } from "./outbound";

/**
 * The mark of a locked link (M9-30): what the shared renderer adds to a link block that has a lock.
 * No library, no client code: an inline SVG padlock (16px, decorative, `currentColor`) at the end
 * edge of the button and visually hidden words after the label (' (sensitive content)' or
 * ' (locked)'), so the accessible name is the label plus those words.
 *
 * The anchor keeps its `href` (`/r/<pageId>/<id>`) on the live page; the destination, the salt and
 * the hash are never in the markup. In the editor preview, the shared draft and the dock the same
 * link has the marker and no `href` at all (`lockedLinkAttrs`), so a private share link cannot be
 * used to get past the lock.
 */

/** The kind of lock a block carries, or null: only the two known words count. */
export function lockOf(block: { lock?: unknown }): LockKind | null {
  return lockMarker(block.lock);
}

/**
 * The anchor attributes of a locked link: the click redirect's `href` on the live page, none in a
 * preview or a thumbnail (an anchor without `href` goes nowhere).
 */
export function lockedLinkAttrs(
  attrs: OutboundAttrs,
  lock: LockKind | null,
  inert: boolean,
): OutboundAttrs {
  return lock !== null && inert ? { ...attrs, href: undefined } : attrs;
}

/** The hidden words and the padlock, as the last children of the link. */
export function LockMark({ kind }: { kind: LockKind }) {
  return (
    <>
      <span className="pg-lock-text">{LOCK_HIDDEN_TEXT[kind]}</span>
      <svg
        className="pg-lock-glyph"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </>
  );
}
