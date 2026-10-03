"use client";

import { LIMITS } from "@/lib/document";
import { TextField } from "../text-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/** Header: the heading's text, then its own style (the heading's color: M6-46). */
export function HeaderForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "header") return null;
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Text"
        field="text"
        max={LIMITS.headerText}
        value={block.text}
        error={fieldError(errors, block.id, "text")}
        onChange={(text) => onChange({ ...block, text })}
      />
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}

/** The text block's form, with its formatting toolbar and link panel (M6-30), lives in ./text-form. */
export { TextForm } from "./text-form";

/**
 * A divider has no content to edit (M6-46): its form is its own style, the line's color. The
 * panel's Move and Delete buttons come after it.
 */
export function DividerForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "divider") return null;
  return <OverrideControls block={block} onChange={onChange} errors={errors} />;
}
