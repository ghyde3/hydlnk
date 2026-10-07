"use client";

import { useEffect, useId, useRef, useState } from "react";
import { UnpublishDialog } from "../unpublish-dialog";
import { useWorkspace } from "../workspace-context";
import { CARD, CARD_TITLE, DANGER_BUTTON, SECONDARY_BUTTON } from "./styles";

export const NOT_PUBLISHED_ADDRESS_NOTE = "Not published yet. Publish to turn this address on.";

/**
 * "Your page address" (M7-04): the address the QR code encodes (`publicAddress`, decided on the
 * server: the primary custom domain, else the handle's origin), in Geist Mono, with a 'Copy link'
 * button and, once the page has been published, an 'Open page' link. A page that was never
 * published says so and has no link to open. Publishing from the toolbar in the same session
 * changes the line and the link at once: `hasPublished` is the workspace's own state.
 *
 * Reads only what the server passed in: never `location` or a query string.
 */
export function AddressCard() {
  const { publicAddress, hasPublished } = useWorkspace();
  const headingId = useId();
  const addressRef = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const unpublishRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicAddress);
    } catch {
      // No clipboard access: select the address so a manual copy is one keystroke.
      const node = addressRef.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section aria-labelledby={headingId} id="address" data-testid="address-card" className={CARD}>
      <h2 id={headingId} className={CARD_TITLE}>
        Your page address
      </h2>
      <p
        ref={addressRef}
        data-testid="page-address"
        className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]"
      >
        {publicAddress}
      </p>
      {hasPublished ? null : (
        <p className="m-0 text-[13px] text-text-2">{NOT_PUBLISHED_ADDRESS_NOTE}</p>
      )}
      <div className="flex flex-col gap-2 hl:flex-row">
        <button type="button" onClick={() => void copy()} className={SECONDARY_BUTTON}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {hasPublished ? (
          <a href={publicAddress} target="_blank" rel="noopener" className={SECONDARY_BUTTON}>
            Open page
          </a>
        ) : null}
        {hasPublished ? (
          // The toolbar's More actions menu holds Unpublish from 760px up; on a phone the menus
          // are not drawn, so the Share tab carries it.
          <button
            ref={unpublishRef}
            type="button"
            data-testid="address-unpublish"
            onClick={() => setConfirming(true)}
            className={`${DANGER_BUTTON} hl:hidden`}
          >
            Unpublish
          </button>
        ) : null}
      </div>
      <UnpublishDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onCloseFocus={() => unpublishRef.current?.focus()}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied." : ""}
      </span>
    </section>
  );
}
