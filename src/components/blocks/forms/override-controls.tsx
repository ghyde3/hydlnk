"use client";

import { useState } from "react";
import { usePageTokens } from "@/components/themes/page-tokens-context";
import {
  BUTTON_STYLES,
  BUTTON_STYLE_LABELS,
  COLOR_KEYS,
  RADIUS_OPTIONS,
  isHexColor,
  readButtonStyle,
  readColor,
  readRadius,
  setButtonStyle,
  setColor,
  setRadius,
  type ButtonStyle,
  type OverridableBlock,
} from "@/lib/themes";
import { Field, FORM_BUTTON, controlClass } from "../field";
import { fieldError, type BlockFormProps } from "./types";

/**
 * The per-block override controls (M3-17, M3-18): exactly three, Button style (link blocks only),
 * Color and Corner radius (link and card blocks). No font, spacing or background control exists
 * here, and the document schema drops any other override key. Each control writes straight into
 * `block.overrides` through the pure setters of `@/lib/themes`; "Theme default" removes the key,
 * and an empty override set removes `overrides` from the block.
 */
export function OverrideControls({
  block,
  onChange,
  errors,
}: {
  block: OverridableBlock;
  onChange: BlockFormProps["onChange"];
  errors: BlockFormProps["errors"];
}) {
  const tokens = usePageTokens();
  const style = readButtonStyle(block);
  const radius = readRadius(block);
  // A radius the list does not offer (set through the API) is still shown, so the select never lies.
  const radiusChoices: number[] = [...RADIUS_OPTIONS];
  if (radius !== null && !radiusChoices.includes(radius)) radiusChoices.push(radius);

  const colorError =
    COLOR_KEYS[block.type]
      .map((key) => fieldError(errors, block.id, `overrides.${key}`))
      .find((message) => message !== null) ?? null;

  return (
    <div data-testid="override-controls" className="flex flex-wrap items-start gap-3">
      {block.type === "link" ? (
        <Field
          label="Button style"
          error={fieldError(errors, block.id, "overrides.buttonStyle")}
          className="flex-1 basis-[220px]"
        >
          {(control) => (
            <select
              {...control}
              value={style ?? ""}
              data-field="override-button-style"
              onChange={(event) =>
                onChange(
                  setButtonStyle(
                    block,
                    event.target.value === "" ? null : (event.target.value as ButtonStyle),
                  ),
                )
              }
              className={controlClass(false, "py-0")}
            >
              <option value="">
                {tokens
                  ? `Theme default (${BUTTON_STYLE_LABELS[tokens.buttonStyle]})`
                  : "Theme default"}
              </option>
              {BUTTON_STYLES.map((value) => (
                <option key={value} value={value}>
                  {BUTTON_STYLE_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      <ColorControl block={block} onChange={onChange} error={colorError} />

      <Field
        label="Corner radius"
        error={fieldError(errors, block.id, "overrides.radius")}
        className="flex-1 basis-[220px]"
      >
        {(control) => (
          <select
            {...control}
            value={radius === null ? "" : String(radius)}
            data-field="override-radius"
            onChange={(event) =>
              onChange(
                setRadius(block, event.target.value === "" ? null : Number(event.target.value)),
              )
            }
            className={controlClass(false, "py-0")}
          >
            <option value="">Theme default</option>
            {radiusChoices.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

/** Accepts `#RRGGBB` and `RRGGBB`, any case; anything else is not a color yet. */
function normalizeHex(input: string): string | null {
  const text = input.trim();
  const hex = text.startsWith("#") ? text : `#${text}`;
  return isHexColor(hex) ? hex.toUpperCase() : null;
}

/**
 * Color: a swatch (the native color picker) and a 16px hex field. The field keeps what is being
 * typed; only a complete #RRGGBB reaches the block, so a half-typed value never makes the draft
 * invalid. Clearing the field, or "Theme default", removes the override.
 */
function ColorControl({
  block,
  onChange,
  error,
}: {
  block: OverridableBlock;
  onChange: BlockFormProps["onChange"];
  error: string | null;
}) {
  const tokens = usePageTokens();
  const stored = readColor(block);
  // What is being typed, while the hex field has focus; null otherwise, and then the field shows
  // the block's color (so a change from elsewhere, the picker, a reset or undo, shows at once).
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? stored ?? "";

  const themeColor = block.type === "link" ? tokens?.buttonBg : tokens?.accent;
  const swatch = stored ?? themeColor ?? "#FFFFFF";
  const partial = text.trim() !== "" && normalizeHex(text) === null;
  const message = error ?? (partial ? "Use a #RRGGBB color, for example #C46A4F." : null);

  function commit(value: string) {
    if (value.trim() === "") {
      onChange(setColor(block, null));
      return;
    }
    const hex = normalizeHex(value);
    if (hex !== null) onChange(setColor(block, hex));
  }

  return (
    <Field label="Color" error={message} className="flex-1 basis-[220px]">
      {(control) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Color swatch"
            value={swatch.toLowerCase()}
            data-field="override-color-swatch"
            onChange={(event) => {
              setTyped(null);
              commit(event.target.value);
            }}
            className="size-11 shrink-0 cursor-pointer rounded-md border border-line-3 bg-surface p-1"
          />
          <input
            {...control}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            placeholder={themeColor ? themeColor.toUpperCase() : "#RRGGBB"}
            value={text}
            data-field="override-color"
            onFocus={() => setTyped(stored ?? "")}
            onBlur={() => setTyped(null)}
            onChange={(event) => {
              setTyped(event.target.value);
              commit(event.target.value);
            }}
            className={controlClass(partial || error !== null, "min-w-0 flex-1 font-mono")}
          />
          {stored !== null ? (
            <button
              type="button"
              onClick={() => {
                setTyped(null);
                onChange(setColor(block, null));
              }}
              className={`${FORM_BUTTON} shrink-0`}
            >
              Theme default
            </button>
          ) : null}
        </div>
      )}
    </Field>
  );
}
