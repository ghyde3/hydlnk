"use client";

import { LIMITS } from "@/lib/document";
import { TextAreaField, TextField } from "../text-field";
import { UrlField } from "../url-field";
import { fieldError, type BlockFormProps } from "./types";

/** Link button: label and address. The per-block style override is Milestone 3. */
export function LinkForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "link") return null;
  return (
    <div className="flex flex-wrap gap-3">
      <TextField
        label="Label"
        field="label"
        max={LIMITS.linkLabel}
        value={block.label}
        error={fieldError(errors, block.id, "label")}
        onChange={(label) => onChange({ ...block, label })}
        className="flex-1 basis-[220px]"
      />
      <UrlField
        value={block.url}
        error={fieldError(errors, block.id, "url")}
        onChange={(url) => onChange({ ...block, url })}
        className="flex-1 basis-[220px]"
      />
    </div>
  );
}

export function HeaderForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "header") return null;
  return (
    <TextField
      label="Text"
      field="text"
      max={LIMITS.headerText}
      value={block.text}
      error={fieldError(errors, block.id, "text")}
      onChange={(text) => onChange({ ...block, text })}
    />
  );
}

export function TextForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "text") return null;
  return (
    <TextAreaField
      label="Text"
      field="text"
      max={LIMITS.text}
      value={block.text}
      error={fieldError(errors, block.id, "text")}
      onChange={(text) => onChange({ ...block, text })}
    />
  );
}

/** A divider has nothing to edit: the panel's Move and Delete buttons are the whole form. */
export function DividerForm(): null {
  return null;
}
