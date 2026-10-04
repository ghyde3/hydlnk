"use client";

import { resolveTokens } from "@/lib/theme";
import type { ThemeRow } from "@/lib/themes";
import { swatchBackground } from "@/lib/themes/swatch";
import { CardMenu, type CardMenuItem } from "./card-menu";

/**
 * One theme in a theme row (M7-06): a compact card, 152px wide and always 94px tall (a 48px swatch
 * over a 44px name row, and a 1px border), so every card in every row is the same height whatever
 * its name. The card is a button that applies the theme; `aria-pressed` is the applied state and the
 * applied card has a 2px brass outline. The swatch is the theme's background (or its gradient,
 * M6-43) with a filled and an outlined accent bar. The tag ("Applied", or "Edited" once the page's
 * own style changes it) is an 11px mono label drawn on the swatch, so the name row keeps its room.
 * A long name is cut with an ellipsis and carries the full name in `title`.
 *
 * The "More" button sits on the name row, outside the apply button (a button never holds another
 * button), and opens a menu: Preview for every theme (only when the screen gives it `onPreview`),
 * and Rename and Delete for the user's own.
 *
 * Only validated colors reach the swatch's inline style: `theme.tokens` came through the token
 * schema, and `resolveTokens` fills the gaps from the system default.
 */
export function ThemeCard({
  theme,
  tag,
  onApply,
  onPreview,
  previewing = false,
  onRename,
  onDelete,
}: {
  theme: ThemeRow;
  tag: "Applied" | "Edited" | null;
  onApply: () => void;
  /** M6-44: shows the theme on the page without applying it. The button is the focus to return to. */
  onPreview?: ((button: HTMLElement) => void) | undefined;
  /** This card is the one on show in the preview. */
  previewing?: boolean;
  /** Rename opens the screen's dialog; the button is the focus to return to. */
  onRename: (trigger: HTMLElement) => void;
  onDelete: (trigger: HTMLElement) => void;
}) {
  const tokens = resolveTokens(theme.tokens, {});
  const applied = tag !== null;
  const barRadius = `${Math.min(tokens.radius, 4)}px`;

  const items: CardMenuItem[] = [];
  if (onPreview) {
    items.push({
      id: "theme-preview",
      label: "Preview",
      ariaLabel: `Preview ${theme.name}`,
      onSelect: onPreview,
    });
  }
  if (!theme.system) {
    items.push({ id: "theme-rename", label: "Rename", onSelect: onRename });
    items.push({ id: "theme-delete", label: "Delete", danger: true, onSelect: onDelete });
  }

  return (
    <li
      data-theme-id={theme.id}
      data-previewing={previewing ? "" : undefined}
      className="relative h-[94px] w-[152px] shrink-0 snap-start"
    >
      <button
        type="button"
        aria-pressed={applied}
        onClick={onApply}
        data-testid="theme-card"
        className={`relative box-border block h-full w-full min-w-0 cursor-pointer overflow-hidden rounded-md border bg-surface p-0 text-left text-ink ${
          applied
            ? "border-line-2 outline-2 outline-offset-0 outline-brass"
            : previewing
              ? "border-ink ring-1 ring-ink"
              : "border-line-2 hover:border-line-3"
        } focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-brass`}
      >
        <span
          aria-hidden="true"
          data-swatch=""
          className="flex h-12 flex-col justify-center gap-1.5 px-3"
          style={{ background: swatchBackground(tokens) }}
        >
          <span
            className="block h-[7px] w-1/2"
            style={{ background: tokens.accent, borderRadius: barRadius }}
          />
          <span
            className="box-border block h-[7px] w-7/10"
            style={{ border: `1px solid ${tokens.accent}`, borderRadius: barRadius }}
          />
        </span>
        <span
          data-name-row=""
          className="box-border flex h-11 items-center border-t border-line pr-11 pl-2.5 text-[13px] font-semibold"
        >
          <span className="min-w-0 truncate" data-theme-name="" title={theme.name}>
            {theme.name}
          </span>
        </span>
        {tag ? (
          <span
            data-theme-tag=""
            className="absolute top-[5px] right-[5px] rounded-sm bg-brass-soft px-1.5 py-[3px] font-mono text-[11px] leading-none font-medium text-brass-soft-text"
          >
            {tag}
          </span>
        ) : null}
      </button>

      {items.length > 0 ? (
        <CardMenu
          themeName={theme.name}
          items={items}
          className="absolute right-px bottom-px inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-ink-2"
        />
      ) : null}
    </li>
  );
}
