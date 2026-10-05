"use client";

import { useOptionalWorkspace } from "@/components/workspace/workspace-context";
import { HOME_TARGET, LIMITS } from "@/lib/document";
import { Field, controlClass } from "../field";
import { TextField } from "../text-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/**
 * Page link (M11-07): a button that goes to Home or another page of the site. The label is its text;
 * the target picker lists Home and the site's pages by title (all of them, also the ones left out of
 * the menu). The link is relative and not counted as a click; it draws nothing if its page is
 * deleted later, so a target that is not a page of the site any more says so here.
 */
export function PageLinkForm({ block, onChange, errors }: BlockFormProps) {
  const workspace = useOptionalWorkspace();
  if (block.type !== "page_link") return null;
  const pages = workspace?.site.titles ?? [];
  const known = block.target === HOME_TARGET || pages.some((page) => page.id === block.target);
  const targetError =
    fieldError(errors, block.id, "target") ??
    (known ? null : "That page no longer exists. Choose another.");
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label="Label"
        field="label"
        max={LIMITS.linkLabel}
        value={block.label}
        error={fieldError(errors, block.id, "label")}
        onChange={(label) => onChange({ ...block, label })}
      />
      <Field label="Goes to" error={targetError}>
        {(control) => (
          <select
            {...control}
            data-field="target"
            value={known ? block.target : ""}
            onChange={(event) => onChange({ ...block, target: event.target.value })}
            className={controlClass(targetError !== null)}
          >
            {known ? null : (
              <option value="" disabled>
                Choose a page
              </option>
            )}
            <option value={HOME_TARGET}>Home</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}
