"use client";

import {
  useId,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  LIMITS,
  MARK_MESSAGES,
  URL_ERROR_MESSAGE,
  addLinkMark,
  adjustMarks,
  codePointLength,
  isFormatted,
  isHttpUrl,
  linkAt,
  linkMarksOf,
  linksOverlapping,
  newBlockId,
  normalizeUrl,
  removeLinkMark,
  setLinkUrl,
  singleLine,
  sortMarks,
  textBetween,
  toCodePointOffset,
  toUtf16Index,
  toggleFormat,
  truncateToCodePoints,
  type Block,
  type FormatType,
  type LinkMark,
  type Mark,
  type PublishError,
  type TextBlock,
} from "@/lib/document";
import { FORM_BUTTON, FORM_BUTTON_DANGER, Field, controlClass } from "../field";
import { clampMultiline } from "../text-field";
import { UrlField } from "../url-field";
import { OverrideControls } from "./override-controls";
import { fieldError, type BlockFormProps } from "./types";

/**
 * The text block's form (M2-16, M6-30): a formatting toolbar (Bold, Italic, Link), the textarea, the
 * link panel and the list of links in the text.
 *
 * Formatting is data, never syntax in the text: Bold and Italic write `{type, start, end}` marks and
 * a link writes `{type: 'link', start, end, id, url}` into the draft's `marks`, with offsets counted
 * in code points of the text as typed. `adjustMarks` runs on every input event, so the marks follow
 * the text (typing, deleting, pasting and the textarea's own undo and redo included). A toolbar action
 * is one draft change; a block that was plain text gets no `marks` key until the toolbar is used, and
 * loses it again when the last mark goes.
 *
 * The toolbar's buttons never take focus from the textarea on a press (mousedown is prevented), so
 * the selection stays and a phone keyboard stays open.
 */

type PanelTarget =
  | { mode: "add"; start: number; end: number }
  | { mode: "edit"; id: string; start: number; end: number };
/** The link panel: its target and the text it was opened on (when the text changes, it closes). */
type Panel = PanelTarget & { text: string };

const PRIMARY_BUTTON =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";

const TOOLBAR_BUTTON = `${FORM_BUTTON} aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface`;

/** `block` with `marks`, or without the key when there are none: a plain block stays byte-identical. */
function withMarks(block: TextBlock, marks: readonly Mark[]): TextBlock {
  const next: TextBlock = { ...block };
  if (marks.length > 0) next.marks = marks.slice() as NonNullable<TextBlock["marks"]>;
  else delete next.marks;
  return next;
}

/** The first 60 characters of the text a link covers, on one line. */
function linkedText(text: string, link: LinkMark): string {
  return truncateToCodePoints(singleLine(textBetween(text, link.start, link.end)).trim(), 60);
}

export function TextForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "text") return null;
  // The block's own style (M6-46) sits under its text, links and formatting, in its own group.
  return (
    <div className="flex flex-col gap-3">
      <TextFormBody block={block} onChange={onChange} errors={errors} />
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}

function TextFormBody({
  block,
  onChange,
  errors,
}: {
  block: TextBlock;
  onChange: (next: Block) => void;
  errors: PublishError[];
}) {
  const marks = (block.marks ?? []) as Mark[];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addressRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const hintId = useId();
  const limitId = useId();

  // The selection in code points, as the textarea last reported it: it decides which buttons work.
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [roving, setRoving] = useState(0);
  const [panelState, setPanel] = useState<Panel | null>(null);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [addressTick, setAddressTick] = useState(0);

  const links = sortMarks(linkMarksOf(marks));
  // A panel belongs to the text it was opened on: when the text changes (typing, undo), it closes.
  const panel =
    panelState && panelState.text === block.text
      ? panelState.mode === "edit" && !links.some((link) => link.id === panelState.id)
        ? null
        : panelState
      : null;

  /** The textarea's selection in code points (what the toolbar acts on). */
  const readSelection = () => {
    const el = textareaRef.current;
    if (!el) return selection;
    return {
      start: toCodePointOffset(el.value, el.selectionStart),
      end: toCodePointOffset(el.value, el.selectionEnd),
    };
  };

  const syncSelection = () => {
    const next = readSelection();
    setSelection((previous) =>
      previous.start === next.start && previous.end === next.end ? previous : next,
    );
  };

  /** Puts the focus and the selection back into the textarea after the draft has updated. */
  const restoreSelection = (start: number, end: number) => {
    pending.current = { start, end };
    setFocusTick((tick) => tick + 1);
  };

  useLayoutEffect(() => {
    const range = pending.current;
    if (!range) return;
    pending.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(toUtf16Index(el.value, range.start), toUtf16Index(el.value, range.end));
    setSelection(range);
  }, [focusTick]);

  // The browser's own selection changes (a drag, the touch handles, a long press, find) reach the
  // toolbar even when no key or mouse event of ours saw them.
  const syncRef = useRef(syncSelection);
  useLayoutEffect(() => {
    syncRef.current = syncSelection;
  });
  useEffect(() => {
    const onChange = () => {
      if (document.activeElement === textareaRef.current) syncRef.current();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  // Opening the panel moves the focus to its address field.
  useEffect(() => {
    if (addressTick === 0) return;
    addressRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [addressTick]);

  /** One draft change with the new marks; refused when it would leave too many. */
  const commitMarks = (next: Mark[], range: { start: number; end: number }): boolean => {
    if (next.length > LIMITS.textMarks && next.length > marks.length) {
      setNotice(MARK_MESSAGES.editorTooMany);
      return false;
    }
    setNotice(null);
    onChange(withMarks(block, next));
    restoreSelection(range.start, range.end);
    return true;
  };

  const handleText = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = clampMultiline(event.target.value, LIMITS.text);
    if (text === block.text) return;
    setNotice(null);
    // The marks follow the text: this runs on every input event, undo and redo included.
    const adjusted = adjustMarks(block.text, text, marks);
    const next: TextBlock = { ...block, text };
    if (adjusted.length > 0) next.marks = adjusted as NonNullable<TextBlock["marks"]>;
    else delete next.marks;
    onChange(next);
    syncSelection();
  };

  // Toolbar ------------------------------------------------------------------------------------

  const { start, end } = selection;
  const hasSelection = start < end;
  const existingLink = linkAt(marks, start, end);
  const linkLimit = linkMarksOf(marks).length >= LIMITS.textLinks && !existingLink;
  const enabled = [
    hasSelection,
    hasSelection,
    (hasSelection || existingLink !== undefined) && !linkLimit,
  ];
  const tabStop = enabled[roving] ? roving : enabled.findIndex(Boolean);

  const toggle = (type: FormatType) => {
    const range = readSelection();
    if (!(range.start < range.end)) return;
    commitMarks(toggleFormat(marks, type, range.start, range.end), range);
  };

  const openPanel = (next: PanelTarget, url: string) => {
    setPanel({ ...next, text: block.text });
    setAddress(url);
    setAddressError(null);
    setNotice(null);
    setAddressTick((tick) => tick + 1);
  };

  const openLink = () => {
    const range = readSelection();
    const inside = linkAt(marks, range.start, range.end);
    if (inside) {
      openPanel({ mode: "edit", id: inside.id, start: inside.start, end: inside.end }, inside.url);
      return;
    }
    if (!(range.start < range.end)) return;
    if (linksOverlapping(marks, range.start, range.end).length > 0) {
      setNotice(MARK_MESSAGES.overlap);
      return;
    }
    if (linkMarksOf(marks).length >= LIMITS.textLinks) return;
    openPanel({ mode: "add", start: range.start, end: range.end }, "");
  };

  const onToolbarKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const live = buttonRefs.current.filter(
      (button): button is HTMLButtonElement => button !== null && !button.disabled,
    );
    if (live.length === 0) return;
    const at = live.indexOf(document.activeElement as HTMLButtonElement);
    let to = at;
    if (event.key === "ArrowRight") to = at < 0 ? 0 : (at + 1) % live.length;
    else if (event.key === "ArrowLeft")
      to = at < 0 ? live.length - 1 : (at - 1 + live.length) % live.length;
    else if (event.key === "Home") to = 0;
    else to = live.length - 1;
    event.preventDefault();
    live[to]!.focus();
  };

  // Link panel ---------------------------------------------------------------------------------

  const closePanel = () => {
    if (!panel) return;
    setPanel(null);
    restoreSelection(panel.start, panel.end);
  };

  const submitPanel = () => {
    if (!panel) return;
    const url = normalizeUrl(address);
    if (!isHttpUrl(url)) {
      setAddressError(URL_ERROR_MESSAGE);
      setAddressTick((tick) => tick + 1);
      return;
    }
    const next =
      panel.mode === "add"
        ? addLinkMark(marks, panel.start, panel.end, newBlockId(), url)
        : setLinkUrl(marks, panel.id, url);
    if (commitMarks(next, { start: panel.start, end: panel.end })) setPanel(null);
  };

  const removeFromPanel = () => {
    if (!panel || panel.mode !== "edit") return;
    if (commitMarks(removeLinkMark(marks, panel.id), { start: panel.start, end: panel.end })) {
      setPanel(null);
    }
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
      event.preventDefault();
      submitPanel();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  };

  const textError = fieldError(errors, block.id, "text");
  const marksError = fieldError(errors, block.id, "marks");
  const shownError = textError ?? marksError;
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Text"
        error={shownError}
        suffix={
          <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
            {codePointLength(block.text)} / {LIMITS.text}
          </span>
        }
      >
        {(control) => (
          <>
            <div
              role="toolbar"
              aria-label="Text formatting"
              onKeyDown={onToolbarKey}
              className="flex flex-wrap gap-2"
            >
              <button
                ref={(el) => {
                  buttonRefs.current[0] = el;
                }}
                type="button"
                className={TOOLBAR_BUTTON}
                aria-pressed={isFormatted(marks, "bold", start, end)}
                disabled={!enabled[0]}
                tabIndex={tabStop === 0 ? 0 : -1}
                onFocus={() => setRoving(0)}
                onMouseDown={keepFocus}
                onClick={() => toggle("bold")}
              >
                Bold
              </button>
              <button
                ref={(el) => {
                  buttonRefs.current[1] = el;
                }}
                type="button"
                className={TOOLBAR_BUTTON}
                aria-pressed={isFormatted(marks, "italic", start, end)}
                disabled={!enabled[1]}
                tabIndex={tabStop === 1 ? 0 : -1}
                onFocus={() => setRoving(1)}
                onMouseDown={keepFocus}
                onClick={() => toggle("italic")}
              >
                Italic
              </button>
              <button
                ref={(el) => {
                  buttonRefs.current[2] = el;
                }}
                type="button"
                className={FORM_BUTTON}
                aria-describedby={linkLimit ? limitId : undefined}
                disabled={!enabled[2]}
                tabIndex={tabStop === 2 ? 0 : -1}
                onFocus={() => setRoving(2)}
                onMouseDown={keepFocus}
                onClick={openLink}
              >
                Link
              </button>
            </div>
            <p id={hintId} className="text-xs text-text-2">
              Select some text, then tap Bold, Italic or Link.
            </p>
            {linkLimit ? (
              <p id={limitId} className="text-[13px] text-text-2">
                {MARK_MESSAGES.editorTooManyLinks}
              </p>
            ) : null}
            {notice ? (
              <p role="status" data-field="marks-notice" className="text-[13px] text-bad">
                {notice}
              </p>
            ) : null}
            {panel ? (
              // An inline panel, not a modal: it opens under the toolbar inside the block.

              <div
                ref={addressRef}
                role="group"
                aria-label={panel.mode === "add" ? "Add link" : "Update link"}
                onKeyDown={onPanelKey}
                className="flex flex-col gap-3 rounded-md border border-line-3 bg-surface p-3"
              >
                <UrlField
                  label="Link address"
                  field="link-address"
                  value={address}
                  error={addressError}
                  onChange={(value) => {
                    setAddress(value);
                    setAddressError(null);
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY_BUTTON} onClick={submitPanel}>
                    {panel.mode === "add" ? "Add link" : "Update link"}
                  </button>
                  {panel.mode === "edit" ? (
                    <button type="button" className={FORM_BUTTON_DANGER} onClick={removeFromPanel}>
                      Remove link
                    </button>
                  ) : null}
                  <button type="button" className={FORM_BUTTON} onClick={closePanel}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <textarea
              {...control}
              ref={textareaRef}
              value={block.text}
              rows={4}
              data-field="text"
              onChange={handleText}
              onSelect={syncSelection}
              onKeyUp={syncSelection}
              onMouseUp={syncSelection}
              onTouchEnd={syncSelection}
              onFocus={() => {
                // Going back into the text puts an open panel away: the selection may have changed.
                if (panelState) setPanel(null);
                syncSelection();
              }}
              className={`${controlClass(shownError !== null, "py-2.5 leading-normal")} resize-y`}
            />
          </>
        )}
      </Field>

      {links.length > 0 ? (
        <section aria-label="Links in this text" className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink-2">Links in this text</h3>
          <ul className="flex flex-col gap-2">
            {links.map((link) => {
              const text = linkedText(block.text, link);
              const named = text === "" ? "link" : text;
              const message =
                errors.find((error) => error.blockId === block.id && error.itemId === link.id)
                  ?.message ?? null;
              const errorId = `${hintId}-${link.id}-error`;
              return (
                // `aria-invalid` is how the editor finds the first thing to focus after a failed Publish
                // (block-row.tsx); the row takes focus, and the message is tied to it by describedby.
                // eslint-disable-next-line jsx-a11y/role-supports-aria-props
                <li
                  key={link.id}
                  data-item-id={link.id}
                  tabIndex={-1}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? errorId : undefined}
                  className={`flex flex-col gap-2 rounded-md border bg-surface p-2.5 ${
                    message ? "border-bad" : "border-line-3"
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-ink">{named}</span>
                    <span className="truncate font-mono text-xs text-text-2">{link.url}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={FORM_BUTTON}
                      aria-label={`Edit link: ${named}`}
                      onClick={() =>
                        openPanel(
                          { mode: "edit", id: link.id, start: link.start, end: link.end },
                          link.url,
                        )
                      }
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={FORM_BUTTON_DANGER}
                      aria-label={`Remove link: ${named}`}
                      onClick={() =>
                        commitMarks(removeLinkMark(marks, link.id), {
                          start: link.start,
                          end: link.end,
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div aria-live="polite" className="empty:hidden">
                    {message ? (
                      <p id={errorId} className="text-[13px] text-bad">
                        {message}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
