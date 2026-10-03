"use client";

import { LIMITS } from "@/lib/document";
import { TextField } from "../text-field";
import { UrlField } from "../url-field";
import { featuredError, LinkFeatureField } from "./link-feature-field";
import { iconError, LinkIconField } from "./link-icon-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/**
 * Link button: label and address, then its icon or thumbnail (M6-21), the "Feature this link"
 * switch (M6-22) and the block's three override controls (Button style, Color, Corner radius:
 * M3-17, M3-18). There is no schedule field: scheduled links are out of v1.
 *
 * `icon` and `featured` are block fields, not overrides: the override controls never see them.
 */
export function LinkForm({ block, onChange, onImage, errors }: BlockFormProps) {
  if (block.type !== "link") return null;
  return (
    <div className="flex flex-col gap-3">
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
      <LinkIconField
        block={block}
        error={iconError(errors, block.id)}
        onChange={onChange}
        onImage={onImage}
      />
      <LinkFeatureField block={block} error={featuredError(errors, block.id)} onChange={onChange} />
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}
