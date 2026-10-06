"use client";

import { useRef, useState } from "react";
import { ColorPanel, ColorSwatchButton, pickerValue, useColorPanel } from "@/components/design/color-picker";
import type { DesignSectionProps } from "@/components/design/types";
import { HEX_ERROR_MESSAGE, inkOn, isFullHex, normalizeHex, sameColor } from "@/lib/design";
import { TOKEN_LABELS, type TokenSet } from "@/lib/theme";

/**
 * The Colors card of the Design screen (M3-08, M6-47): six accent swatches and one row for each of
 * the eight page colors (Design.dc.html), named in plain words (`TOKEN_LABELS`, the same names the
 * Publish messages use). A row has a swatch that opens the color picker (M9-07: an inline panel
 * under the row), the name and a hex field. Everything is written to the draft as uppercase #RRGGBB; a hex field that does not hold a
 * color shows its message and leaves the draft on the last valid value.
 */

const ACCENTS = [
  { name: "Brass", hex: "#C9A86A" },
  { name: "Terracotta", hex: "#C46A4F" },
  { name: "Sage", hex: "#8FA68A" },
  { name: "Steel", hex: "#9DB3C4" },
  { name: "Bone", hex: "#E8E1D3" },
  { name: "Ink", hex: "#1B1814" },
] as const;

type ColorKey = "bg" | "surface" | "text" | "textMuted" | "accent" | "buttonBg" | "buttonText" | "border";

const COLOR_KEYS: readonly ColorKey[] = [
  "bg",
  "surface",
  "text",
  "textMuted",
  "accent",
  "buttonBg",
  "buttonText",
  "border",
];

/**
 * One color row: swatch (opens the picker, `<name> color`), the name, and the hex field
 * (`<name> hex`). `rowKey` is the token the row edits and the value of `data-color-row`; `name` is
 * its plain label. The gradient's From and To rows use it too (M6-42), so all color fields behave
 * alike: a complete six-digit hex applies as it is typed, shorthand waits for blur, and anything
 * else shows the hex message and leaves the draft alone.
 */
export function ColorRow({
  rowKey,
  name,
  value,
  onChange,
  last,
  compact = false,
}: {
  rowKey: string;
  name: string;
  value: string;
  onChange: (hex: string) => void;
  last: boolean;
  /** A short name ("From", "To"): the name column is narrow, so the hex field keeps its room on a phone. */
  compact?: boolean;
}) {
  // What the user is typing, tied to the token value it started from: once the token changes some
  // other way (the picker, a swatch, a theme) the typed text is dropped and the token shows again.
  const [typing, setTyping] = useState<{ text: string; base: string } | null>(null);
  const live = typing !== null && typing.base === value ? typing.text : null;
  const shown = live ?? value;
  const invalid = live !== null && normalizeHex(live) === null;
  const errorId = `color-error-${rowKey}`;
  const panel = useColorPanel();
  const swatch = useRef<HTMLButtonElement>(null);

  function onInput(text: string): void {
    setTyping({ text, base: value });
    // A complete six-digit hex applies as it is typed; shorthand waits for blur so typing
    // "#C9A86A" never passes through the color "#C9A".
    const hex = normalizeHex(text);
    if (hex !== null && isFullHex(text)) {
      onChange(hex);
      // Applied: the field shows the token again, so a later reset to the value this typing began
      // from (Swap colors, Use theme colors, Undo) is not drawn over by the old text.
      setTyping(null);
    }
  }

  /** Done and Escape: the panel closes and focus goes back to the swatch. */
  function closePanel(): void {
    panel.close();
    swatch.current?.focus();
  }

  function onBlur(): void {
    if (live === null) return;
    const hex = normalizeHex(live);
    if (hex === null) return; // the message stays, with what was typed
    onChange(hex);
    setTyping(null);
  }

  return (
    <div
      data-color-row={rowKey}
      className={`grid items-center gap-x-2.5 gap-y-1 px-3 py-1 ${
        compact
          ? "grid-cols-[44px_minmax(0,2.5rem)_minmax(0,1fr)]"
          : "grid-cols-[44px_minmax(0,7.5rem)_minmax(0,1fr)]"
      } ${last ? "" : "border-b border-line"}`}
    >
      <ColorSwatchButton
        name={name}
        color={pickerValue(value)}
        open={panel.open}
        panelId={panel.panelId}
        onToggle={panel.toggle}
        onEscape={closePanel}
        buttonRef={swatch}
      />
      <span className="text-[13px] leading-snug break-words text-ink">{name}</span>
      <input
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={`${name} hex`}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={shown}
        onChange={(event) => onInput(event.target.value)}
        onBlur={onBlur}
        className={`min-h-11 min-w-0 rounded-md border bg-surface px-3 font-mono text-base text-text-2 ${
          invalid ? "border-bad" : "border-line-3"
        }`}
      />
      {invalid ? (
        <p id={errorId} className="col-span-3 col-start-1 pb-2 text-[13px] text-bad">
          {HEX_ERROR_MESSAGE}
        </p>
      ) : null}
      {panel.open ? (
        <div className="col-span-3 col-start-1 pb-3">
          <ColorPanel
            id={panel.panelId}
            name={name}
            value={value}
            onPick={(hex) => {
              setTyping(null);
              onChange(hex);
            }}
            onDone={closePanel}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ColorSection({ resolved, setToken }: DesignSectionProps) {
  /**
   * A new accent. Buttons that follow the accent (their fill is the accent today) keep following
   * it, with ink that reads on the new color; a theme with its own button color is left alone.
   */
  function setAccent(hex: string): void {
    const followed = sameColor(resolved.buttonBg, resolved.accent);
    setToken("accent", hex);
    if (followed) {
      // Under the accent's own group, so a drag of the picker is one undo step, not three per move.
      setToken("buttonBg", hex, "accent");
      setToken("buttonText", inkOn(hex), "accent");
    }
  }

  function set(key: ColorKey, hex: string): void {
    if (key === "accent") setAccent(hex);
    else setToken(key, hex as TokenSet[ColorKey]);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold text-ink">Accent</h3>
        <div role="group" aria-label="Accent" className="flex flex-wrap gap-2.5">
          {ACCENTS.map((accent) => {
            const pressed = sameColor(resolved.accent, accent.hex);
            return (
              <button
                key={accent.hex}
                type="button"
                aria-label={`Accent ${accent.name}`}
                aria-pressed={pressed}
                onClick={() => setAccent(accent.hex)}
                // The selected ring is a box-shadow, not an outline, so the global brass focus
                // outline (DESIGN.md Focus) still shows on a focused swatch.
                style={{
                  background: accent.hex,
                  boxShadow: pressed
                    ? "0 0 0 2px var(--hl-surface), 0 0 0 4px var(--hl-ink)"
                    : "0 0 0 2px var(--hl-surface), 0 0 0 3px var(--hl-line-2)",
                }}
                className="size-11 rounded-md border-0 p-0"
              />
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold text-ink">All colors</h3>
        <div className="overflow-hidden rounded-md border border-line">
          {COLOR_KEYS.map((key, index) => (
            <ColorRow
              key={key}
              rowKey={key}
              name={TOKEN_LABELS[key]}
              value={resolved[key]}
              onChange={(hex) => set(key, hex)}
              last={index === COLOR_KEYS.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
