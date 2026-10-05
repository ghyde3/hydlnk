"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { checkDomainAction, removeDomainAction, setDomainPageAction } from "@/lib/domains/actions";
import type { DomainView } from "@/lib/domains/types";
import { pageOptionLabel, type PageOption } from "./page-options";
import { RecordsBlock } from "./records-block";
import { StatusChip } from "./status-chip";
import { StepList } from "./step-list";
import { DANGER, FIELD, PRIMARY, SECONDARY } from "./ui";
import { isDomainView, useDomainPolling } from "./use-domain-polling";
import {
  CHECK_FAILED,
  CHECK_PENDING_LINE,
  REMOVE_FAILED,
  SERVES_FAILED,
  UNKNOWN_DOMAIN,
  UNPUBLISHED_HINT,
  mergeDomainView,
  statusLineFor,
  stepsFor,
} from "./view-model";

const SAVED_MS = 6000;

/**
 * One custom domain (Domains.dc.html): its hostname, the "Serves" select, the status chip, the
 * three-step setup list with the DNS records, and the footer with "Check DNS now" (or "Open
 * {hostname}" once live) and "Remove domain". Each domain is its own card.
 *
 * What it does, all through the server actions and the polling route (the server decides, this
 * only shows):
 *   - "Check DNS now" (M4-15) runs the verify routine; a pending answer leaves a status line under
 *     the buttons, a verified one flips the card to the live state in place;
 *   - a pending card polls GET /api/domains/{id} (10 s, then 30 s, paused while hidden, off after
 *     30 minutes) so a flip found by the sweep appears without a reload;
 *   - "Serves" (M4-16) saves the page choice and says "Saved";
 *   - "Remove domain" (M4-17) asks inline first (Escape or "Keep domain" closes it and returns
 *     focus to the button that opened it).
 * A suspended account sees every control disabled; the server refuses the writes regardless.
 */
export function DomainCard({
  domain: initial,
  pages,
  stale,
}: {
  domain: DomainView;
  pages: PageOption[];
  /** Pending for 48 hours or more (decided on the server, from created_at). */
  stale: boolean;
}) {
  const router = useRouter();
  const suspended = useAccountSuspended();
  const [domain, setDomain] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // A fresh server render (after an add, a remove or a refresh) replaces what the card holds.
  if (initial !== seen) {
    setSeen(initial);
    setDomain(initial);
  }

  const [, startTransition] = useTransition();
  const [checking, setChecking] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const live = domain.status === "verified";
  const steps = stepsFor({
    status: domain.status,
    hostname: domain.hostname,
    stale,
    apexName: domain.apex?.name ?? null,
    recordCount: domain.records.length,
  });

  useDomainPolling({
    id: domain.id,
    enabled: domain.status === "pending",
    onState: (next) => {
      setDomain((current) => mergeDomainView(current, next));
      if (next.status !== "pending") setLine(null);
      else if (next.message) setLine(statusLineFor(next));
    },
  });

  /** A fresh read of this domain from the polling route (the same answer the poll gets). */
  async function readDomain(): Promise<DomainView | null> {
    try {
      const response = await fetch(`/api/domains/${encodeURIComponent(domain.id)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body: unknown = response.ok ? await response.json().catch(() => null) : null;
      return isDomainView(body) ? body : null;
    } catch {
      return null;
    }
  }

  async function check() {
    if (checking || suspended) return;
    setChecking(true);
    setLine(null);
    try {
      const result = await checkDomainAction(domain.id);
      if (result.ok) {
        const next = result.domain ?? (await readDomain()) ?? domain;
        setDomain((current) => mergeDomainView(current, next));
        setLine(statusLineFor(next) ?? (next.status === "verified" ? null : CHECK_PENDING_LINE));
      } else if (result.error === "not_found") {
        // Removed somewhere else: the list is stale, not the check.
        startTransition(() => router.refresh());
      } else if (result.error === "domain_expired") {
        // Pending for more than 7 days: the server released it. Say so, then let the list catch up.
        setLine(result.message);
        window.setTimeout(() => startTransition(() => router.refresh()), 4000);
      } else {
        setLine(CHECK_FAILED);
      }
    } catch {
      setLine(CHECK_FAILED);
    } finally {
      setChecking(false);
    }
  }

  /** "Try again" under the records: asks the polling route for a fresh read of the records. */
  async function retryRecords() {
    if (retrying) return;
    setRetrying(true);
    const next = await readDomain();
    if (next) setDomain((current) => mergeDomainView(current, next));
    setRetrying(false);
  }

  // ---- Serves ----
  const [serves, setServes] = useState(domain.pageId);
  const [servesSeen, setServesSeen] = useState(domain.pageId);
  if (domain.pageId !== servesSeen) {
    setServesSeen(domain.pageId);
    setServes(domain.pageId);
  }
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [servesError, setServesError] = useState<string | null>(null);
  const savedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );
  const servesId = useId();
  const servesHintId = useId();
  const target = pages.find((page) => page.id === serves);

  async function changePage(pageId: string) {
    if (pageId === serves || saving || suspended) return;
    const previous = serves;
    setServes(pageId);
    setSaving(true);
    setSaved(false);
    setServesError(null);
    try {
      const result = await setDomainPageAction(domain.id, pageId);
      if (result.ok) {
        setDomain((current) => ({ ...current, pageId }));
        setSaved(true);
        if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_MS);
      } else {
        setServes(previous);
        if (result.error === "not_found") startTransition(() => router.refresh());
        setServesError(result.error === "not_found" ? UNKNOWN_DOMAIN : SERVES_FAILED);
      }
    } catch {
      setServes(previous);
      setServesError(SERVES_FAILED);
    } finally {
      setSaving(false);
    }
  }

  // ---- Remove ----
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const confirmId = useId();

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  function closeConfirm() {
    if (removing) return;
    returnFocus.current = true;
    setConfirming(false);
    setRemoveError(null);
  }

  async function remove() {
    if (removing || suspended) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const result = await removeDomainAction(domain.id);
      if (result.ok) {
        // The card goes with the next render of the page; the usage line and the form follow it.
        startTransition(() => router.refresh());
        return;
      }
      if (result.error === "not_found") {
        startTransition(() => router.refresh());
        return;
      }
      setRemoveError(result.error === "rate_limited" ? result.message : REMOVE_FAILED);
    } catch {
      setRemoveError(REMOVE_FAILED);
    }
    setRemoving(false);
  }

  const disabledTitle = suspended ? SUSPENDED_REASON : undefined;

  return (
    <article
      data-domain-card={domain.hostname}
      data-domain-status={domain.status}
      aria-label={domain.hostname}
      className="overflow-hidden rounded-md border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-b border-line bg-page px-4 py-3.5 hl:px-5">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2.5 hl:flex-row hl:flex-wrap hl:items-center hl:gap-x-4">
          <h3
            data-domain-hostname
            className="min-w-0 font-mono text-[17px] font-normal [overflow-wrap:anywhere]"
          >
            {domain.hostname}
          </h3>
          <div className="flex flex-col gap-1.5 hl:flex-row hl:items-center hl:gap-2">
            <label htmlFor={servesId} className="text-[13px] text-text-2">
              Serves
            </label>
            <div className="flex items-center gap-2.5">
              <select
                id={servesId}
                value={serves}
                disabled={saving || suspended}
                title={disabledTitle}
                aria-describedby={target && !target.published ? servesHintId : undefined}
                onChange={(event) => void changePage(event.target.value)}
                className={`${FIELD} min-w-0 flex-1 hl:w-auto hl:max-w-64 hl:flex-none`}
              >
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {pageOptionLabel(page)}
                  </option>
                ))}
              </select>
              <span
                role="status"
                className={saved ? "text-xs font-medium whitespace-nowrap text-good" : undefined}
              >
                {saved ? "Saved" : null}
              </span>
            </div>
          </div>
          {servesError ? (
            <p role="alert" className="basis-full text-[13px] text-bad">
              {servesError}
            </p>
          ) : null}
          {target && !target.published ? (
            <p
              id={servesHintId}
              data-unpublished-hint
              className="basis-full text-[13px] leading-normal text-text-2"
            >
              {UNPUBLISHED_HINT}
            </p>
          ) : null}
        </div>
        <StatusChip status={domain.status} />
      </div>

      <StepList
        steps={steps}
        extra={
          live ? null : (
            <RecordsBlock
              records={domain.records}
              unavailable={domain.recordsUnavailable}
              apex={domain.apex}
              retrying={retrying}
              onRetry={() => void retryRecords()}
            />
          )
        }
      />

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3.5 hl:px-5">
        <div className="flex flex-col gap-2 hl:flex-row hl:items-center">
          {live ? (
            <a
              href={`https://${domain.hostname}`}
              target="_blank"
              rel="noopener"
              className={`${PRIMARY} w-full hl:w-auto`}
            >
              Open {domain.hostname}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking || suspended}
              aria-busy={checking || undefined}
              title={disabledTitle}
              className={`${PRIMARY} w-full hl:w-auto`}
            >
              {checking ? "Checking…" : "Check DNS now"}
            </button>
          )}
          <span aria-hidden="true" className="hidden flex-1 hl:block" />
          {confirming ? null : (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setConfirming(true)}
              disabled={suspended}
              title={disabledTitle}
              className={`${DANGER} w-full hl:w-auto`}
            >
              Remove domain
            </button>
          )}
        </div>

        {confirming ? (
          <div
            role="group"
            aria-labelledby={confirmId}
            data-remove-confirm
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeConfirm();
              }
            }}
            className="flex flex-col gap-3 rounded-md border border-line-2 bg-page p-3.5 hl:flex-row hl:items-center hl:justify-between"
          >
            <p id={confirmId} className="min-w-0 text-sm [overflow-wrap:anywhere]">
              Remove {domain.hostname}? Visitors will no longer reach your site there.
            </p>
            <div className="flex flex-col gap-2 hl:flex-row hl:shrink-0">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={removing || suspended}
                aria-busy={removing || undefined}
                className={`${DANGER} w-full hl:w-auto`}
              >
                Remove domain
              </button>
              <button
                ref={keepRef}
                type="button"
                onClick={closeConfirm}
                disabled={removing}
                className={`${SECONDARY} w-full hl:w-auto`}
              >
                Keep domain
              </button>
            </div>
          </div>
        ) : null}
        {removeError ? (
          <p role="alert" className="text-[13px] leading-normal text-bad">
            {removeError}
          </p>
        ) : null}
        <p
          role="status"
          data-check-line
          className="text-[13px] leading-normal text-text-2 empty:-mt-2"
        >
          {line}
        </p>
      </div>
    </article>
  );
}
