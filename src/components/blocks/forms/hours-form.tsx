"use client";

import {
  DAY_KEYS,
  DAY_LABELS,
  HOURS_TIMEZONES,
  LIMITS,
  isHoursTimezone,
  timeToMinutes,
  type DayKey,
  type HoursBlock,
} from "@/lib/document";
import { FORM_BUTTON, FORM_BUTTON_DANGER, Field, controlClass } from "../field";
import { CountedField } from "./counted-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

type Day = HoursBlock["days"][DayKey];
type Range = Day["ranges"][number];

/** The hint under a range whose close is earlier than its open. */
export const MIDNIGHT_HINT = "Closes after midnight, the next day.";

const DEFAULT_RANGE: Range = { open: "09:00", close: "17:00" };
const SECOND_RANGE: Range = { open: "18:00", close: "22:00" };

function passesMidnight(range: Range): boolean {
  const open = timeToMinutes(range.open);
  const close = timeToMinutes(range.close);
  return open !== null && close !== null && close < open;
}

/** A range-time input: the browser's own time control, 16px and at least 44px tall. */
function TimeInput({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
}) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      step={60}
      data-field="time"
      onChange={(event) => onChange(event.target.value)}
      className={controlClass(invalid, "w-32 flex-none font-mono")}
    />
  );
}

function DayRow({
  dayKey,
  day,
  blockId,
  errors,
  onChange,
}: {
  dayKey: DayKey;
  day: Day;
  blockId: string;
  errors: BlockFormProps["errors"];
  onChange: (next: Day) => void;
}) {
  const label = DAY_LABELS[dayKey];
  const ranges = day.closed ? [] : day.ranges;
  const dayError = fieldError(errors, blockId, `days.${dayKey}.ranges`);
  const timeError = errors.find(
    (error) =>
      error.blockId === blockId &&
      error.itemId === undefined &&
      error.field.startsWith(`days.${dayKey}.ranges.`),
  );
  const patchRange = (index: number, next: Partial<Range>) =>
    onChange({
      ...day,
      ranges: day.ranges.map((range, i) => (i === index ? { ...range, ...next } : range)),
    });
  return (
    <li
      role="group"
      aria-label={label}
      data-day={dayKey}
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <button
          type="button"
          aria-pressed={day.closed}
          aria-label={`${label} closed`}
          data-field="closed"
          onClick={() =>
            onChange(
              day.closed
                ? { closed: false, ranges: day.ranges.length > 0 ? day.ranges : [DEFAULT_RANGE] }
                : { ...day, closed: true },
            )
          }
          className="flex min-h-11 min-w-11 items-center gap-2 text-[13px] font-medium text-ink"
        >
          <span>Closed</span>
          <span
            aria-hidden="true"
            className={`relative block h-[18px] w-8 shrink-0 rounded-full ${day.closed ? "bg-ink" : "bg-line-3"}`}
          >
            <span
              className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${day.closed ? "left-4" : "left-0.5"}`}
            />
          </span>
        </button>
      </div>
      {ranges.map((range, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <TimeInput
              label={`${label} opens${ranges.length > 1 ? ` (${index + 1})` : ""}`}
              value={range.open}
              invalid={timeError !== undefined}
              onChange={(open) => patchRange(index, { open })}
            />
            <span aria-hidden="true" className="text-text-2">
              to
            </span>
            <TimeInput
              label={`${label} closes${ranges.length > 1 ? ` (${index + 1})` : ""}`}
              value={range.close}
              invalid={timeError !== undefined}
              onChange={(close) => patchRange(index, { close })}
            />
            {ranges.length > 1 ? (
              <button
                type="button"
                className={FORM_BUTTON_DANGER}
                aria-label={`Remove ${label} time range ${index + 1}`}
                onClick={() =>
                  onChange({ ...day, ranges: day.ranges.filter((_, i) => i !== index) })
                }
              >
                Remove
              </button>
            ) : null}
          </div>
          {passesMidnight(range) ? (
            <p data-hint="midnight" className="m-0 text-xs text-text-2">
              {MIDNIGHT_HINT}
            </p>
          ) : null}
        </div>
      ))}
      {!day.closed && ranges.length < LIMITS.hoursRanges ? (
        <button
          type="button"
          className={`${FORM_BUTTON} self-start`}
          onClick={() =>
            onChange({
              ...day,
              ranges: [...day.ranges, ranges.length === 0 ? DEFAULT_RANGE : SECOND_RANGE],
            })
          }
        >
          <span aria-hidden="true" className="mr-1.5 text-brass-text">
            +
          </span>
          Add a time range
        </button>
      ) : null}
      {dayError || timeError ? (
        <p data-field="ranges" role="alert" className="text-[13px] text-bad">
          {dayError ?? timeError?.message}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Opening hours (M12-02): the time zone (a fixed list), seven days each closed or with one or two
 * time ranges (a close earlier than the open passes midnight, and says so), and a note. The page
 * shows the table and, in the visitor's browser, today's row and Open now or Closed now.
 */
export function HoursForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "hours") return null;
  const hours: HoursBlock = block;
  const known = isHoursTimezone(hours.timezone);
  const zoneError = fieldError(errors, hours.id, "timezone");
  return (
    <div className="flex flex-col gap-3">
      <Field label="Time zone" error={zoneError} className="max-w-[360px]">
        {(control) => (
          <select
            {...control}
            data-field="timezone"
            value={known ? hours.timezone : "unknown"}
            onChange={(event) => onChange({ ...hours, timezone: event.target.value })}
            className={controlClass(zoneError !== null)}
          >
            {known ? null : (
              <option value="unknown" disabled>
                Choose a time zone
              </option>
            )}
            {HOURS_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {DAY_KEYS.map((key) => (
          <DayRow
            key={key}
            dayKey={key}
            day={hours.days[key]}
            blockId={hours.id}
            errors={errors}
            onChange={(next) => onChange({ ...hours, days: { ...hours.days, [key]: next } })}
          />
        ))}
      </ol>
      <CountedField
        label="Note (optional)"
        field="note"
        max={LIMITS.hoursNote}
        value={hours.note ?? ""}
        error={fieldError(errors, hours.id, "note")}
        onChange={(note) => {
          const { note: dropped, ...rest } = hours;
          void dropped;
          onChange(note === "" ? rest : { ...rest, note });
        }}
      />
      <OverrideControls block={hours} onChange={onChange} errors={errors} />
    </div>
  );
}
