"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  SCHEDULE_MESSAGES,
  hasWindow,
  scheduleInstant,
  type Block,
  type BlockSchedule,
  type PublishError,
} from "@/lib/document";
import { PLAN_LIMITS, SCHEDULING_PLAN_MESSAGE, type PlanId } from "@/lib/limits";
import {
  localInputToUtc,
  utcToLocalInput,
  windowChipText,
  zoneLabel,
} from "@/lib/schedule/local-time";
import { SCHEDULE_TEST_IDS } from "@/lib/schedule/test-ids";
import { useMinuteClock } from "@/lib/schedule/use-minute-clock";
import { FORM_BUTTON, controlClass } from "../field";
import { fieldError } from "./types";

/**
 * A block's Schedule section (Wave E, M20-06): "Show from" and "Show until", each a native
 * date-and-time control in the browser's zone, stored as a UTC instant on the minute. Mounted once by
 * the block row for every block type. On a plan without scheduling the controls are disabled and the
 * plan notice shows (Clear stays on, so a window kept after a downgrade can be removed); Publish and
 * the database refuse a window there anyway (M20-11). HYDLNK UI tokens only.
 */

type Bound = "from" | "until";

const LABEL: Record<Bound, string> = { from: "Show from", until: "Show until" };
const TEST_ID: Record<Bound, string> = {
  from: SCHEDULE_TEST_IDS.blockFrom,
  until: SCHEDULE_TEST_IDS.blockUntil,
};

/** The block with its window set to `next`, or without the key when nothing is set. */
function withSchedule(block: Block, next: BlockSchedule): Block {
  const { schedule: _old, ...rest } = block;
  void _old;
  return (hasWindow(next) ? { ...rest, schedule: next } : rest) as Block;
}

export function ScheduleField({
  block,
  errors,
  plan,
  onChange,
}: {
  block: Block;
  errors: PublishError[];
  plan: PlanId;
  onChange: (next: Block) => void;
}) {
  const allowed = PLAN_LIMITS[plan].scheduling;
  const schedule = block.schedule ?? {};
  const [open, setOpen] = useState(hasWindow(schedule));
  // Times are drawn in the browser's zone, so nothing time-zoned is drawn before mount.
  const [zone, setZone] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's zone, once, after mount
  useEffect(() => setZone(zoneLabel()), []);
  const now = useMinuteClock();
  const sectionId = useId();

  const from = scheduleInstant(schedule.from);
  const until = scheduleInstant(schedule.until);
  const orderError = from !== null && until !== null && from >= until ? SCHEDULE_MESSAGES.order : null;
  const chip = zone ? windowChipText(schedule, now) : null;
  const summary = chip?.text ?? (hasWindow(schedule) ? "Scheduled" : "Always shown");

  const set = (bound: Bound, value: string | undefined) =>
    onChange(withSchedule(block, { ...schedule, [bound]: value }));

  const row = (bound: Bound) => {
    const id = `${sectionId}-${bound}`;
    const error =
      (bound === "until" ? orderError : null) ??
      fieldError(errors, block.id, `schedule.${bound}`) ??
      null;
    const errorId = `${id}-error`;
    const value = schedule[bound];
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
          {LABEL[bound]}
        </label>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row">
          <input
            id={id}
            type="datetime-local"
            step={60}
            data-testid={TEST_ID[bound]}
            disabled={!allowed}
            value={zone ? utcToLocalInput(value) : ""}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => set(bound, localInputToUtc(event.target.value) ?? undefined)}
            className={controlClass(error !== null, "font-mono disabled:opacity-60")}
          />
          <button
            type="button"
            data-testid={SCHEDULE_TEST_IDS.blockClear}
            data-bound={bound}
            disabled={value === undefined}
            onClick={() => set(bound, undefined)}
            className={`${FORM_BUTTON} shrink-0`}
            aria-label={`Clear ${LABEL[bound].toLowerCase()}`}
          >
            Clear
          </button>
        </div>
        <div aria-live="polite" className="empty:hidden">
          {error ? (
            <p id={errorId} className="m-0 text-[13px] text-bad">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  const planError = fieldError(errors, block.id, "schedule");

  return (
    <section
      data-testid={SCHEDULE_TEST_IDS.blockSchedule}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${sectionId}-body` : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left"
      >
        <span className="text-[13px] font-semibold text-ink-2">Schedule</span>
        <span className="min-w-0 truncate font-mono text-xs text-text-2">{summary}</span>
      </button>
      {open ? (
        <div id={`${sectionId}-body`} className="flex min-w-0 flex-col gap-3 px-3 pb-3">
          {allowed ? null : (
            <p data-testid={SCHEDULE_TEST_IDS.blockUpgrade} className="m-0 text-[13px] text-text-2">
              {SCHEDULING_PLAN_MESSAGE}{" "}
              <Link href="/settings#plans" className="underline">
                See plans
              </Link>
            </p>
          )}
          {row("from")}
          {row("until")}
          <p data-testid={SCHEDULE_TEST_IDS.blockZone} className="m-0 text-xs text-text-2">
            {zone ? `Times are in ${zone}.` : " "}
          </p>
          {planError ? (
            <p role="alert" className="m-0 text-[13px] text-bad">
              {planError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const TONE: Record<"upcoming" | "showing" | "ended", string> = {
  upcoming: "bg-track text-text-2",
  showing: "bg-brass-soft text-brass-soft-text",
  ended: "bg-track text-text-3",
};

/** The block row's one schedule chip (M20-06): "Starts …", "Until …" or "Ended …", in the browser's zone. */
export function ScheduleChip({ block }: { block: Block }) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- times are local: drawn after mount
  useEffect(() => setMounted(true), []);
  const now = useMinuteClock();
  if (!mounted) return null;
  const chip = windowChipText(block.schedule, now);
  if (!chip) return null;
  return (
    <span
      data-testid={SCHEDULE_TEST_IDS.blockChip}
      data-tone={chip.tone}
      className={`max-w-[45%] shrink-0 truncate rounded-sm px-[7px] py-[3px] font-mono text-[11px] whitespace-nowrap ${TONE[chip.tone]}`}
    >
      {chip.text}
    </span>
  );
}
