"use client";

import { useState } from "react";
import type { DesignSectionProps } from "@/components/design/types";
import { HEX_ERROR_MESSAGE, inkOn, isFullHex, normalizeHex, sameColor } from "@/lib/design";
import type { TokenSet } from "@/lib/theme";

/**
 * Colour on the Design screen (M3-08): six accent swatches and one row for each of the eight colour
 * tokens (Design.dc.html). A row has a swatch that opens the native colour picker, the token name
 * and a hex field. Everything is written to the draft as uppercase #RRGGBB; a hex field that does
 * not hold a colour shows its message and leaves the draft on the last valid value.
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

/** What the native picker needs: `#rrggbb`, lowercase, whatever the token holds. */
function pickerValue(value: string): string {
  const hex = normalizeHex(value) ?? (/^#[0-9a-fA-F]{8}$/.test(value) ? value.slice(0, 7) : null);
  return (hex ?? "#000000").toLowerCase();
}

function ColorRow({
  name,
  value,
  onChange,
  last,
}: {
  name: ColorKey;
  value: string;
  onChange: (hex: string) => void;
  last: boolean;
}) {
  // What the user is typing, tied to the token value it started from: once the token changes some
  // other way (the picker, a swatch, a theme) the typed text is dropped and the token shows again.
  const [typing, setTyping] = useState<{ text: string; base: string } | null>(null);
  const live = typing !== null && typing.base === value ? typing.text : null;
  const shown = live ?? value;
  const invalid = live !== null && normalizeHex(live) === null;
  const errorId = `color-error-${name}`;

  function onInput(text: string): void {
    setTyping({ text, base: value });
    // A complete six-digit hex applies as it is typed; shorthand waits for blur so typing
    // "#C9A86A" never passes through the colour "#C9A".
    const hex = normalizeHex(text);
    if (hex !== null && isFullHex(text)) onChange(hex);
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
      data-color-row={name}
      className={`grid grid-cols-[44px_minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 px-3 py-1 ${
        last ? "" : "border-b border-line"
      }`}
    >
      <input
        type="color"
        aria-label={`${name} colour`}
        value={pickerValue(value)}
        onChange={(event) => {
          setTyping(null);
          onChange(event.target.value.toUpperCase());
        }}
        className="block size-11 cursor-pointer appearance-none rounded-md border border-line-2 bg-transparent p-1 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0"
      />
      <span className="font-mono text-[13px] text-ink">{name}</span>
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
    </div>
  );
}

export function ColorSection({ resolved, setToken }: DesignSectionProps) {
  /**
   * A new accent. Buttons that follow the accent (their fill is the accent today) keep following
   * it, with ink that reads on the new colour; a theme with its own button colour is left alone.
   */
  function setAccent(hex: string): void {
    const followed = sameColor(resolved.buttonBg, resolved.accent);
    setToken("accent", hex);
    if (followed) {
      setToken("buttonBg", hex);
      setToken("buttonText", inkOn(hex));
    }
  }

  function set(key: ColorKey, hex: string): void {
    if (key === "accent") setAccent(hex);
    else setToken(key, hex as TokenSet[ColorKey]);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-[13px] font-normal text-text-2">Accent</h3>
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
      <div className="overflow-hidden rounded-md border border-line">
        {COLOR_KEYS.map((key, index) => (
          <ColorRow
            key={key}
            name={key}
            value={resolved[key]}
            onChange={(hex) => set(key, hex)}
            last={index === COLOR_KEYS.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
