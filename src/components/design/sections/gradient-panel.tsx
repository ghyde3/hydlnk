"use client";

import type { DesignSectionProps } from "@/components/design/types";
import {
  GRADIENT_DIRECTIONS,
  GRADIENT_PRESETS,
  GRADIENT_READABILITY_HINT,
  hardToRead,
  type GradientPreset,
} from "@/lib/design/gradient";
import { normalizeHex, sameColor } from "@/lib/design";
import { GRADIENT_TOKEN_KEYS } from "@/lib/theme";
import { ColorRow } from "./color-section";

/**
 * The gradient controls of the Design screen (M6-42), shown inside the Background card while the
 * background is a gradient: a direction (eight arrows), the two colors (the same rows as the page
 * colors), a way to swap them, eight presets and a way back to the theme's colors.
 *
 * It only writes the three gradient tokens, and always through `setToken`. Several writes made by
 * one click (a preset, a swap, going back to the theme) are one edit, one undo step and one
 * autosave, because the screen groups every write made in the same tick. Choosing Solid hides the
 * panel and keeps what was set: nothing here is cleared except by "Use theme colors".
 */

/** An arrow that points the way the gradient runs; `angle` is the CSS angle (0 is up, 90 is right). */
function Arrow({ angle }: { angle: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 fill-none stroke-current stroke-[2]"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${angle}deg)` }}
    >
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

/** The gradient a preset draws, as the button's swatch. */
function presetBackground(preset: GradientPreset): string {
  return `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})`;
}

const subButton =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50";

export function GradientPanel({ resolved, overrides, setToken }: DesignSectionProps) {
  // What the page shows today: a color that is not set follows the page (surface, then background).
  const from = resolved.gradientFrom ?? resolved.surface;
  const to = resolved.gradientTo ?? resolved.bg;
  const angle = resolved.gradientAngle;
  const anySet = GRADIENT_TOKEN_KEYS.some((key) => overrides[key] !== undefined);
  const hint = hardToRead(resolved.text, [from, to]);

  /** A color for the draft: the screen's own #RRGGBB form where it can be, else what the theme holds. */
  const stored = (color: string): string => normalizeHex(color) ?? color.toUpperCase();

  function swap(): void {
    setToken("gradientFrom", stored(to));
    setToken("gradientTo", stored(from));
  }

  function applyPreset(preset: GradientPreset): void {
    setToken("bgType", "gradient");
    setToken("gradientAngle", preset.angle);
    setToken("gradientFrom", preset.from);
    setToken("gradientTo", preset.to);
  }

  function useThemeColors(): void {
    for (const key of GRADIENT_TOKEN_KEYS) setToken(key, undefined);
  }

  return (
    <div
      role="group"
      aria-label="Gradient"
      data-testid="gradient-panel"
      className="flex min-w-0 flex-col gap-4 rounded-md border border-line bg-track p-3"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold text-ink">Direction</h3>
        <div role="group" aria-label="Direction" className="grid max-w-[24rem] grid-cols-4 gap-2">
          {GRADIENT_DIRECTIONS.map((direction) => {
            const pressed = angle === direction.angle;
            return (
              <button
                key={direction.angle}
                type="button"
                aria-label={direction.label}
                aria-pressed={pressed}
                onClick={() => setToken("gradientAngle", direction.angle)}
                className={`flex min-h-11 min-w-11 items-center justify-center rounded-sm border ${
                  pressed
                    ? "border-transparent bg-surface text-ink ring-1 ring-line-2"
                    : "border-line bg-transparent text-text-2"
                }`}
              >
                <Arrow angle={direction.angle} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <ColorRow
            rowKey="gradientFrom"
            name="From"
            value={from}
            onChange={(hex) => setToken("gradientFrom", hex)}
            last={false}
            compact
          />
          <ColorRow
            rowKey="gradientTo"
            name="To"
            value={to}
            onChange={(hex) => setToken("gradientTo", hex)}
            last
            compact
          />
        </div>
        <p
          role="status"
          aria-live="polite"
          data-testid="gradient-readability"
          className="m-0 text-[13px] text-text-2 empty:hidden"
        >
          {hint ? GRADIENT_READABILITY_HINT : null}
        </p>
        <div>
          <button type="button" className={subButton} onClick={swap}>
            Swap colors
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold text-ink">Presets</h3>
        <div
          role="group"
          aria-label="Presets"
          className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2"
        >
          {GRADIENT_PRESETS.map((preset) => {
            const pressed =
              angle === preset.angle && sameColor(from, preset.from) && sameColor(to, preset.to);
            return (
              <button
                key={preset.name}
                type="button"
                aria-label={`Preset ${preset.name}`}
                aria-pressed={pressed}
                onClick={() => applyPreset(preset)}
                className={`flex min-h-11 min-w-0 flex-col items-stretch gap-1 rounded-sm border p-1 text-left ${
                  pressed ? "border-transparent bg-surface ring-2 ring-ink" : "border-line bg-surface"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="block h-8 w-full rounded-[3px] border border-line"
                  style={{ background: presetBackground(preset) }}
                />
                <span aria-hidden="true" className="px-0.5 text-xs text-ink">
                  {preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <button type="button" className={subButton} disabled={!anySet} onClick={useThemeColors}>
          Use theme colors
        </button>
      </div>
    </div>
  );
}
