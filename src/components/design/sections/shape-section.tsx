"use client";

import type { ReactNode } from "react";
import type { DesignSectionProps } from "@/components/design/types";
import type { TokenSet } from "@/lib/theme";

/**
 * Shape on the Design screen: button style (M3-11), corner radius and border width (M3-12).
 * Each group is a segmented control (Design.dc.html): a track with the options inside it, the
 * chosen one white on a 1px ring, `aria-pressed` on every option, 44px tall on a phone (40px from
 * 760px up, as in the mockup), wrapping into rows when the width runs out.
 *
 * `OptionGroup` and `OptionButton` are shared with the spacing and background sections.
 */

type ButtonStyle = TokenSet["buttonStyle"];

const BUTTON_STYLES: readonly { value: ButtonStyle; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "outline", label: "Outline" },
  { value: "soft", label: "Soft" },
  { value: "shadow", label: "Shadow" },
  { value: "pill", label: "Pill" },
];

const RADII = [0, 4, 12, 20] as const;
const BORDER_WIDTHS = [0, 1, 2] as const;

/** A titled segmented control: the title names the group for assistive technology as well. */
export function OptionGroup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <h2 className="m-0 text-sm font-semibold text-ink">{label}</h2>
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap gap-0.5 rounded-md border border-line bg-track p-[3px]"
      >
        {children}
      </div>
    </div>
  );
}

/** One option of a segmented control. `mono` is for values (radius, widths), which read as data. */
export function OptionButton({
  pressed,
  onPick,
  children,
  mono = false,
  basis = 60,
}: {
  pressed: boolean;
  onPick: () => void;
  children: ReactNode;
  mono?: boolean;
  /** Preferred width in px; options share a row until it runs out, then wrap. */
  basis?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      style={{ flex: `1 1 ${basis}px` }}
      className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-sm px-2 hl:min-h-10 ${
        mono ? "font-mono text-[13px]" : "text-sm font-medium"
      } ${pressed ? "bg-surface text-ink ring-1 ring-line-2" : "bg-transparent text-text-2"}`}
    >
      {children}
    </button>
  );
}

/** Button style, corner radius and border width. */
export function ShapeSection({ resolved, setToken }: DesignSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <OptionGroup label="Button style">
        {BUTTON_STYLES.map((option) => (
          <OptionButton
            key={option.value}
            pressed={resolved.buttonStyle === option.value}
            onPick={() => setToken("buttonStyle", option.value)}
          >
            {option.label}
          </OptionButton>
        ))}
      </OptionGroup>

      <OptionGroup label="Corner radius">
        {RADII.map((radius) => (
          <OptionButton
            key={radius}
            mono
            pressed={resolved.radius === radius}
            onPick={() => setToken("radius", radius)}
          >
            <span
              aria-hidden="true"
              style={{ borderRadius: `${Math.min(radius, 7)}px` }}
              className="inline-block size-3.5 border-[1.5px] border-current"
            />
            {radius}px
          </OptionButton>
        ))}
      </OptionGroup>

      <OptionGroup label="Border width">
        {BORDER_WIDTHS.map((width) => (
          <OptionButton
            key={width}
            mono
            pressed={resolved.borderWidth === width}
            onPick={() => setToken("borderWidth", width)}
          >
            {width}px
          </OptionButton>
        ))}
      </OptionGroup>
    </div>
  );
}
