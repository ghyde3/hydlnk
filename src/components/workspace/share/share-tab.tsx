"use client";

import { useEffect } from "react";
import { ShareCard } from "@/components/editor/share-card";
import { useWorkspace } from "../workspace-context";
import { AddressCard } from "./address-card";
import { ConnectCard } from "./connect-card";
import { HistoryCard } from "./history-card";
import { LinkTrackingCard } from "./link-tracking-card";
import { PreviewLinksCard } from "./preview-links-card";
import { QrCard } from "./qr-card";
import { RedirectCard } from "./redirect-card";

/** The first control of a Share card the toolbar's menus ask to focus: 'Create link' or 'Download PNG'. */
function focusSection(id: string): boolean {
  const card = document.getElementById(id);
  if (!card) return false;
  // A card may name its first control (the QR card's Style group comes before its downloads).
  const first =
    card.querySelector<HTMLElement>(
      "[data-share-first]:not([disabled]):not([aria-disabled='true'])",
    ) ?? card.querySelector<HTMLElement>("button:not([disabled]):not([aria-disabled='true'])");
  if (first) {
    first.scrollIntoView({ block: "center" });
    first.focus({ preventScroll: true });
  } else {
    card.scrollIntoView({ block: "center" });
  }
  return true;
}

/**
 * Focuses a card's first control, and again a moment later. Going to `/share#qr` is a navigation:
 * once it has rendered, Next.js scrolls to the element with that id and focuses it, which would
 * leave focus on the card instead of its button. Whatever lands on the card itself (or nowhere) is
 * moved on to the button.
 */
function focusSectionSoon(id: string, done: () => void): () => void {
  const card = () => document.getElementById(id);
  const settle = () => {
    const active = document.activeElement;
    const element = card();
    if (!element || (active && active !== document.body && active !== element)) return;
    focusSection(id);
  };
  focusSection(id);
  const frame = requestAnimationFrame(() => requestAnimationFrame(settle));
  const timers = [
    setTimeout(settle, 120),
    setTimeout(() => {
      settle();
      done();
    }, 400),
  ];
  return () => {
    cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
  };
}

const SECTIONS = ["preview-links", "qr"] as const;

/**
 * The Share tab (M7-04): everything about how the page reaches other people, in one column beside
 * the shared preview: its address, the share card (title, description and image of the link
 * preview), redirect mode (M9-32), link tracking (M9-28), the QR code, private preview links and, on a phone, version history, then a pointer to the Claude and
 * ChatGPT connector's setup page (M10-34). All of it reads
 * and writes through the workspace (`useWorkspace`): the share card edits `draft.share` with the
 * one autosave and the one history, and this tab calls no endpoint but the draft save, the shared
 * upload route and the three preview-link actions.
 *
 * `/share#preview-links` and `/share#qr` (the toolbar's menus) focus the first control of that card
 * once the tab is on screen, whether you were already here or arrived from another tab, and so does
 * a page load with that hash.
 */
export function ShareTab() {
  const { state, dispatch, primaryDomain, address, liveOgUrl, shareFocus, clearShareFocus } =
    useWorkspace();
  const { draft } = state;

  const wanted = shareFocus?.target ?? null;
  const nonce = shareFocus?.nonce ?? null;
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    const target = wanted ?? SECTIONS.find((section) => section === fromHash) ?? null;
    if (target === null) return;
    return focusSectionSoon(target, () => {
      if (nonce !== null) clearShareFocus(nonce);
    });
  }, [wanted, nonce, clearShareFocus]);

  return (
    <>
      <AddressCard />
      <RedirectCard />
      <ShareCard
        share={draft.share}
        name={draft.profile.name}
        bio={draft.profile.bio}
        host={primaryDomain ?? address}
        liveOgUrl={liveOgUrl}
        errors={state.publishErrors}
        focus={state.focus}
        dispatch={dispatch}
      />
      <LinkTrackingCard />
      <QrCard />
      <PreviewLinksCard />
      <HistoryCard />
      <ConnectCard />
    </>
  );
}
