"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useIsDesktop } from "@/components/editor/use-is-desktop";
import {
  LIMITS,
  MARK_MESSAGES,
  URL_ERROR_MESSAGE,
  codePointLength,
  isHttpUrl,
  linkAt,
  linkMarksOf,
  linksOverlapping,
  newBlockId,
  normalizeUrl,
  sortMarks,
  type Block,
  type LinkMark,
  type Mark,
  type PublishError,
  type TextBlock,
} from "@/lib/document";
import { FORM_BUTTON, FORM_BUTTON_DANGER } from "../../field";
import { UrlField } from "../../url-field";
import { fieldError } from "../types";
import { marksToTiptapDoc, pmPositionOf, tiptapDocToTextAndMarks } from "./convert";
import { LINK_REQUEST_EVENT, buildExtensions } from "./extensions";
import { EMPTY_MODEL, contentKey, linkedText, readModel, withMarks } from "./model";
import { FormatToolbar, SelectionBubble } from "./toolbar";

/**
 * The text block's editor (M9-12): one Tiptap editor, loaded when a text block is first expanded.
 *
 * It replaces the textarea, the Bold / Italic / Link buttons and `adjustMarks` of M6-30. The page
 * document stays what M9-11 defined (the plain `text` and structured `marks`): two pure functions
 * (`marksToTiptapDoc`, `tiptapDocToTextAndMarks`) convert at the edge, so the draft never holds HTML
 * or the editor's own JSON.
 *
 *   - Every editor update writes `{ text, marks }` to the draft. While the editor has the focus those
 *     writes are one editing session: the workspace history gets no step per keystroke, and when the
 *     focus leaves (or the block closes) the whole session becomes ONE step, back to the block as it
 *     was when the session began. The editor keeps its own undo and redo while it has the focus
 *     (`data-native-undo`), and the buttons "Undo text change" and "Redo text change" drive it.
 *   - Opening a block writes nothing: the draft is byte-identical after opening and closing it.
 *   - A change made outside the editor (the workspace's Undo or Redo) is shown by starting the
 *     editor over from the block, so the editor's own history never holds a step of the old content.
 *   - Links keep the inline panel of M6-30 (not a modal). A link is clicked and counted by its own id.
 */

export interface TextEditorProps {
  block: TextBlock;
  errors: PublishError[];
  onChange: (next: Block) => void;
  /** A live edit in an editing session; `session` names the session (one per time the editor has focus). */
  onSessionChange?: ((next: Block, session: string) => void) | undefined;
  /** The session is over: the focus left the editor, or the editor went away. */
  onSessionEnd?: (() => void) | undefined;
  /** Put the caret at the end when the editor appears (the block was just added). */
  autoFocus?: boolean | undefined;
}

type PanelTarget =
  | { mode: "add"; start: number; end: number }
  | { mode: "edit"; id: string; start: number; end: number };

const PRIMARY_BUTTON =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";

const EDITOR_CLASS =
  "tt-editor min-h-[112px] w-full min-w-0 rounded-md border bg-surface px-3 py-2.5 text-base leading-normal font-normal text-ink [overflow-wrap:anywhere] [&_p]:m-0 [&_p[data-align=left]]:text-left [&_p[data-align=center]]:text-center [&_p[data-align=right]]:text-right [&_.tt-link]:text-brass-text [&_.tt-link]:underline";

/** The attributes of the editor's textbox. */
function attributesOf(labelId: string, describedBy: string, invalid: boolean) {
  return {
    role: "textbox",
    "aria-multiline": "true",
    "aria-labelledby": labelId,
    "aria-describedby": describedBy,
    ...(invalid ? { "aria-invalid": "true" } : {}),
    "data-field": "text",
    "data-native-undo": "",
    class: `${EDITOR_CLASS} ${invalid ? "border-bad" : "border-line-3"}`,
  };
}

/** The editor, starting over whenever the block changes from outside (workspace Undo or Redo). */
export default function TextEditor(props: TextEditorProps) {
  const key = contentKey(props.block.text, props.block.marks as Mark[] | undefined);
  const [emitted, setEmitted] = useState(key);
  const [generation, setGeneration] = useState(0);
  if (key !== emitted) {
    // The block is not what the editor last wrote: something else changed it.
    setEmitted(key);
    setGeneration((value) => value + 1);
  }
  return (
    <EditorField
      key={generation}
      {...props}
      autoFocus={props.autoFocus === true && generation === 0}
      onEmit={setEmitted}
    />
  );
}

function EditorField({
  block,
  errors,
  onChange,
  onSessionChange,
  onSessionEnd,
  autoFocus,
  onEmit,
}: TextEditorProps & { onEmit: (key: string) => void }) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const hintId = `${ids}-hint`;
  const limitId = `${ids}-limit`;
  const errorId = `${ids}-error`;
  const linkLimitId = `${ids}-links`;
  const isDesktop = useIsDesktop();

  const latest = useRef({ block, onChange, onSessionChange, onSessionEnd });
  useEffect(() => {
    latest.current = { block, onChange, onSessionChange, onSessionEnd };
  });
  const session = useRef<string | null>(null);
  const endSession = useCallback(() => {
    if (session.current === null) return;
    session.current = null;
    latest.current.onSessionEnd?.();
  }, []);

  const [notice, setNotice] = useState<string | null>(null);
  const [panelState, setPanel] = useState<PanelTarget | null>(null);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressTick, setAddressTick] = useState(0);
  const addressRef = useRef<HTMLDivElement>(null);

  const textError = fieldError(errors, block.id, "text");
  const marksError = fieldError(errors, block.id, "marks");
  const shownError = textError ?? marksError;

  const hooks = useMemo(() => ({ refuse: (message: string) => setNotice(message) }), []);
  const extensions = useMemo(() => buildExtensions(hooks), [hooks]);
  const [initialContent] = useState(() => marksToTiptapDoc(block.text, block.marks));

  // The description and the invalid state follow the counter, the hint and the error. The editor
  // compares its options by reference on every render and redraws its view from its own state when
  // one differs, which would put the caret back where ProseMirror last saw it: so the props are one
  // object that changes only when an attribute does.
  const describedBy = [hintId, limitId, shownError ? errorId : null].filter(Boolean).join(" ");
  const invalid = shownError !== null;
  const editorProps = useMemo(
    () => ({ attributes: attributesOf(labelId, describedBy, invalid) }),
    [labelId, describedBy, invalid],
  );

  const editor = useEditor({
    // The editor only ever mounts in the browser (the module is imported on demand).
    immediatelyRender: true,
    extensions,
    content: initialContent,
    editorProps,
    onUpdate: ({ editor: current }) => {
      const { text, marks } = tiptapDocToTextAndMarks(current.getJSON());
      const { block: base, onChange: change, onSessionChange: live } = latest.current;
      const next = withMarks({ ...base, text }, marks);
      onEmit(contentKey(text, marks));
      setNotice(null);
      if (!live) {
        change(next);
        return;
      }
      session.current ??= newBlockId();
      live(next, session.current);
      // An edit made while the editor does not have the focus (the link panel) is a step of its own.
      if (!current.isFocused) endSession();
    },
    onFocus: () => setPanel(null),
    onBlur: () => endSession(),
  });

  // The session ends when the editor goes away (the block closes) as well as when it loses focus.
  useEffect(() => endSession, [endSession]);

  // The focus was asked for before the editor arrived (a block just added, or a failed Publish):
  // a link with a Publish error takes it on its row, anything else on the end of the text.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoFocus || !editor) return;
    const failed = errors.find((error) => error.blockId === block.id && error.itemId !== undefined);
    const row = failed
      ? rootRef.current?.querySelector<HTMLElement>(
          `[data-item-id="${globalThis.CSS.escape(failed.itemId!)}"]`,
        )
      : null;
    if (row) row.focus({ preventScroll: false });
    else editor.commands.focus("end");
    // Only on the first render of this editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const model =
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? readModel(current) : EMPTY_MODEL),
    }) ?? EMPTY_MODEL;

  const links = sortMarks(linkMarksOf(model.marks));
  const inLink = linkAt(model.marks, model.start, model.end);
  const linkLimit = links.length >= LIMITS.textLinks && inLink === undefined;
  const linkDisabled = !(model.start < model.end || inLink !== undefined) || linkLimit;

  // A panel belongs to the text it was opened on: when its link is gone, it closes.
  const panel =
    panelState && panelState.mode === "edit" && !links.some((link) => link.id === panelState.id)
      ? null
      : panelState;

  // Opening the panel moves the focus to its address field.
  useEffect(() => {
    if (addressTick === 0) return;
    addressRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [addressTick]);

  /** The editor's selection restored to `[start, end)` (code points), focused. */
  const select = (start: number, end: number) => {
    if (!editor) return;
    const { text } = readModel(editor);
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pmPositionOf(text, start), to: pmPositionOf(text, end) })
      .run();
  };

  const openPanel = (target: PanelTarget, url: string) => {
    setPanel(target);
    setAddress(url);
    setAddressError(null);
    setNotice(null);
    setAddressTick((tick) => tick + 1);
  };

  const openLink = () => {
    if (!editor) return;
    const current = readModel(editor);
    const currentLinks = linkMarksOf(current.marks);
    const inside = linkAt(current.marks, current.start, current.end);
    if (inside) {
      openPanel({ mode: "edit", id: inside.id, start: inside.start, end: inside.end }, inside.url);
      return;
    }
    if (!(current.start < current.end)) return;
    if (linksOverlapping(current.marks, current.start, current.end).length > 0) {
      setNotice(MARK_MESSAGES.overlap);
      return;
    }
    if (currentLinks.length >= LIMITS.textLinks) return;
    openPanel({ mode: "add", start: current.start, end: current.end }, "");
  };
  // Ctrl or Cmd+K (a shortcut of the editor's) asks for the panel through an event on the editor.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    dom.addEventListener(LINK_REQUEST_EVENT, openLink);
    return () => dom.removeEventListener(LINK_REQUEST_EVENT, openLink);
  });

  const closePanel = () => {
    if (!panel) return;
    setPanel(null);
    select(panel.start, panel.end);
  };

  const submitPanel = () => {
    if (!panel || !editor) return;
    const url = normalizeUrl(address);
    if (!isHttpUrl(url)) {
      setAddressError(URL_ERROR_MESSAGE);
      setAddressTick((tick) => tick + 1);
      return;
    }
    const { text } = readModel(editor);
    editor
      .chain()
      .focus()
      .setTextSelection({
        from: pmPositionOf(text, panel.start),
        to: pmPositionOf(text, panel.end),
      })
      .setMark("link", { href: url, id: panel.mode === "edit" ? panel.id : newBlockId() })
      .run();
    setPanel(null);
  };

  const unlink = (link: { start: number; end: number }) => {
    if (!editor) return;
    const { text } = readModel(editor);
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pmPositionOf(text, link.start), to: pmPositionOf(text, link.end) })
      .unsetMark("link")
      .run();
    setPanel(null);
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

  const count = codePointLength(model.text);

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span
            id={labelId}
            onClick={() => editor?.commands.focus()}
            className="text-[13px] font-semibold text-ink-2"
          >
            Text
          </span>
          <span id={limitId} className="font-mono text-[11px] text-text-2">
            {count} / {LIMITS.text}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          {editor ? (
            <FormatToolbar
              editor={editor}
              model={model}
              linkDisabled={linkDisabled}
              linkDescribedBy={linkLimit ? linkLimitId : undefined}
              onLink={openLink}
            />
          ) : null}
          <p id={hintId} className="text-xs text-text-2">
            {isDesktop
              ? "Select text to format it. Ctrl or Cmd+K adds a link."
              : "Select some text, then use the toolbar."}
          </p>
          {linkLimit ? (
            <p id={linkLimitId} className="text-[13px] text-text-2">
              {MARK_MESSAGES.editorTooManyLinks}
            </p>
          ) : null}
          <div aria-live="polite" className="empty:hidden">
            {notice ? (
              <p role="status" data-field="marks-notice" className="text-[13px] text-bad">
                {notice}
              </p>
            ) : null}
          </div>
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
                  <button
                    type="button"
                    className={FORM_BUTTON_DANGER}
                    onClick={() => unlink(panel)}
                  >
                    Remove link
                  </button>
                ) : null}
                <button type="button" className={FORM_BUTTON} onClick={closePanel}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <EditorContent editor={editor} />
          {editor && isDesktop ? (
            <SelectionBubble
              editor={editor}
              model={model}
              linkDisabled={linkDisabled}
              linkDescribedBy={linkLimit ? linkLimitId : undefined}
              onLink={openLink}
              hidden={panel !== null}
            />
          ) : null}
        </div>
        <div aria-live="polite" className="empty:hidden">
          {shownError ? (
            <p id={errorId} className="text-[13px] text-bad">
              {shownError}
            </p>
          ) : null}
        </div>
      </div>

      {links.length > 0 ? (
        <section aria-label="Links in this text" className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-ink-2">Links in this text</h3>
          <ul className="flex flex-col gap-2">
            {links.map((link: LinkMark) => {
              const text = linkedText(model.text, link);
              const named = text === "" ? "link" : text;
              const message =
                errors.find((error) => error.blockId === block.id && error.itemId === link.id)
                  ?.message ?? null;
              const rowErrorId = `${ids}-${link.id}-error`;
              return (
                // `aria-invalid` is how the editor finds the first thing to focus after a failed Publish
                // (block-row.tsx); the row takes focus, and the message is tied to it by describedby.
                // eslint-disable-next-line jsx-a11y/role-supports-aria-props
                <li
                  key={link.id}
                  data-item-id={link.id}
                  tabIndex={-1}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? rowErrorId : undefined}
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
                      onClick={() => unlink(link)}
                    >
                      Remove
                    </button>
                  </div>
                  <div aria-live="polite" className="empty:hidden">
                    {message ? (
                      <p id={rowErrorId} className="text-[13px] text-bad">
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

export type { Editor };
