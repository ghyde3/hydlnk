"use client";

import { useId } from "react";
import { FONT_CATALOG } from "@/lib/design";
import { NAME_FONT_PREVIEW_PREFIX, nameFontPreviewCss } from "@/lib/design/name-font-files";
import { NAME_SIZES, NAME_SIZE_LABELS, pickNameFont, type NameSize } from "@/lib/document";
import type { FontFamily } from "@/lib/theme";
import { OptionGroup } from "./shape-section";

/**
 * The page's name font and name size (M9-24), in the Fonts card of the Design tab: they style the
 * profile's display name only (the headings, the bio and the blocks keep their fonts).
 *
 *   Name font   a native select, 16px and 44px tall: "Same as headings" (the key is removed) and
 *               the 18 allowlisted families, each option drawn in its own face from the
 *               self-hosted files (`@font-face` rules for the vendored latin regular files,
 *               under a preview-only family alias, so nothing is requested from a third party
 *               and a file is fetched only when an option in that face is drawn).
 *   Name size   Small, Medium, Large, Extra large: 0.85, 1, 1.25 and 1.5 times today's size.
 *
 * Both are page settings, not theme tokens: every change is one step of the workspace's undo
 * history and reaches the live page at Publish. `error` is the Publish gate's message for either.
 */

/** The faces of the options, built once: constants only (see `name-font-files`). */
const FACES = nameFontPreviewCss();

export function NameSection({
  nameFont,
  nameSize,
  error,
  onFont,
  onSize,
}: {
  nameFont: FontFamily | null;
  nameSize: NameSize;
  error?: { font: string | null; size: string | null };
  onFont: (family: FontFamily | null) => void;
  onSize: (size: NameSize) => void;
}) {
  const selectId = useId();
  const errorId = useId();
  const sizeErrorId = useId();
  return (
    <div className="flex flex-col gap-4" data-testid="name-style">
      <style>{FACES}</style>
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor={selectId} className="m-0 text-sm font-semibold text-ink">
          Name font
        </label>
        <select
          id={selectId}
          data-testid="name-font"
          value={nameFont ?? ""}
          aria-invalid={error?.font ? true : undefined}
          aria-describedby={error?.font ? errorId : undefined}
          onChange={(event) => onFont(pickNameFont(event.target.value))}
          className={`min-h-11 w-full min-w-0 rounded-md border bg-surface px-3 text-base font-normal text-ink ${
            error?.font ? "border-bad" : "border-line-3"
          }`}
        >
          <option value="">Same as headings</option>
          {FONT_CATALOG.map((entry) => (
            <option
              key={entry.family}
              value={entry.family}
              style={{
                fontFamily: `"${NAME_FONT_PREVIEW_PREFIX}${entry.family}", ${entry.generic}`,
              }}
            >
              {entry.family}
            </option>
          ))}
        </select>
        {error?.font ? (
          <p id={errorId} className="m-0 text-[13px] text-bad">
            {error.font}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <OptionGroup label="Name size">
          {NAME_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={nameSize === size}
              aria-describedby={error?.size ? sizeErrorId : undefined}
              onClick={() => onSize(size)}
              style={{ flex: "1 1 72px" }}
              className={`flex min-h-11 min-w-0 items-center justify-center rounded-sm px-2 text-center text-sm leading-tight font-medium ${
                nameSize === size
                  ? "bg-surface text-ink ring-1 ring-line-2"
                  : "bg-transparent text-text-2"
              }`}
            >
              {NAME_SIZE_LABELS[size]}
            </button>
          ))}
        </OptionGroup>
        {error?.size ? (
          <p id={sizeErrorId} className="m-0 text-[13px] text-bad">
            {error.size}
          </p>
        ) : null}
      </div>
    </div>
  );
}
