"use client";

import type { DesignSectionProps } from "@/components/design/types";
import type { TokenSet } from "@/lib/theme";
import { OptionButton, OptionGroup } from "./shape-section";

/**
 * The Layout card of the Design screen (M3-13, M6-47): space between blocks (the gap: 8, 12 or
 * 18px), page width (the column's width on a wide screen; a phone is never wider than itself) and
 * text alignment of the profile, headings and text blocks.
 */

const DENSITIES: readonly { value: TokenSet["density"]; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "regular", label: "Regular" },
  { value: "airy", label: "Airy" },
];

const WIDTHS = [480, 560, 640] as const;

const ALIGNMENTS: readonly { value: TokenSet["align"]; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "left", label: "Left" },
];

export function SpacingSection({ resolved, setToken }: DesignSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <OptionGroup label="Space between blocks">
        {DENSITIES.map((option) => (
          <OptionButton
            key={option.value}
            pressed={resolved.density === option.value}
            onPick={() => setToken("density", option.value)}
          >
            {option.label}
          </OptionButton>
        ))}
      </OptionGroup>

      <OptionGroup label="Page width">
        {WIDTHS.map((width) => (
          <OptionButton
            key={width}
            mono
            pressed={resolved.maxWidth === width}
            onPick={() => setToken("maxWidth", width)}
          >
            {width}
          </OptionButton>
        ))}
      </OptionGroup>

      <OptionGroup label="Text alignment">
        {ALIGNMENTS.map((option) => (
          <OptionButton
            key={option.value}
            pressed={resolved.align === option.value}
            onPick={() => setToken("align", option.value)}
          >
            {option.label}
          </OptionButton>
        ))}
      </OptionGroup>
    </div>
  );
}
