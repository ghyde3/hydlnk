"use client";

import { useId, useState } from "react";
import { usePageTokens } from "@/components/themes/page-tokens-context";
import {
  BORDER_WIDTH_OPTIONS,
  BUTTON_STYLES,
  BUTTON_STYLE_LABELS,
  COLOR_KEYS,
  RADIUS_OPTIONS,
  hasColorOverride,
  isHexColor,
  readBorderWidth,
  readButtonStyle,
  readColor,
  readRadius,
  setBorderWidth,
  setButtonStyle,
  setColor,
  setRadius,
  styleSpecOf,
  type ButtonStyle,
  type ColorControlSpec,
  type StyleControl,
} from "@/lib/themes";
import type { Block } from "@/lib/document";
import { Field, FORM_BUTTON, controlClass } from "../field";
import { fieldError, type BlockFormProps } from "./types";

/**
 * The per-block style controls (M3-17, M3-18, M6-46), in a group headed "Style this block" (a
 * labeled section) under the block's own fields. Every block type has its own short list (see `STYLE_SPECS` in
 * `@/lib/themes`): Button style, Color (labeled for its job: "Color", "Text color", "Border color",
 * "Icon color", "Line color"), Corner radius and Border thickness. No font, spacing or background
 * control exists here, and the document schema drops any other override key. Each control writes
 * straight into `block.overrides` through the pure setters of `@/lib/themes`; "Theme default"
 * removes the key, and an empty override set removes `overrides` from the block.
 *
 * Plain on every plan: nothing here is gated, so there is no Pro chip.
 */
export function OverrideControls({
  block,
  onChange,
  errors,
}: {
  block: Block;
  onChange: BlockFormProps["onChange"];
  errors: BlockFormProps["errors"];
}) {
  const headingId = useId();
  const spec = styleSpecOf(block);
  if (!spec) return null;

  const colorError =
    COLOR_KEYS[block.type]
      .map((key) => fieldError(errors, block.id, `overrides.${key}`))
      .find((message) => message !== null) ?? null;

  return (
    // A labeled section, not `role="group"`: the social and grid panels already hold one group per
    // icon or cell, and the people and tests that count those must not count this one.
    <section
      aria-labelledby={headingId}
      data-testid="override-controls"
      className="flex flex-col gap-3 border-t border-line pt-3"
    >
      <div className="flex flex-col gap-0.5">
        <p id={headingId} className="text-[13px] font-semibold text-ink-2">
          Style this block
        </p>
        <p className="text-xs text-text-2">
          Only this block. Leave on Theme default to follow your page style.
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {spec.controls.map((control) => (
          <StyleControlField
            key={control}
            control={control}
            colorSpec={spec.color}
            block={block}
            onChange={onChange}
            colorError={colorError}
            errors={errors}
          />
        ))}
      </div>
    </section>
  );
}

function StyleControlField({
  control,
  colorSpec,
  block,
  onChange,
  colorError,
  errors,
}: {
  control: StyleControl;
  colorSpec: ColorControlSpec;
  block: Block;
  onChange: BlockFormProps["onChange"];
  colorError: string | null;
  errors: BlockFormProps["errors"];
}) {
  switch (control) {
    case "buttonStyle":
      return (
        <ButtonStyleControl
          block={block}
          onChange={onChange}
          error={fieldError(errors, block.id, "overrides.buttonStyle")}
        />
      );
    case "color":
      return <ColorControl block={block} spec={colorSpec} onChange={onChange} error={colorError} />;
    case "radius":
      return (
        <NumberSelect
          label="Corner radius"
          field="override-radius"
          value={readRadius(block)}
          options={RADIUS_OPTIONS}
          error={fieldError(errors, block.id, "overrides.radius")}
          onSelect={(value) => onChange(setRadius(block, value))}
        />
      );
    case "borderWidth":
      return (
        <NumberSelect
          label="Border thickness"
          field="override-border-width"
          value={readBorderWidth(block)}
          options={BORDER_WIDTH_OPTIONS}
          error={fieldError(errors, block.id, "overrides.borderWidth")}
          onSelect={(value) => onChange(setBorderWidth(block, value))}
        />
      );
  }
}

/** Button style (link blocks): "Theme default (<the page's style>)" or one of the five. */
function ButtonStyleControl({
  block,
  onChange,
  error,
}: {
  block: Block;
  onChange: BlockFormProps["onChange"];
  error: string | null;
}) {
  const tokens = usePageTokens();
  const style = readButtonStyle(block);
  return (
    <Field label="Button style" error={error} className="flex-1 basis-[220px]">
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
  );
}

/**
 * Corner radius and Border thickness: "Theme default" or one of a short list of numbers. A stored
 * value the list does not offer (set through the API) is still shown, as an extra option, so the
 * select never shows a value that is not stored.
 */
function NumberSelect({
  label,
  field,
  value,
  options,
  error,
  onSelect,
}: {
  label: string;
  field: string;
  value: number | null;
  options: readonly number[];
  error: string | null;
  onSelect: (value: number | null) => void;
}) {
  const choices: number[] = [...options];
  if (value !== null && !choices.includes(value)) choices.push(value);
  return (
    <Field label={label} error={error} className="flex-1 basis-[220px]">
      {(control) => (
        <select
          {...control}
          value={value === null ? "" : String(value)}
          data-field={field}
          onChange={(event) =>
            onSelect(event.target.value === "" ? null : Number(event.target.value))
          }
          className={controlClass(false, "py-0")}
        >
          <option value="">Theme default</option>
          {choices.map((choice) => (
            <option key={choice} value={String(choice)}>
              {choice}
            </option>
          ))}
        </select>
      )}
    </Field>
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
  spec,
  onChange,
  error,
}: {
  block: Block;
  spec: ColorControlSpec;
  onChange: BlockFormProps["onChange"];
  error: string | null;
}) {
  const tokens = usePageTokens();
  const stored = readColor(block);
  // What is being typed, while the hex field has focus; null otherwise, and then the field shows
  // the block's color (so a change from elsewhere, the picker, a reset or undo, shows at once).
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? stored ?? "";

  const themeValue = tokens?.[spec.source];
  const themeColor = typeof themeValue === "string" ? themeValue : undefined;
  // A native color input only takes #rrggbb: a theme color in another form (#RGB, #RRGGBBAA) shows white.
  const swatch = stored ?? (isHexColor(themeColor) ? themeColor : "#FFFFFF");
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
    <Field label={spec.label} error={message} className="flex-1 basis-[220px]">
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
          {hasColorOverride(block) ? (
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
