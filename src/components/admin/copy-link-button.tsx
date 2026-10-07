"use client";

import { useState } from "react";

/** Copies `url` to the clipboard and says so; if the browser refuses, the visible address can still be selected. */
export function CopyLinkButton({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy the ${label} link`}
      className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select the link" : "Copy link"}
    </button>
  );
}
