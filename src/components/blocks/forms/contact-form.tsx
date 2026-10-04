"use client";

import {
  EMAIL_ERROR_MESSAGE,
  LIMITS,
  PHONE_ERROR_MESSAGE,
  isEmailAddress,
  isPhoneNumber,
  type ContactBlock,
} from "@/lib/document";
import { TextAreaField } from "../text-field";
import { CountedField } from "./counted-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/**
 * Contact details (M9-17): a name, a phone number, an email address and the hours, then the block's
 * own style. The phone and email rules show as the person types (the draft saves anyway); Publish
 * names the exact field. The page draws `tel:` and `mailto:` links and a "Save contact" button, so
 * at least one of phone and email is required, and the error for that sits on the phone field.
 */
export function ContactForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "contact") return null;
  const contact: ContactBlock = block;
  return (
    <div className="flex flex-col gap-3">
      <CountedField
        label="Name"
        field="name"
        max={LIMITS.contactName}
        value={contact.name}
        error={fieldError(errors, contact.id, "name")}
        onChange={(name) => onChange({ ...contact, name })}
      />
      <div className="flex flex-wrap gap-3">
        <CountedField
          label="Phone"
          field="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+1 555 123 4567"
          max={LIMITS.contactPhone}
          value={contact.phone}
          error={fieldError(errors, contact.id, "phone")}
          invalidWhen={(value) =>
            value.trim() !== "" && !isPhoneNumber(value.trim()) ? PHONE_ERROR_MESSAGE : null
          }
          onChange={(phone) => onChange({ ...contact, phone })}
          className="flex-1 basis-[220px]"
        />
        <CountedField
          label="Email"
          field="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          max={LIMITS.email}
          value={contact.email}
          error={fieldError(errors, contact.id, "email")}
          invalidWhen={(value) =>
            value.trim() !== "" && !isEmailAddress(value.trim()) ? EMAIL_ERROR_MESSAGE : null
          }
          onChange={(email) => onChange({ ...contact, email })}
          className="flex-1 basis-[220px]"
        />
      </div>
      <TextAreaField
        label="Hours"
        field="hours"
        max={LIMITS.contactHours}
        rows={3}
        value={contact.hours}
        error={fieldError(errors, contact.id, "hours")}
        onChange={(hours) => onChange({ ...contact, hours })}
      />
      <OverrideControls block={contact} onChange={onChange} errors={errors} />
    </div>
  );
}
