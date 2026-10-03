"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The editor header's "Preview" link (M6-11): opens the owner's draft preview, /preview/{pageId}, in
 * a new tab. It is a real link (`target="_blank"`, `rel="noopener"`), and a plain click first writes
 * the pending edits, as Publish does, so the new tab is never a step behind what was just typed:
 * the tab is opened inside the click (so a popup blocker allows it), and pointed at the preview once
 * `flush` has stored the newest edits. A modified click (Cmd, Ctrl, Shift, middle button) is left to
 * the browser. If the edits cannot be stored the preview still opens, showing the last saved draft.
 */
export function PreviewLink({
  href,
  flush,
  className,
  children,
}: {
  href: string;
  flush: () => Promise<boolean>;
  className: string;
  children: ReactNode;
}) {
  async function open(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    const tab = window.open("about:blank", "_blank");
    try {
      await flush();
    } catch {
      // The preview shows the last saved draft.
    }
    if (tab && !tab.closed) {
      tab.opener = null;
      tab.location.href = new URL(href, window.location.href).toString();
    } else {
      window.open(href, "_blank", "noopener");
    }
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      onClick={(event) => void open(event)}
      className={className}
    >
      {children}
    </a>
  );
}
