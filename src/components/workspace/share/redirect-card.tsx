"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, controlClass } from "@/components/blocks/field";
import {
  REDIRECT_GONE_MESSAGE,
  redirectOptions,
  type DraftDoc,
  type PublishDoc,
  type PublishError,
} from "@/lib/document";
import { withRedirect, withoutRedirect } from "@/lib/editor/link-fields";
import { PLAN_LIMITS } from "@/lib/limits/table";
import { useWorkspace } from "../workspace-context";
import { CARD, CARD_TITLE, SECONDARY_BUTTON } from "./styles";

export const REDIRECT_WARNING =
  "Your page won’t be shown while this is on. Visitors go straight to the link. Turn it off to show your page again.";
export const REDIRECT_FREE_NOTE = "Redirect mode is part of Pro.";
export const REDIRECT_DOWNGRADED_NOTE =
  "Your plan no longer includes redirect mode. Your page is shown normally.";
export const REDIRECT_NO_LINKS_NOTE = "Add a link block first.";
export const REDIRECT_DRAFT_NOTE = "Turned on in your draft. Publish to start.";

const gateMessage = (errors: readonly PublishError[], field: string): string | null =>
  errors.find((error) => error.blockId === null && error.field === field)?.message ?? null;

/** The label of the link a published redirect points at (a block of the published form), or null. */
function publishedTargetLabel(published: PublishDoc | null): string | null {
  const linkId = published?.redirect?.linkId;
  if (!linkId) return null;
  const block = published?.blocks.find((candidate) => candidate.id === linkId);
  return block && block.type === "link" ? block.label : "your link";
}

/** True when the draft's redirect still names a link the select would offer. */
function targetStillOffered(draft: DraftDoc): boolean {
  const linkId = draft.redirect?.linkId;
  return (
    linkId !== undefined && redirectOptions(draft.blocks).some((option) => option.id === linkId)
  );
}

/**
 * The 'Redirect mode' card of the Share tab (M9-32), under the address card. Pro and Studio see a
 * switch, 'Send visitors straight to one link', and a select of the page's eligible links (visible
 * link blocks with a valid address and no lock, each by its label, in page order); while the switch
 * is on a warning says the page is not shown. Free sees the card with a 'Pro' chip, the controls
 * `aria-disabled` and doing nothing, and a link to the plans. A Free account that holds `redirect`
 * (a downgrade) is told its page is shown normally and can turn the key off.
 *
 * Every change writes `draft.redirect` through the workspace (an undo step, autosave, 'Unpublished
 * changes') and reaches the live page only after Publish; the control only ever writes an id the
 * select offered. The Publish gate's sentences show under the exact control and take focus: the plan
 * sentence under the switch, the others under the select. Labels are drawn as text.
 */
export function RedirectCard() {
  const { draft, editDraft, plan, publishedForm, state } = useWorkspace();
  const headingId = useId();
  const warningId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const allowed = PLAN_LIMITS[plan].redirectMode;
  const options = useMemo(() => redirectOptions(draft.blocks), [draft.blocks]);
  const on = draft.redirect !== undefined;
  const offered = targetStillOffered(draft);

  // The link chosen in the form: remembered while the switch is off (it keeps the last one picked or
  // turned off, until reload) and replaced by the draft's own while the switch is on.
  const [chosen, setChosen] = useState(draft.redirect?.linkId ?? options[0]?.id ?? "");
  const fallback = options[0]?.id ?? "";
  const effective = options.some((option) => option.id === chosen) ? chosen : fallback;
  const selectValue = on ? draft.redirect!.linkId : effective;

  const errors = state.publishErrors;
  const planError = gateMessage(errors, "redirect");
  const linkError =
    gateMessage(errors, "redirect.linkId") ??
    (allowed && on && !offered ? REDIRECT_GONE_MESSAGE : null);

  // A failed Publish names this card: the plan sentence belongs under the switch, the rest under the select.
  const signal =
    planError !== null || gateMessage(errors, "redirect.linkId") !== null ? errors : null;
  useEffect(() => {
    if (signal === null) return;
    const control = planError !== null ? switchRef.current : selectRef.current;
    if (!control || document.activeElement === control) return;
    control.scrollIntoView({ block: "center" });
    control.focus({ preventScroll: true });
    // Only a new set of Publish errors asks for focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

  const noLinks = options.length === 0;
  const switchOff = !allowed || (noLinks && !on);

  function toggle(): void {
    if (!allowed) return;
    if (on) {
      setChosen(draft.redirect!.linkId);
      editDraft((current) => withoutRedirect(current), "redirect:toggle");
    } else if (effective !== "") {
      editDraft((current) => withRedirect(current, effective), "redirect:toggle");
    }
  }

  function pick(linkId: string): void {
    if (!allowed) return;
    setChosen(linkId);
    if (on) editDraft((current) => withRedirect(current, linkId), "redirect:link");
  }

  const liveLabel = publishedTargetLabel(publishedForm);
  const stateLine = liveLabel
    ? on && draft.redirect?.linkId === publishedForm?.redirect?.linkId
      ? `Visitors go straight to ${liveLabel}.`
      : on
        ? REDIRECT_DRAFT_NOTE
        : `Visitors still go straight to ${liveLabel}. Publish to show your page again.`
    : on
      ? REDIRECT_DRAFT_NOTE
      : null;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      id="redirect-mode"
      data-testid="redirect-card"
      className={CARD}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 id={headingId} className={CARD_TITLE}>
          Redirect mode
        </h2>
        {allowed ? null : (
          <span
            data-testid="redirect-pro-chip"
            className="inline-block rounded-sm bg-brass-soft px-1.5 py-[2px] font-mono text-[11px] font-normal text-brass-soft-text"
          >
            Pro
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <button
          ref={switchRef}
          type="button"
          role="switch"
          aria-checked={on}
          aria-disabled={switchOff ? true : undefined}
          aria-describedby={on ? warningId : undefined}
          data-testid="redirect-switch"
          onClick={() => {
            if (!switchOff) toggle();
          }}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          <span className="min-w-0">Send visitors straight to one link</span>
          <span
            aria-hidden="true"
            className={`relative block h-[18px] w-8 shrink-0 rounded-full ${on ? "bg-ink" : "bg-line-3"}`}
          >
            <span
              className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${on ? "left-4" : "left-0.5"}`}
            />
          </span>
        </button>
        <div aria-live="polite" className="empty:hidden">
          {planError ? (
            <p data-field="redirect" className="m-0 text-[13px] text-bad">
              {planError}
            </p>
          ) : null}
        </div>
      </div>

      {noLinks && !on ? (
        <p className="m-0 text-[13px] text-text-2" data-testid="redirect-no-links">
          {REDIRECT_NO_LINKS_NOTE}{" "}
          <Link href="/editor" className="underline">
            Go to the Edit tab
          </Link>
          .
        </p>
      ) : (
        <Field label="Link" error={linkError}>
          {(control) => (
            <select
              {...control}
              ref={selectRef}
              value={selectValue}
              disabled={!allowed}
              aria-disabled={allowed ? undefined : true}
              data-field="redirect-link"
              onChange={(event) => pick(event.target.value)}
              className={controlClass(linkError !== null, "py-0")}
            >
              {on && !offered ? (
                <option value={draft.redirect!.linkId} disabled>
                  Unavailable link
                </option>
              ) : null}
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label === "" ? "Untitled link" : option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <div role={on ? "status" : undefined} id={warningId} className="empty:hidden">
        {on ? (
          <p data-testid="redirect-warning" className="m-0 text-[13px] text-text-2">
            {REDIRECT_WARNING}
          </p>
        ) : null}
      </div>

      {stateLine ? (
        <p data-testid="redirect-state" className="m-0 text-[13px] font-medium text-ink">
          {stateLine}
        </p>
      ) : null}

      {allowed ? null : on ? (
        <div className="flex flex-col gap-2">
          <p data-testid="redirect-downgraded" className="m-0 text-[13px] text-text-2">
            {REDIRECT_DOWNGRADED_NOTE}
          </p>
          <div>
            <button
              type="button"
              data-testid="redirect-turn-off"
              onClick={() => editDraft((current) => withoutRedirect(current), "redirect:toggle")}
              className={SECONDARY_BUTTON}
            >
              Turn off
            </button>
          </div>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-text-2">
          {REDIRECT_FREE_NOTE}{" "}
          <Link href="/settings#plans" className="underline">
            See plans
          </Link>
        </p>
      )}
    </section>
  );
}
