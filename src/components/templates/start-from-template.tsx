"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type Dispatch } from "react";
import type { DraftDoc } from "@/lib/document";
import type { EditorAction } from "@/lib/editor/state";
import type { TokenSet } from "@/lib/theme";

/**
 * The dialog is loaded when it is first opened, not with the editor (M9-06): the editor's first
 * load carries none of the dialog's code or of the library under it. `ssr: false`: it is only ever
 * drawn after a press.
 */
const TemplateDialog = dynamic(
  () => import("./template-dialog").then((module) => module.TemplateDialog),
  { ssr: false },
);

/**
 * The "Start from a template" button of the "Add a block" card (M6-40) and the dialog it opens. A
 * secondary button, white with a 1px border, 44px tall, full width on a phone. The same on every
 * plan: nothing here reads the plan. Applying is one editor action (`template/apply`, with the
 * style the person chose in the dialog), which the reducer records as one undo step; the dialog
 * closes and puts focus back on this button.
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
  // Once the dialog has been opened its code is loaded, and it stays mounted (closed, it draws nothing).
  const [loaded, setLoaded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-testid="start-from-template"
        aria-haspopup="dialog"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-sm font-semibold text-ink hl:w-fit"
      >
        Start from a template
      </button>
      {loaded ? (
        <TemplateDialog
          open={open}
          draft={draft}
          themes={themes}
          opener={trigger}
          onClose={() => setOpen(false)}
          onUse={(id, style) => {
            dispatch({ type: "template/apply", templateId: id, style });
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
