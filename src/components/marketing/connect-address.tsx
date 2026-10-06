"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The connector address in a mono block with a "Copy" button (M10-34): the only script on the
 * /connect page. The address comes from the server as a prop. A browser that blocks clipboard
 * access gets the address selected, so a manual copy is one keystroke. The block wraps inside
 * itself on a phone and sits on one line with its button from 560px.
 */
export function ConnectorAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const addressRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const node = addressRef.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-7">
      <p className="font-mono text-[11px] tracking-[0.08em] text-text-2 uppercase">
        Connector address
      </p>
      <div className="mt-2 flex flex-col gap-3 rounded-md border border-line-3 bg-page p-3 min-[560px]:flex-row min-[560px]:items-center">
        <code
          ref={addressRef}
          data-testid="connector-address"
          className="min-w-0 flex-1 px-1 font-mono text-[15px] leading-snug text-ink select-all [overflow-wrap:anywhere]"
        >
          {address}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-[18px] text-sm font-semibold text-ink hover:border-ink min-[560px]:w-auto"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Address copied." : ""}
      </span>
    </div>
  );
}
