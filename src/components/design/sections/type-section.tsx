"use client";

import type { DesignSectionProps } from "@/components/design/types";
import { supportedWeights, type HeadingWeight } from "@/lib/design";
import type { TokenSet } from "@/lib/theme";
import { OptionButton, OptionGroup } from "./shape-section";

/**
 * Text size, heading weight and letter case (M3-10), as segmented controls like the rest of the
 * Design screen. Text size is one of four presets of the `scale` token; heading weight offers only
 * what the chosen heading font ships; letter case applies to the profile name and header blocks.
 */

const SCALES = [0.9, 1, 1.1, 1.2] as const;

const WEIGHT_LABELS: Record<HeadingWeight, string> = {
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
};

type LetterCase = "normal" | "uppercase" | "lowercase";
const CASES: readonly { value: LetterCase; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "uppercase", label: "Uppercase" },
  { value: "lowercase", label: "Lowercase" },
];

export function TypeSection({ resolved, setToken }: DesignSectionProps) {
  const weights = supportedWeights(resolved.fontHeading);
  const letterCase: LetterCase = resolved.letterCase;

  return (
    <div className="flex flex-col gap-4">
      <OptionGroup label="Text size">
        {SCALES.map((scale) => (
          <OptionButton
            key={scale}
            mono
            pressed={resolved.scale === scale}
            onPick={() => setToken("scale", scale)}
          >
            {scale}×
          </OptionButton>
        ))}
      </OptionGroup>

      <OptionGroup label="Heading weight">
        {weights.map((weight) => (
          <OptionButton
            key={weight}
            basis={80}
            pressed={resolved.weightHeading === weight}
            onPick={() => setToken("weightHeading", weight as TokenSet["weightHeading"])}
          >
            {WEIGHT_LABELS[weight]}
          </OptionButton>
        ))}
      </OptionGroup>

      <OptionGroup label="Letter case">
        {CASES.map((option) => (
          <OptionButton
            key={option.value}
            basis={80}
            pressed={letterCase === option.value}
            onPick={() => setToken("letterCase", option.value)}
          >
            {option.label}
          </OptionButton>
        ))}
      </OptionGroup>
    </div>
  );
}
