"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { PLAN_LIMITS } from "@/lib/limits";
import { HISTORY_ROUTE } from "@/lib/versions/messages";
import { useAccountPlan } from "./plan-context";

/**
 * The editor header's "History" link (M6-50): to the version history screen, on every plan. A
 * 13px/600 underlined text link like "View live page", 44px tall. An account whose plan keeps no
 * versions sees a brass-soft "Pro" chip beside the word, because that is where History starts.
 *
 * A plain click first writes the pending edits (the same flush Publish and Preview use), so the
 * screen it opens never reads a draft that is a step behind what was just typed. A modified click
 * (Cmd, Ctrl, Shift, middle button) is left to the browser.
 */
export function HistoryLink({ flush }: { flush: () => Promise<boolean> }) {
  const router = useRouter();
  const plan = useAccountPlan();
  const needsPro = plan !== null && PLAN_LIMITS[plan].versionsKept === 0;

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
    try {
      await flush();
    } catch {
      // The screen reads the last saved draft.
    }
    router.push(HISTORY_ROUTE);
  }

  return (
    <a
      href={HISTORY_ROUTE}
      onClick={(event) => void open(event)}
      data-history-link=""
      className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[13px] font-semibold text-ink underline underline-offset-2"
    >
      History
      {needsPro ? (
        <span
          data-history-pro-chip=""
          className="inline-block rounded-sm bg-brass-soft px-1.5 py-[2px] font-mono text-[11px] font-normal text-brass-soft-text no-underline"
        >
          Pro
        </span>
      ) : null}
    </a>
  );
}
