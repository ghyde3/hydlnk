"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ColorPanel,
  ColorSwatchButton,
  pickerValue,
  useColorPanel,
} from "@/components/design/color-picker";
import { cn } from "@/lib/cn";
import { HEX_ERROR_MESSAGE, isFullHex, normalizeHex } from "@/lib/design";
import {
  DEFAULT_QR_STYLE,
  FRAME_TEXT_DEFAULT,
  FRAME_TEXT_MAX,
  QR_COLORS_MESSAGE,
  customColor,
  limitFrameText,
  type QrColorMode,
  type QrStyle,
} from "@/lib/qr/style";
import type { QrLogoStatus } from "./qr-logo";
import { SECONDARY_BUTTON } from "./styles";

export const QR_LOGO_HINT = "Add a logo or a photo to your page first.";
export const QR_LOGO_FAILED = "Couldn’t load your logo. Turn the switch off, or try again.";
export const QR_LOGO_LOADING = "Loading your logo.";

const MODES: readonly { id: QrColorMode; label: string }[] = [
  { id: "bw", label: "Black and white" },
  { id: "page", label: "Page colors" },
  { id: "custom", label: "Custom" },
];

/** A 44px switch: the whole row is the button, named by its text. */
function Switch({
  label,
  checked,
  disabled = false,
  describedBy,
  onChange,
  dataKey,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  onChange: (next: boolean) => void;
  dataKey: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      data-qr-switch={dataKey}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-line-3 bg-surface px-3 text-left text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors",
          checked ? "bg-ink" : "bg-line-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-surface transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

/**
 * One Custom color: the swatch that opens the picker of M9-07, the name and the hex field. A
 * complete six-digit hex applies as it is typed, shorthand waits for blur, and anything else shows
 * the hex message and leaves the style on the last valid color (nothing but `customColor`'s
 * `#RRGGBB` ever reaches the style).
 */
function ColorRow({
  rowKey,
  swatchName,
  label,
  value,
  onChange,
}: {
  rowKey: "code" | "background";
  /** The swatch's accessible name is `<swatchName> color`. */
  swatchName: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [typing, setTyping] = useState<{ text: string; base: string } | null>(null);
  const live = typing !== null && typing.base === value ? typing.text : null;
  const invalid = live !== null && normalizeHex(live) === null;
  const errorId = useId();
  const panel = useColorPanel();
  const swatch = useRef<HTMLButtonElement>(null);

  function closePanel(): void {
    panel.close();
    swatch.current?.focus();
  }

  function onInput(text: string): void {
    setTyping({ text, base: value });
    const hex = isFullHex(text) ? customColor(text) : null;
    if (hex !== null) {
      onChange(hex);
      setTyping(null);
    }
  }

  function onBlur(): void {
    if (live === null) return;
    const hex = customColor(live);
    if (hex === null) return; // the message stays, with what was typed
    onChange(hex);
    setTyping(null);
  }

  return (
    <div data-qr-color={rowKey} className="flex flex-col gap-1.5 px-3 py-1.5">
      <div className="grid grid-cols-[44px_minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-x-2.5">
        <ColorSwatchButton
          name={swatchName}
          color={pickerValue(value)}
          open={panel.open}
          panelId={panel.panelId}
          onToggle={panel.toggle}
          onEscape={closePanel}
          buttonRef={swatch}
        />
        <span className="text-[13px] leading-snug text-ink">{label}</span>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`${label} hex`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={live ?? value}
          onChange={(event) => onInput(event.target.value)}
          onBlur={onBlur}
          className={cn(
            "min-h-11 min-w-0 rounded-md border bg-surface px-3 font-mono text-base text-text-2",
            invalid ? "border-bad" : "border-line-3",
          )}
        />
      </div>
      {invalid ? (
        <p id={errorId} className="m-0 text-[13px] text-bad">
          {HEX_ERROR_MESSAGE}
        </p>
      ) : null}
      {panel.open ? (
        <ColorPanel
          id={panel.panelId}
          name={swatchName}
          value={value}
          onPick={(hex) => {
            setTyping(null);
            const next = customColor(hex);
            if (next !== null) onChange(next);
          }}
          onDone={closePanel}
        />
      ) : null}
    </div>
  );
}

/**
 * The Style group of the QR card (M9-25): Colors (Black and white, Page colors, Custom), Logo, Frame
 * and 'Reset style'. All of it is view state of the card: nothing is saved, and every control starts
 * at its default. Every control is at least 44px tall and reachable by keyboard. Nothing in here
 * reaches the encoded address: the card makes that from the page's public address alone.
 */
export function QrStyleControls({
  style,
  onChange,
  logoAvailable,
  logoStatus,
  colorsOk,
}: {
  style: QrStyle;
  onChange: (next: QrStyle) => void;
  /** The page has a logo or a photo to put in the center. */
  logoAvailable: boolean;
  logoStatus: QrLogoStatus;
  /** `qrColorsOk` of the colors in use. */
  colorsOk: boolean;
}) {
  const ids = { heading: useId(), colors: useId(), hint: useId(), frameText: useId() };
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const frameLength = Array.from(style.frameText).length;

  function chooseMode(mode: QrColorMode, focus = false): void {
    onChange({ ...style, colors: mode });
    if (focus) radios.current[MODES.findIndex((entry) => entry.id === mode)]?.focus();
  }

  function onRadioKey(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    chooseMode(MODES[(index + step + MODES.length) % MODES.length]!.id, true);
  }

  return (
    <div
      role="group"
      aria-labelledby={ids.heading}
      data-testid="qr-style"
      className="flex min-w-0 flex-1 flex-col gap-4"
    >
      <h3 id={ids.heading} className="m-0 text-sm font-semibold">
        Style
      </h3>

      <div className="flex flex-col gap-2">
        <span id={ids.colors} className="text-[13px] font-semibold text-ink-2">
          Colors
        </span>
        <div role="radiogroup" aria-labelledby={ids.colors} className="grid grid-cols-3 gap-1.5">
          {MODES.map((mode, index) => {
            const selected = mode.id === style.colors;
            return (
              <button
                key={mode.id}
                ref={(element) => {
                  radios.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-qr-colors={mode.id}
                onClick={() => chooseMode(mode.id)}
                onKeyDown={(event) => onRadioKey(event, index)}
                className={cn(
                  "min-h-11 cursor-pointer rounded-md border px-1.5 text-[13px] leading-tight font-medium",
                  selected ? "border-ink bg-ink text-surface" : "border-line-3 bg-surface text-ink",
                )}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        {style.colors === "custom" ? (
          <div className="overflow-hidden rounded-md border border-line">
            <ColorRow
              rowKey="code"
              swatchName="Code"
              label="Code color"
              value={style.custom.code}
              onChange={(hex) => onChange({ ...style, custom: { ...style.custom, code: hex } })}
            />
            <div className="border-t border-line" />
            <ColorRow
              rowKey="background"
              swatchName="Background"
              label="Background"
              value={style.custom.background}
              onChange={(hex) =>
                onChange({ ...style, custom: { ...style.custom, background: hex } })
              }
            />
          </div>
        ) : null}
        <div
          role="status"
          data-testid="qr-colors-status"
          className="m-0 text-[13px] leading-normal text-bad empty:hidden"
        >
          {colorsOk ? "" : QR_COLORS_MESSAGE}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-ink-2">Logo</span>
        <Switch
          dataKey="logo"
          label="Add my logo in the center"
          checked={style.logo && logoAvailable}
          disabled={!logoAvailable}
          describedBy={ids.hint}
          onChange={(next) => onChange({ ...style, logo: next })}
        />
        <div id={ids.hint} className="text-xs leading-normal text-text-2 empty:hidden">
          {!logoAvailable
            ? QR_LOGO_HINT
            : style.logo && logoStatus === "loading"
              ? QR_LOGO_LOADING
              : ""}
        </div>
        {logoAvailable && style.logo && logoStatus === "failed" ? (
          <p role="alert" className="m-0 text-[13px] text-bad">
            {QR_LOGO_FAILED}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-ink-2">Frame</span>
        <Switch
          dataKey="frame"
          label="Add a frame with text"
          checked={style.frame}
          onChange={(next) => onChange({ ...style, frame: next })}
        />
        {style.frame ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.frameText} className="text-[13px] font-semibold text-ink-2">
              Frame text
            </label>
            <input
              id={ids.frameText}
              type="text"
              value={style.frameText}
              placeholder={FRAME_TEXT_DEFAULT}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) =>
                onChange({ ...style, frameText: limitFrameText(event.target.value) })
              }
              className="min-h-11 min-w-0 rounded-md border border-line-3 bg-surface px-3 text-base text-ink"
            />
            <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
              {frameLength} / {FRAME_TEXT_MAX}
            </span>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        data-testid="qr-reset"
        onClick={() => onChange(DEFAULT_QR_STYLE)}
        className={cn(SECONDARY_BUTTON, "self-start")}
      >
        Reset style
      </button>
    </div>
  );
}
