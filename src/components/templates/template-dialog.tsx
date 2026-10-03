"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DraftDoc } from "@/lib/document";
import { resolveTokens, type TokenSet } from "@/lib/theme";
import {
  TEMPLATES,
  templateById,
  templateNeedsConfirmation,
  type Template,
  type TemplateId,
} from "@/lib/templates";

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), select, textarea";

const SECONDARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 py-2 text-center text-sm font-semibold text-ink";
const DANGER =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-bad bg-surface px-4 py-2 text-center text-sm font-semibold text-bad";

/** The confirmation's question: said once, here, so the card and a test read the same words. */
export const replaceQuestion = (name: string): string =>
  `Replace your blocks and style with the ${name} template? Your name, photo and saved themes stay. You can undo this.`;

/**
 * Keeps the page behind a modal dialog from scrolling (M6-40): `showModal` makes it inert, but a
 * wheel or a touch drag that runs out of the dialog's own scroll would still move the page. The
 * previous value is put back when the dialog goes.
 */
function useScrollLock(): void {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);
}

/**
 * "Start from a template" (M6-40): a native modal `<dialog>` with the six cards of the catalog in
 * their order. On a phone it is a full-screen sheet that scrolls inside itself, the cards in one
 * column; from 760px up it is centered, at most 720px wide, the cards in two columns. Focus starts
 * on the first card's "Use this template", Tab and Shift+Tab wrap inside the dialog, and Escape (or
 * Close) closes it without touching the draft.
 *
 * It is the same for every plan: no Pro chip, no upgrade prompt, no plan check. A page that has
 * content, a theme or page-level style asks first, inline in the card that was pressed; an empty
 * page applies at once. `onUse` is told which template; the caller writes the draft.
 */
export function TemplateDialog({
  draft,
  themes,
  onUse,
  onClose,
}: {
  /** The draft on screen: what applying would replace decides whether to ask first. */
  draft: DraftDoc;
  /** The token sets of the themes the templates use, by theme id: the cards' color strips. */
  themes: Readonly<Record<string, Partial<TokenSet>>>;
  onUse: (id: TemplateId) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState<TemplateId | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useScrollLock();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // jsdom has no showModal: the dialog is then just open, which is enough for a unit test.
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    else element.setAttribute("open", "");
    element.querySelector<HTMLElement>("[data-use-template]")?.focus();
    return () => {
      if (typeof element.close === "function" && element.open) element.close();
    };
  }, []);

  // The confirmation takes focus on its safe button, so Enter twice never replaces the page.
  useEffect(() => {
    if (confirming !== null) keep.current?.focus();
  }, [confirming]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function press(template: Template) {
    if (templateNeedsConfirmation(draft)) setConfirming(template.id);
    else onUse(template.id);
  }

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby="template-dialog-title"
      aria-describedby="template-dialog-hint"
      data-testid="template-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      className="m-0 h-dvh max-h-dvh w-screen max-w-none overflow-y-auto overscroll-contain rounded-none border-0 bg-surface p-0 text-ink backdrop:bg-ink/60 hl:m-auto hl:h-auto hl:max-h-[calc(100dvh-64px)] hl:w-[720px] hl:max-w-[calc(100vw-64px)] hl:rounded-md hl:border hl:border-line"
    >
      <div className="flex flex-col gap-4 p-4 hl:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="template-dialog-title" className="m-0 text-lg font-bold tracking-[-0.01em]">
              Start from a template
            </h2>
            <p id="template-dialog-hint" className="mt-1 mb-0 text-sm text-text-2">
              Pick a starting point, then change anything you like.
            </p>
          </div>
          <button
            type="button"
            data-testid="template-close"
            onClick={onClose}
            className={`${SECONDARY} shrink-0`}
          >
            Close
          </button>
        </div>

        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 hl:grid-cols-2">
          {TEMPLATES.map((template) => {
            const colors = resolveTokens(themes[template.theme.id] ?? null, {});
            const asking = confirming === template.id;
            return (
              <li
                key={template.id}
                data-template-id={template.id}
                className="flex min-w-0 flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5"
              >
                <h3 className="m-0 text-base font-semibold">{template.name}</h3>
                <p className="m-0 text-sm text-text-2">{template.description}</p>
                <div
                  aria-hidden="true"
                  data-testid="template-colors"
                  className="flex h-8 w-full overflow-hidden rounded-sm border border-line-2"
                >
                  <span
                    data-color="bg"
                    className="block flex-[3]"
                    style={{ background: colors.bg }}
                  />
                  <span
                    data-color="accent"
                    className="block flex-1"
                    style={{ background: colors.accent }}
                  />
                </div>
                {asking ? (
                  <div
                    role="group"
                    aria-label={`Replace your page with the ${template.name} template`}
                    data-testid="template-confirm"
                    className="flex flex-col gap-2.5"
                  >
                    <p role="alert" className="m-0 text-sm text-ink">
                      {replaceQuestion(template.name)}
                    </p>
                    <div className="flex flex-col gap-2 hl:flex-row">
                      <button
                        type="button"
                        data-testid="template-replace"
                        onClick={() => onUse(template.id)}
                        className={`${DANGER} hl:flex-1`}
                      >
                        Replace my page
                      </button>
                      <button
                        ref={keep}
                        type="button"
                        data-testid="template-keep"
                        onClick={onClose}
                        className={`${SECONDARY} hl:flex-1`}
                      >
                        Keep my page
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-use-template=""
                    aria-label={`Use the ${template.name} template`}
                    onClick={() => press(template)}
                    className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface"
                  >
                    Use this template
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}

// `templateById` is re-exported for the callers that hold only an id.
export { templateById };
