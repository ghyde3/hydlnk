"use client";

import { useOptionalWorkspace } from "@/components/workspace/workspace-context";
import { FORM_KINDS, LIMITS, switchFormKind, type FormBlock, type FormKind } from "@/lib/document";
import { FORM_TEST_IDS } from "@/lib/forms/contract";
import { Field, controlClass } from "../field";
import { CountedField } from "./counted-field";
import { OverrideControls } from "./override-controls";
import { SwitchRow } from "./switch-row";
import { fieldError, type BlockFormProps } from "./types";

const KIND_OPTIONS: Record<FormKind, string> = { signup: "Sign-up", contact: "Contact" };

/**
 * The form block (M17-07): its kind, an optional heading and description, "Ask for a name" (sign-up
 * only), the button label, the success message, the consent line and "Email me each message"
 * (contact only, to the account's own sign-in address), then the block's own style. Switching the
 * kind swaps the button label and success message only while they still hold the old kind's words.
 */
export function FormForm({ block, onChange, errors }: BlockFormProps) {
  const workspace = useOptionalWorkspace();
  if (block.type !== "form") return null;
  const form: FormBlock = block;
  const optional = (key: "heading" | "description", value: string) => {
    const { [key]: _dropped, ...rest } = form;
    void _dropped;
    onChange(value === "" ? rest : { ...rest, [key]: value });
  };
  const address = workspace?.accountEmail;
  return (
    <div data-testid={FORM_TEST_IDS.editor} className="flex flex-col gap-3">
      <Field label="Kind" error={fieldError(errors, form.id, "kind")} className="w-48 flex-none">
        {(control) => (
          <select
            {...control}
            data-field="kind"
            data-testid={FORM_TEST_IDS.kind}
            value={form.kind}
            onChange={(event) => onChange(switchFormKind(form, event.target.value as FormKind))}
            className={controlClass(false)}
          >
            {FORM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_OPTIONS[kind]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <CountedField
        label="Heading (optional)"
        field="heading"
        max={LIMITS.formHeading}
        value={form.heading ?? ""}
        error={fieldError(errors, form.id, "heading")}
        onChange={(heading) => optional("heading", heading)}
      />
      <CountedField
        label="Description (optional)"
        field="description"
        max={LIMITS.formDescription}
        value={form.description ?? ""}
        error={fieldError(errors, form.id, "description")}
        onChange={(description) => optional("description", description)}
      />
      {form.kind === "signup" ? (
        <SwitchRow
          label="Ask for a name"
          hint="Adds an optional name field above the email address."
          on={form.askName === true}
          field="askName"
          onToggle={() => onChange({ ...form, askName: !form.askName })}
        />
      ) : null}
      <CountedField
        label="Button label"
        field="buttonLabel"
        max={LIMITS.formButton}
        value={form.buttonLabel}
        error={fieldError(errors, form.id, "buttonLabel")}
        onChange={(buttonLabel) => onChange({ ...form, buttonLabel })}
      />
      <CountedField
        label="Message after sending"
        field="successMessage"
        max={LIMITS.formSuccess}
        value={form.successMessage}
        error={fieldError(errors, form.id, "successMessage")}
        onChange={(successMessage) => onChange({ ...form, successMessage })}
      />
      <CountedField
        label="Consent line"
        field="consent"
        max={LIMITS.formConsent}
        value={form.consent}
        error={fieldError(errors, form.id, "consent")}
        onChange={(consent) => onChange({ ...form, consent })}
      />
      {form.kind === "contact" ? (
        <div data-testid={FORM_TEST_IDS.notify}>
          <SwitchRow
            label="Email me each message"
            hint={
              address
                ? `Messages go to ${address}, your sign-in address.`
                : "Messages go to your sign-in address."
            }
            on={form.notify === true}
            field="notify"
            onToggle={() => onChange({ ...form, notify: !form.notify })}
          />
        </div>
      ) : null}
      <OverrideControls block={form} onChange={onChange} errors={errors} />
    </div>
  );
}
