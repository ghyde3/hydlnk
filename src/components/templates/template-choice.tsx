"use client";

import { useEffect, useRef } from "react";
import type { Template, TemplateStyle } from "@/lib/templates";

const SECONDARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 py-2 text-center text-sm font-semibold text-ink";
const PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 py-2 text-center text-sm font-semibold text-surface";

/** The words of the two choices, said once here so the panel and a test read the same. */
export const templateStyleLabel = (template: Template, style: TemplateStyle): string =>
  style === "template"
    ? `Use the blocks and the ${template.theme.name} style`
    : "Use the blocks only and keep my current style";

/**
 * One row of the choice: a native radio laid over its whole row (border included), invisible, so
 * the row is the touch target (at least 44px tall, the full width) and the keyboard and screen
 * reader get a real radio; a drawn circle beside the words shows the state.
 */
function StyleRow({
  name,
  value,
  checked,
  label,
  onSelect,
}: {
  name: string;
  value: TemplateStyle;
  checked: boolean;
  label: string;
  onSelect: (value: TemplateStyle) => void;
}) {
  return (
    <label
      data-style-option={value}
      className="relative flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line-3 bg-surface px-3 py-2.5 text-sm text-ink has-[:checked]:border-ink has-[:checked]:bg-page has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass"
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="peer absolute -inset-px m-0 h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className="mt-px grid size-5 shrink-0 place-items-center rounded-full border-2 border-line-3 peer-checked:border-ink peer-checked:[&>span]:scale-100"
      >
        <span className="size-2.5 scale-0 rounded-full bg-ink" />
      </span>
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}

/**
 * The one choice an apply asks (M7-08), in place of the "Use this template" button of the card
 * that was pressed: take the template's blocks and its style, or its blocks only and keep the
 * page's own. Two native radios, what stays and what is replaced, "Apply template" and "Cancel".
 * Focus lands on the checked radio. The caller owns what is selected (it resets to the page's
 * default every time the panel opens) and what Apply and Cancel do.
 */
export function TemplateChoice({
  template,
  hasBlocks,
  style,
  onStyle,
  onApply,
  onCancel,
}: {
  template: Template;
  /** Whether the page has blocks that applying would replace. */
  hasBlocks: boolean;
  style: TemplateStyle;
  onStyle: (style: TemplateStyle) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>("input[type=radio]:checked")?.focus();
  }, []);

  const name = `template-style-${template.id}`;
  return (
    <div
      ref={panel}
      role="group"
      aria-label={`Apply the ${template.name} template`}
      data-testid="template-choice"
      className="flex flex-col gap-3"
    >
      <div role="radiogroup" aria-label="Style" className="flex flex-col gap-2">
        <StyleRow
          name={name}
          value="template"
          checked={style === "template"}
          label={templateStyleLabel(template, "template")}
          onSelect={onStyle}
        />
        <StyleRow
          name={name}
          value="keep"
          checked={style === "keep"}
          label={templateStyleLabel(template, "keep")}
          onSelect={onStyle}
        />
      </div>
      <p className="m-0 text-sm text-text-2">
        Your name, photo, share card and saved themes stay.
        {hasBlocks ? <span className="mt-1 block">Your current blocks are replaced.</span> : null}
      </p>
      <div className="flex flex-col gap-2 hl:flex-row">
        <button
          type="button"
          data-testid="template-apply"
          onClick={onApply}
          className={`${PRIMARY} hl:flex-1`}
        >
          Apply template
        </button>
        <button
          type="button"
          data-testid="template-cancel"
          onClick={onCancel}
          className={`${SECONDARY} hl:flex-1`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
