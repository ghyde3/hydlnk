"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DraftDoc } from "@/lib/document";
import type { TokenSet } from "@/lib/theme";
import {
  TEMPLATES,
  defaultTemplateStyle,
  describeTemplate,
  templateById,
  templateFontStylesheetUrl,
  type Template,
  type TemplateId,
  type TemplateStyle,
} from "@/lib/templates";
import { TemplateChoice } from "./template-choice";
import { TemplatePreview } from "./template-preview";

// `a[href]`, not `[href]`: the dialog holds a <link href> for the fonts, which can never take focus.
const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select, textarea";

const SECONDARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 py-2 text-center text-sm font-semibold text-ink";

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
 * "Start from a template" (M6-40, M7-07, M7-08): a native modal `<dialog>` with the six cards of the
 * catalog in their order. Each card shows its name, its one-line description, a small live picture
 * of the page it would give (`TemplatePreview`), what is inside it and the style it applies. On a
 * phone the dialog is a full-screen sheet that scrolls inside itself, the cards in one column; from
 * 760px up it is centered, at most 720px wide, the cards in two columns. Focus starts on the first
 * card's "Use this template", Tab and Shift+Tab wrap inside the dialog, and Escape (or Close)
 * closes it without touching the draft.
 *
 * It is the same for every plan: no Pro chip, no upgrade prompt, no plan check. "Use this template"
 * never applies at once: it opens, in place in that card, the one choice (the template's blocks
 * and style, or its blocks only and the page's own style), with the default that fits the page.
 * `onUse` is told which template and which style; the caller writes the draft.
 */
export function TemplateDialog({
  draft,
  themes,
  onUse,
  onClose,
}: {
  /** The draft on screen: its profile is drawn in every preview, and it decides the default style. */
  draft: DraftDoc;
  /** The token sets of the themes the templates use, by theme id: what each preview is drawn in. */
  themes: Readonly<Record<string, Partial<TokenSet>>>;
  onUse: (id: TemplateId, style: TemplateStyle) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The card whose choice is open, and the style selected in it.
  const [asking, setAsking] = useState<TemplateId | null>(null);
  const [style, setStyle] = useState<TemplateStyle>("template");
  // Cancel puts focus back on the button of the card it was opened from, once that button is back.
  const refocus = useRef<TemplateId | null>(null);
  useScrollLock();

  // One stylesheet for the six themes' fonts, requested while the dialog is open and not before.
  const fontsUrl = useMemo(() => templateFontStylesheetUrl(themes), [themes]);

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

  useEffect(() => {
    const id = refocus.current;
    if (asking !== null || id === null) return;
    refocus.current = null;
    dialog.current
      ?.querySelector<HTMLElement>(`[data-template-id="${id}"] [data-use-template]`)
      ?.focus();
  }, [asking]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    // The previews are inert; nothing in them can take focus, but they are not part of the loop.
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (item) => !item.closest("[inert]"),
    );
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
    // The default is the page's, every time the choice opens: an earlier pick does not stick.
    setStyle(defaultTemplateStyle(draft));
    setAsking(template.id);
  }

  function cancel(template: Template) {
    refocus.current = template.id;
    setAsking(null);
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
      {fontsUrl ? (
        <link
          rel="stylesheet"
          href={fontsUrl}
          data-template-fonts=""
          referrerPolicy="no-referrer"
        />
      ) : null}
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
            const asked = asking === template.id;
            const nameId = `template-${template.id}-name`;
            const descriptionId = `template-${template.id}-description`;
            return (
              <li
                key={template.id}
                data-template-id={template.id}
                aria-labelledby={`${nameId} ${descriptionId}`}
                className="flex min-w-0 flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5"
              >
                <h3 id={nameId} className="m-0 text-base font-semibold">
                  {template.name}
                </h3>
                <p id={descriptionId} className="m-0 text-sm text-text-2">
                  {template.description}
                </p>
                <TemplatePreview
                  template={template}
                  profile={draft.profile}
                  themeTokens={themes[template.theme.id] ?? null}
                />
                <p data-testid="template-inside" className="m-0 text-sm text-text-2">
                  <span className="font-semibold text-ink">Inside:</span>{" "}
                  {describeTemplate(template)}
                </p>
                <p data-testid="template-style" className="m-0 text-sm text-text-2">
                  <span className="font-semibold text-ink">Style:</span> {template.theme.name}
                </p>
                <div aria-live="polite" data-testid="template-action">
                  {asked ? (
                    <TemplateChoice
                      template={template}
                      hasBlocks={draft.blocks.length > 0}
                      style={style}
                      onStyle={setStyle}
                      onApply={() => onUse(template.id, style)}
                      onCancel={() => cancel(template)}
                    />
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
                </div>
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
