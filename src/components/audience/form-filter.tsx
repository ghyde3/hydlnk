"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";
import { AUDIENCE_ALL_FORMS, AUDIENCE_PATH, AUDIENCE_TEST_IDS } from "@/lib/forms/contract";

/** Which form's submissions the list shows (`?form=all|{blockId}`); choosing one starts at page 1. */
export function FormFilter({
  forms,
  value,
}: {
  forms: readonly { blockId: string; label: string; total: number }[];
  value: string;
}) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        Form
      </label>
      <select
        id={id}
        data-testid={AUDIENCE_TEST_IDS.filter}
        value={value}
        onChange={(event) => {
          const form = event.target.value;
          router.push(
            form === AUDIENCE_ALL_FORMS
              ? AUDIENCE_PATH
              : `${AUDIENCE_PATH}?form=${encodeURIComponent(form)}`,
          );
        }}
        className="min-h-11 w-full min-w-0 rounded-md border border-line-3 bg-surface px-3 text-base text-ink hl:w-[320px]"
      >
        <option value={AUDIENCE_ALL_FORMS}>All forms</option>
        {forms.map((form) => (
          <option key={form.blockId} value={form.blockId}>
            {form.label} ({form.total})
          </option>
        ))}
      </select>
    </div>
  );
}
