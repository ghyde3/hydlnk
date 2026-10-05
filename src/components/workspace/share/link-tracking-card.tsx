"use client";

import { useEffect, useId, useRef } from "react";
import { Field, controlClass } from "@/components/blocks/field";
import {
  UTM_KEYS,
  UTM_LABELS,
  UTM_PLACEHOLDERS,
  UTM_VALUE_MAX,
  codePointLength,
  utmExample,
  utmValueError,
  type PublishError,
  type UtmKey,
} from "@/lib/document";
import { isPageUtmEmpty, withPageUtmValue, withoutPageUtm } from "@/lib/editor/link-fields";
import { useWorkspace } from "../workspace-context";
import { CARD, CARD_TITLE, SECONDARY_BUTTON } from "./styles";

export const LINK_TRACKING_HINT =
  "Added to the end of every link on your site, such as ?utm_source=hydlnk. Email and phone links are left alone.";

/** The Publish gate's message for one page default (`utm.source`, `utm.medium`, `utm.campaign`). */
function gateMessage(errors: readonly PublishError[], key: UtmKey): string | null {
  return (
    errors.find((error) => error.blockId === null && error.field === `utm.${key}`)?.message ?? null
  );
}

/**
 * The 'Link tracking' card of the Share tab (M9-28), after the share card: the page's default UTM
 * tags, Source, Medium and Campaign (16px inputs, 44px, at most 40 characters, counters), a 'Clear all'
 * button and a live example line built by `withUtm`, the very function the click redirect uses, so it
 * can never disagree with what visitors get.
 *
 * Every edit writes `draft.utm` through the workspace (one undo step per field, typing coalesces,
 * autosave, 'Unpublished changes'); an emptied field removes its key. The pattern error shows while
 * typing (the draft saves anyway); the Publish gate's message shows under the exact field after a
 * refusal and the card moves focus to the first invalid one. On every plan: no Pro chip.
 */
export function LinkTrackingCard() {
  const { draft, editDraft, state } = useWorkspace();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const utm = draft.utm;
  const empty = isPageUtmEmpty(utm);
  const errors = state.publishErrors;

  // A failed Publish names a default: focus the first invalid field of the card.
  const gateKeys = UTM_KEYS.filter((key) => gateMessage(errors, key) !== null);
  const failedKey = gateKeys[0] ?? null;
  const failureSignal = failedKey === null ? null : errors;
  useEffect(() => {
    if (failureSignal === null || failedKey === null) return;
    const control = sectionRef.current?.querySelector<HTMLElement>(
      `[data-field="utm-${failedKey}"]`,
    );
    if (!control || document.activeElement === control) return;
    control.scrollIntoView({ block: "center" });
    control.focus({ preventScroll: true });
    // Only a new set of Publish errors asks for focus, not every keystroke that keeps one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureSignal]);

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      id="link-tracking"
      data-testid="link-tracking-card"
      className={CARD}
    >
      <h2 id={headingId} className={CARD_TITLE}>
        Link tracking
      </h2>

      <div className="flex flex-wrap gap-3">
        {UTM_KEYS.map((key) => {
          const value = utm?.[key] ?? "";
          const typed = value.trim() === "" ? null : utmValueError(value);
          const error = gateMessage(errors, key) ?? typed;
          return (
            <Field
              key={key}
              label={UTM_LABELS[key]}
              error={error}
              className="flex-1 basis-[180px]"
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
                  placeholder={UTM_PLACEHOLDERS[key]}
                  onChange={(event) =>
                    editDraft(
                      (current) => withPageUtmValue(current, key, event.target.value),
                      `utm:${key}`,
                    )
                  }
                  className={controlClass(error !== null, "font-mono")}
                />
              )}
            </Field>
          );
        })}
      </div>

      <p className="m-0 text-[13px] text-text-2">{LINK_TRACKING_HINT}</p>
      <p
        data-testid="utm-example"
        className="m-0 font-mono text-[12px] text-text-2 [overflow-wrap:anywhere]"
      >
        {utmExample(utm)}
      </p>

      <div>
        <button
          type="button"
          data-testid="utm-clear-all"
          disabled={empty}
          onClick={() => editDraft((current) => withoutPageUtm(current), "utm:clear")}
          className={SECONDARY_BUTTON}
        >
          Clear all
        </button>
      </div>
    </section>
  );
}
