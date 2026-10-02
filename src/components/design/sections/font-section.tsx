"use client";

import type { DesignSectionProps } from "@/components/design/types";
import { FontPicker } from "@/components/design/font-picker";
import { nearestWeight } from "@/lib/design";

/**
 * Heading and body fonts (M3-09). Two pickers, each limited to the allowlist. Picking a heading
 * font also moves the heading weight to the nearest weight that font supports, in the same edit
 * (M3-10), so a font without the current weight never leaves an unusable one behind.
 */
export function FontSection({ resolved, setToken }: DesignSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <FontPicker
        label="Heading font"
        value={resolved.fontHeading}
        onPick={(family) => {
          setToken("fontHeading", family);
          const weight = nearestWeight(family, resolved.weightHeading);
          if (weight !== resolved.weightHeading) setToken("weightHeading", weight);
        }}
      />
      <FontPicker
        label="Body font"
        value={resolved.fontBody}
        onPick={(family) => setToken("fontBody", family)}
      />
    </div>
  );
}
