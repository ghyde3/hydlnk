"use client";

import { useRouter } from "next/navigation";
import { useId, type MouseEvent } from "react";
import { useAccountPlan } from "@/components/versions/plan-context";
import { PLAN_LIMITS } from "@/lib/limits";
import { HISTORY_ROUTE } from "@/lib/versions/messages";
import { useWorkspace } from "../workspace-context";
import { CARD, CARD_TITLE, SECONDARY_BUTTON } from "./styles";

/**
 * "Version history" on a phone (M7-04): below 760px the toolbar has no '⋯' menu, so the Share tab
 * ends with this card, a sentence and a 44px link to /editor/history. A plain click first writes
 * the pending edits (the same flush Publish and Preview use), so the screen it opens never reads a
 * draft that is a step behind what was just typed; a modified click is left to the browser. A
 * Free account sees the brass-soft 'Pro' chip beside the words, because that is where history
 * starts. From 760px up the card is not rendered: 'Version history' is in the '⋯' menu.
 */
export function HistoryCard() {
  const router = useRouter();
  const plan = useAccountPlan();
  const { autosave, isDesktop } = useWorkspace();
  const headingId = useId();
  if (isDesktop) return null;
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
      await autosave.flush();
    } catch {
      // The screen reads the last saved draft.
    }
    router.push(HISTORY_ROUTE);
  }

  return (
    <section aria-labelledby={headingId} data-testid="history-card" className={CARD}>
      <h2 id={headingId} className={CARD_TITLE}>
        Version history
      </h2>
      <p className="m-0 text-sm leading-relaxed text-text-2">
        Look back at what you published and restore a version.
      </p>
      <div>
        <a
          href={HISTORY_ROUTE}
          onClick={(event) => void open(event)}
          data-history-link=""
          className={`${SECONDARY_BUTTON} gap-2`}
        >
          Open version history
          {needsPro ? (
            <span
              data-history-pro-chip=""
              className="inline-block rounded-sm bg-brass-soft px-1.5 py-[2px] font-mono text-[11px] font-normal text-brass-soft-text"
            >
              Pro
            </span>
          ) : null}
        </a>
      </div>
    </section>
  );
}
