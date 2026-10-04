"use client";

import { LIMITS, type DiscountBlock } from "@/lib/document";
import { UrlField } from "../url-field";
import { CountedField } from "./counted-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/** The Publish rule for a code: no whitespace (and the control and bidi characters the gate also refuses). */
const NO_SPACES = /[\s\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/**
 * Discount code (M9-19): the code (a 16px mono input, no spaces), a one-line description and an
 * optional shop link, then the block's own style. The shop link is the shared URL field, so it has
 * the usual address message and the blocked-site error. On the page the code is selectable and a
 * Copy button appears when the page's script runs; the editor preview never shows that button.
 */
export function DiscountForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "discount") return null;
  const discount: DiscountBlock = block;
  return (
    <div className="flex flex-col gap-3">
      <CountedField
        label="Code"
        field="code"
        mono
        max={LIMITS.discountCode}
        value={discount.code}
        error={fieldError(errors, discount.id, "code")}
        invalidWhen={(value) =>
          NO_SPACES.test(value.trim()) ? "Enter a code with no spaces." : null
        }
        onChange={(code) => onChange({ ...discount, code })}
      />
      <CountedField
        label="Description"
        field="description"
        max={LIMITS.discountDescription}
        value={discount.description}
        error={fieldError(errors, discount.id, "description")}
        onChange={(description) => onChange({ ...discount, description })}
      />
      <UrlField
        label="Shop link (optional)"
        optional
        value={discount.url ?? ""}
        error={fieldError(errors, discount.id, "url")}
        onChange={(url) => onChange({ ...discount, url })}
      />
      <OverrideControls block={discount} onChange={onChange} errors={errors} />
    </div>
  );
}
