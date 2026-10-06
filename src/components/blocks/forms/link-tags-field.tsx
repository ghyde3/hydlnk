"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { useOptionalWorkspace } from "@/components/workspace/workspace-context";
import {
  UTM_KEYS,
  UTM_LABELS,
  UTM_PLACEHOLDERS,
  UTM_VALUE_MAX,
  codePointLength,
  isHttpUrl,
  utmExample,
  utmValueError,
  type LinkBlock,
  type PublishError,
  type UtmKey,
} from "@/lib/document";
import {
  linkTagsMode,
  withLinkTagsMode,
  withLinkUtmValue,
  type LinkTagsMode,
} from "@/lib/editor/link-fields";
import { Field, controlClass } from "../field";

/**
 * 'Link tags' (M9-28): this link's own UTM tags, under 'Style this block'. A segmented control,
 * 'Page defaults | Custom | None' (each 44px): the first removes the key from the draft and follows
 * the page's defaults (the Share tab's 'Link tracking' card); 'Custom' shows Source, Medium and
 * Campaign, each empty one following the page default; 'None' writes `off: true`. A live example
 * line, built by the very function the redirect uses (`withUtm`), shows what this link's own address
 * becomes. Every edit is one undo step (typing in one field coalesces). On every plan.
 *
 * Values are drawn as text. The pattern error shows while typing (the draft saves anyway) and the
 * Publish gate's message under the exact field after a refusal.
 */

const MODES: readonly { id: LinkTagsMode; label: string }[] = [
  { id: "defaults", label: "Page defaults" },
  { id: "custom", label: "Custom" },
  { id: "none", label: "None" },
];

export const LINK_TAGS_HINT =
  "Added to the end of this link when someone opens it. Email and phone links are left alone.";

/** The Publish gate's message for one of this link's tag values (`utm.source`, `utm.medium`, `utm.campaign`). */
export function utmErrorOf(
  errors: readonly PublishError[],
  blockId: string,
  key: UtmKey,
): string | null {
  const hit = errors.find(
    (error) =>
      error.blockId === blockId && error.itemId === undefined && error.field === `utm.${key}`,
  );
  return hit ? hit.message : null;
}

export function LinkTagsField({
  block,
  errors,
  onChange,
}: {
  block: LinkBlock;
  errors: readonly PublishError[];
  onChange: (next: LinkBlock) => void;
}) {
  const workspace = useOptionalWorkspace();
  const pageUtm = workspace?.draft.utm;
  const mode = linkTagsMode(block.utm);
  const groupId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // The link's own address when it is a valid one, else the generic example.
  const address = block.url.trim();
  const example = utmExample(pageUtm, block.utm, isHttpUrl(address) ? address : undefined);

  function choose(next: LinkTagsMode, focus = false): void {
    onChange(withLinkTagsMode(block, next));
    if (focus) buttons.current[MODES.findIndex((entry) => entry.id === next)]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = MODES[(index + step + MODES.length) % MODES.length]!;
    choose(next.id, true);
  }

  return (
    <div data-testid="link-tags-field" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span id={groupId} className="text-[13px] font-semibold text-ink-2">
          Link tags
        </span>
        <div
          role="radiogroup"
          aria-labelledby={groupId}
          className="grid grid-cols-3 gap-1.5 sm:max-w-[420px]"
        >
          {MODES.map((entry, index) => {
            const selected = entry.id === mode;
            return (
              <button
                key={entry.id}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                data-mode={entry.id}
                onClick={() => choose(entry.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`min-h-11 rounded-md border px-2 text-[13px] font-medium ${
                  selected ? "border-ink bg-ink text-surface" : "border-line-3 bg-surface text-ink"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="m-0 text-xs text-text-2">{LINK_TAGS_HINT}</p>
      </div>

      {mode === "custom" ? (
        <div className="flex flex-wrap gap-3">
          {UTM_KEYS.map((key) => {
            const value = block.utm?.[key] ?? "";
            const typed = value.trim() === "" ? null : utmValueError(value);
            const error = utmErrorOf(errors, block.id, key) ?? typed;
            return (
              <Field
                key={key}
                label={UTM_LABELS[key]}
                error={error}
                className="flex-1 basis-[160px]"
                suffix={
                  <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
                    {codePointLength(value)} / {UTM_VALUE_MAX}
                  </span>
                }
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={value}
                    data-field={`utm-${key}`}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder={pageUtm?.[key]?.trim() || UTM_PLACEHOLDERS[key]}
                    onChange={(event) => onChange(withLinkUtmValue(block, key, event.target.value))}
                    className={controlClass(error !== null, "font-mono")}
                  />
                )}
              </Field>
            );
          })}
        </div>
      ) : null}

      {mode !== "none" ? (
        <p
          data-testid="link-utm-example"
          className="m-0 font-mono text-[12px] text-text-2 [overflow-wrap:anywhere]"
        >
          {example}
        </p>
      ) : null}
    </div>
  );
}
