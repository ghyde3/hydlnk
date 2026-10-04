"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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

const SECONDARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-4 py-2 text-center text-sm font-semibold text-ink";

export interface TemplateDialogProps {
  /** Whether the dialog is open: the caller's state. The cards are drawn only while it is. */
  open: boolean;
  /** The draft on screen: its profile is drawn in every preview, and it decides the default style. */
  draft: DraftDoc;
  /** The token sets of the themes the templates use, by theme id: what each preview is drawn in. */
  themes: Readonly<Record<string, Partial<TokenSet>>>;
  onUse: (id: TemplateId, style: TemplateStyle) => void;
  /** Escape or Close: the draft is not touched. */
  onClose: () => void;
  /**
   * The button that opened the dialog. It sits outside the dialog, so the dialog puts focus back on
   * it itself when it closes, for Escape, Close and an apply alike.
   */
  opener?: RefObject<HTMLElement | null>;
}

/**
 * "Start from a template" (M6-40, M7-07, M7-08, M9-06): a modal dialog on `@radix-ui/react-dialog`
 * with the six cards of the catalog in their order. Each card shows its name, its one-line
 * description, a small live picture of the page it would give (`TemplatePreview`), what is inside
 * it and the style it applies. On a phone the dialog is a full-screen sheet that scrolls inside
 * itself, the cards in one column; from 760px up it is centered, at most 720px wide, the cards in
 * two columns.
 *
 *   - Focus starts on the first card's "Use this template"; Tab and Shift+Tab wrap inside (Radix's
 *     focus trap); Escape or Close closes it without touching the draft and puts focus back on the
 *     "Start from a template" button; a press on the backdrop does not close it.
 *   - The page behind does not scroll (Radix removes its scroll and pads for the scrollbar, so
 *     nothing shifts) and is not reachable by Tab; it is hidden from the accessibility tree while
 *     the dialog is open. The dialog is one `role="dialog"` with `aria-modal="true"`, named by its
 *     title and described by its hint, and adds no heading level 1 and no landmark.
 *   - The panel is portaled to the end of `body`.
 *
 * It is the same for every plan: no Pro chip, no upgrade prompt, no plan check. "Use this template"
 * never applies at once: it opens, in place in that card, the one choice (the template's blocks
 * and style, or its blocks only and the page's own style), with the default that fits the page.
 * `onUse` is told which template and which style; the caller writes the draft.
 */
export function TemplateDialog({
  open,
  draft,
  themes,
  onUse,
  onClose,
  opener,
}: TemplateDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/60" />
        <Dialog.Content
          aria-modal="true"
          data-testid="template-dialog"
          onOpenAutoFocus={(event) => {
            // Not the dialog itself: the first card's button.
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)
              ?.querySelector<HTMLElement>("[data-use-template]")
              ?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // The opener is outside the dialog: put focus back on it explicitly.
            event.preventDefault();
            opener?.current?.focus();
          }}
          // The backdrop is not a way out: Escape and Close are.
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 h-dvh w-full overflow-y-auto overscroll-contain bg-surface p-0 text-ink hl:inset-auto hl:top-1/2 hl:left-1/2 hl:h-auto hl:max-h-[calc(100dvh-64px)] hl:w-[720px] hl:max-w-[calc(100vw-64px)] hl:-translate-x-1/2 hl:-translate-y-1/2 hl:rounded-md hl:border hl:border-line"
        >
          <div className="flex flex-col gap-4 p-4 hl:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title asChild>
                  <h2 className="m-0 text-lg font-bold tracking-[-0.01em]">
                    Start from a template
                  </h2>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <p className="mt-1 mb-0 text-sm text-text-2">
                    Pick a starting point, then change anything you like.
                  </p>
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  data-testid="template-close"
                  className={`${SECONDARY} shrink-0`}
                >
                  Close
                </button>
              </Dialog.Close>
            </div>
            <TemplateDialogBody draft={draft} themes={themes} onUse={onUse} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The six cards and the one stylesheet for their fonts: what the dialog shows under its header. It
 * holds the state of the dialog (which card asks its choice, and the style selected in it), so it
 * starts over every time the dialog opens. A separate component so it can be drawn without the
 * Radix shell (the portal draws nothing on the server).
 */
export function TemplateDialogBody({
  draft,
  themes,
  onUse,
}: {
  draft: DraftDoc;
  themes: Readonly<Record<string, Partial<TokenSet>>>;
  onUse: (id: TemplateId, style: TemplateStyle) => void;
}) {
  const scope = useRef<HTMLDivElement>(null);
  // The card whose choice is open, and the style selected in it.
  const [asking, setAsking] = useState<TemplateId | null>(null);
  const [style, setStyle] = useState<TemplateStyle>("template");
  // Cancel puts focus back on the button of the card it was opened from, once that button is back.
  const refocus = useRef<TemplateId | null>(null);

  // One stylesheet for the six themes' fonts, requested while the dialog is open and not before.
  const fontsUrl = useMemo(() => templateFontStylesheetUrl(themes), [themes]);

  useEffect(() => {
    const id = refocus.current;
    if (asking !== null || id === null) return;
    refocus.current = null;
    scope.current
      ?.querySelector<HTMLElement>(`[data-template-id="${id}"] [data-use-template]`)
      ?.focus();
  }, [asking]);

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
    <div ref={scope}>
      {fontsUrl ? (
        <link
          rel="stylesheet"
          href={fontsUrl}
          data-template-fonts=""
          referrerPolicy="no-referrer"
        />
      ) : null}
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
                <span className="font-semibold text-ink">Inside:</span> {describeTemplate(template)}
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
  );
}

// `templateById` is re-exported for the callers that hold only an id.
export { templateById };
