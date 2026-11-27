"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { FORM_BUTTON, controlClass } from "@/components/blocks/field";
import { PLAN_LIMITS, SCHEDULING_PLAN_MESSAGE, type PlanId } from "@/lib/limits";
import {
  formatLocal,
  localInputToUtc,
  utcToLocalInput,
  zoneLabel,
} from "@/lib/schedule/local-time";
import { SCHEDULE_TEST_IDS } from "@/lib/schedule/test-ids";
import {
  scheduleFailureText,
  type EntryScheduleSummary,
  type ScheduleAction,
} from "@/lib/schedule/types";

/**
 * Scheduling a page or a post (Wave E, M20-07, M20-09, M20-10): one set of controls for the post
 * editor's bar and a publish-bar page row. It shows where the schedule stands ("Scheduled for …",
 * "Didn't publish"), the note when the draft moved on since the snapshot, and a "Schedule" button
 * that opens a native modal <dialog> (as the editor's other confirmations) with "Publish at", an
 * optional "Unpublish at" (not for Home) and the zone line. Every time is drawn in the browser's zone
 * after mount and sent as a UTC instant. The caller does the request (it stores what is typed first
 * and holds the rev); a refusal comes back as its sentence and stays in the dialog.
 */

export interface ScheduleControlsProps {
  summary: EntryScheduleSummary;
  /** The entry's rev as this editor holds it: a pending publish taken at another rev has newer edits. */
  currentRev: number;
  /** A scheduled unpublish is offered (never for Home). */
  allowUnpublish: boolean;
  plan: PlanId;
  /** Nothing can be done (suspended, a conflict, another action running). */
  disabled: boolean;
  /** Schedule (or replace) one action; null when it went through, else the sentence to show. */
  onSchedule: (action: ScheduleAction, runAt: string) => Promise<string | null>;
  onCancel: (action: ScheduleAction) => Promise<string | null>;
}

function useLocalReady(): boolean {
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- local times are drawn after mount
  useEffect(() => setReady(true), []);
  return ready;
}

/** A minute-aligned default an hour from now, as a local input value. */
function defaultLocalInput(): string {
  const at = new Date(Math.ceil((Date.now() + 3_600_000) / 3_600_000) * 3_600_000);
  return utcToLocalInput(at.toISOString());
}

export function ScheduleControls(props: ScheduleControlsProps) {
  const { summary, currentRev, plan, disabled } = props;
  const ready = useLocalReady();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = PLAN_LIMITS[plan].scheduling;
  const zone = ready ? zoneLabel() : "";
  const at = (iso: string) => (ready ? `${formatLocal(iso)} (${zone})` : "");

  async function act(run: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      setError(await run());
    } finally {
      setBusy(false);
    }
  }

  const stale =
    summary.publishAt !== null && summary.scheduledRev !== null && summary.scheduledRev !== currentRev;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="schedule-controls">
      {summary.publishAt ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span data-testid="schedule-state" className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
            Scheduled to publish {at(summary.publishAt)}
          </span>
          <button
            type="button"
            data-testid={SCHEDULE_TEST_IDS.cancel}
            disabled={disabled || busy}
            onClick={() => void act(() => props.onCancel("publish"))}
            className={FORM_BUTTON}
          >
            Cancel schedule
          </button>
        </div>
      ) : null}
      {summary.unpublishAt ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span data-testid="schedule-unpublish-state" className="min-w-0 text-sm text-ink">
            Scheduled to unpublish {at(summary.unpublishAt)}
          </span>
          <button
            type="button"
            data-testid="schedule-cancel-unpublish"
            disabled={disabled || busy}
            onClick={() => void act(() => props.onCancel("unpublish"))}
            className={FORM_BUTTON}
          >
            Cancel unpublish
          </button>
        </div>
      ) : null}
      {stale && summary.publishAt ? (
        <div
          role="status"
          data-testid={SCHEDULE_TEST_IDS.note}
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-page px-3 py-2 text-sm text-ink-2"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Your scheduled version is from {summary.snapshotAt ? at(summary.snapshotAt) : "earlier"}.
            Newer edits are not scheduled.
          </span>
          <button
            type="button"
            data-testid={SCHEDULE_TEST_IDS.update}
            disabled={disabled || busy}
            onClick={() => void act(() => props.onSchedule("publish", summary.publishAt!))}
            className={FORM_BUTTON}
          >
            Update scheduled version
          </button>
        </div>
      ) : null}
      {summary.failed && !summary.publishAt ? (
        <p
          role="status"
          data-testid={SCHEDULE_TEST_IDS.failed}
          className="m-0 min-w-0 text-sm text-bad [overflow-wrap:anywhere]"
        >
          Didn’t publish: {scheduleFailureText(summary.failed)}
        </p>
      ) : null}
      {error && !open ? (
        <p role="alert" data-testid="schedule-error" className="m-0 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div>
        <button
          type="button"
          data-testid={SCHEDULE_TEST_IDS.open}
          disabled={disabled || busy}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className={FORM_BUTTON}
        >
          {summary.failed && !summary.publishAt
            ? "Schedule again"
            : summary.publishAt
              ? "Change schedule"
              : "Schedule"}
        </button>
      </div>
      <ScheduleDialog
        open={open}
        allowed={allowed}
        allowUnpublish={props.allowUnpublish}
        zone={zone}
        initial={summary}
        busy={busy}
        error={error}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        onConfirm={(publishAt, unpublishAt) =>
          void act(async () => {
            if (publishAt) {
              const refused = await props.onSchedule("publish", publishAt);
              if (refused) return refused;
            }
            if (unpublishAt) {
              const refused = await props.onSchedule("unpublish", unpublishAt);
              if (refused) return refused;
            }
            setOpen(false);
            return null;
          })
        }
      />
    </div>
  );
}

function ScheduleDialog(props: {
  open: boolean;
  allowed: boolean;
  allowUnpublish: boolean;
  zone: string;
  initial: EntryScheduleSummary;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (publishAt: string | null, unpublishAt: string | null) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const publishId = useId();
  const unpublishId = useId();
  const [publishAt, setPublishAt] = useState("");
  const [unpublishAt, setUnpublishAt] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      // The fields start from what is scheduled, or an hour from now.
      setPublishAt(props.initial.publishAt ? utcToLocalInput(props.initial.publishAt) : defaultLocalInput());
      setUnpublishAt(props.initial.unpublishAt ? utcToLocalInput(props.initial.unpublishAt) : "");
      dialog.showModal();
    }
    if (!props.open && dialog.open) dialog.close();
    // `initial` is read when the dialog opens only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const publishUtc = localInputToUtc(publishAt);
  const unpublishUtc = localInputToUtc(unpublishAt);
  const order =
    publishUtc && unpublishUtc && Date.parse(unpublishUtc) <= Date.parse(publishUtc)
      ? "Choose an unpublish time after the publish time."
      : null;

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="schedule-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!props.busy) props.onClose();
      }}
      // Escape closes this dialog only, not the publish bar it may sit in.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[420px] overflow-y-auto rounded-md border border-line bg-surface p-4 text-ink backdrop:bg-ink/60 hl:p-6"
    >
      {props.open ? (
        <form
          method="dialog"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!props.allowed || order) return;
            props.onConfirm(publishUtc, props.allowUnpublish ? unpublishUtc : null);
          }}
        >
          <h2 id={titleId} className="m-0 text-lg font-bold tracking-[-0.01em]">
            Schedule
          </h2>
          {props.allowed ? null : (
            <p data-testid="schedule-upgrade" className="m-0 text-sm text-text-2">
              {SCHEDULING_PLAN_MESSAGE}{" "}
              <Link href="/settings#plans" className="underline">
                See plans
              </Link>
            </p>
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={publishId} className="text-[13px] font-semibold text-ink-2">
              Publish at
            </label>
            <input
              id={publishId}
              type="datetime-local"
              step={60}
              data-testid={SCHEDULE_TEST_IDS.time}
              value={publishAt}
              disabled={!props.allowed}
              onChange={(event) => setPublishAt(event.target.value)}
              className={controlClass(false, "font-mono")}
            />
          </div>
          {props.allowUnpublish ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={unpublishId} className="text-[13px] font-semibold text-ink-2">
                Unpublish at (optional)
              </label>
              <input
                id={unpublishId}
                type="datetime-local"
                step={60}
                data-testid={SCHEDULE_TEST_IDS.unpublishTime}
                value={unpublishAt}
                disabled={!props.allowed}
                aria-invalid={order ? true : undefined}
                onChange={(event) => setUnpublishAt(event.target.value)}
                className={controlClass(order !== null, "font-mono")}
              />
            </div>
          ) : null}
          <p className="m-0 text-xs text-text-2">Times are in {props.zone}.</p>
          {order || props.error ? (
            <p role="alert" data-testid="schedule-dialog-error" className="m-0 text-sm text-bad">
              {order ?? props.error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              data-testid={SCHEDULE_TEST_IDS.confirm}
              disabled={!props.allowed || props.busy || (!publishUtc && !unpublishUtc) || order !== null}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.busy ? "Scheduling…" : "Schedule"}
            </button>
            <button type="button" onClick={props.onClose} disabled={props.busy} className={FORM_BUTTON}>
              Close
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
