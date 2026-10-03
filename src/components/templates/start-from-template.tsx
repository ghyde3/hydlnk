"use client";

import { useCallback, useRef, useState, type Dispatch } from "react";
import type { DraftDoc } from "@/lib/document";
import type { EditorAction } from "@/lib/editor/state";
import type { TokenSet } from "@/lib/theme";
import { TemplateDialog } from "./template-dialog";

/**
 * The "Start from a template" button of the "Add a block" card (M6-40) and the dialog it opens. A
 * secondary button, white with a 1px border, 44px tall, full width on a phone. The same on every
 * plan: nothing here reads the plan. Applying is one editor action (`template/apply`), which the
 * reducer records as one undo step; the dialog closes and focus returns to this button.
 */
export function StartFromTemplate({
  draft,
  themes,
  dispatch,
}: {
  draft: DraftDoc;
  /** The token sets of the template themes, by theme id (loaded on the server with the page). */
  themes: Readonly<Record<string, Partial<TokenSet>>>;
  dispatch: Dispatch<EditorAction>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Back to the button once the dialog has gone.
    setTimeout(() => trigger.current?.focus(), 0);
  }, []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-testid="start-from-template"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink hl:w-fit"
      >
        Start from a template
      </button>
      {open ? (
        <TemplateDialog
          draft={draft}
          themes={themes}
          onClose={close}
          onUse={(id) => {
            dispatch({ type: "template/apply", templateId: id });
            close();
          }}
        />
      ) : null}
    </>
  );
}
