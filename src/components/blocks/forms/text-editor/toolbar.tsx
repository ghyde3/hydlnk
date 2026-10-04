"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link as LinkIcon,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { Icon, EDITOR_ICON_STROKE } from "@/components/app/icon";
import type { EditorModel } from "./model";

/**
 * The text editor's toolbars (M9-12): the fixed one (ten buttons of 44 by 44, `role="toolbar"`, the
 * arrow keys move between them) and, from 760px up, the bubble over a selection (five buttons).
 *
 * Every button keeps the selection and the focus in the editor: the press is prevented from taking
 * focus (`onMouseDown`), so a phone's keyboard stays open and the selection stays put. The two
 * history buttons are named "Undo text change" and "Redo text change", so they never collide with
 * the workspace's "Undo" and "Redo".
 */

const BUTTON =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface";

interface Item {
  id: string;
  label: string;
  icon: LucideIcon;
  /** `aria-pressed` for the toggles; undefined for a plain button. */
  pressed?: (model: EditorModel) => boolean;
  disabled?: (model: EditorModel) => boolean;
  run: (editor: Editor) => void;
}

const ITEMS: Item[] = [
  {
    id: "bold",
    label: "Bold",
    icon: Bold,
    pressed: (m) => m.bold,
    run: (e) => void e.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    icon: Italic,
    pressed: (m) => m.italic,
    run: (e) => void e.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    label: "Strikethrough",
    icon: Strikethrough,
    pressed: (m) => m.strike,
    run: (e) => void e.chain().focus().toggleStrike().run(),
  },
  {
    id: "underline",
    label: "Underline",
    icon: Underline,
    pressed: (m) => m.underline,
    run: (e) => void e.chain().focus().toggleUnderline().run(),
  },
  // The link button is wired by the component: it opens the panel.
  { id: "link", label: "Link", icon: LinkIcon, run: () => undefined },
  {
    id: "left",
    label: "Align left",
    icon: AlignLeft,
    pressed: (m) => m.align === "left",
    run: (e) => void e.chain().focus().toggleTextAlign("left").run(),
  },
  {
    id: "center",
    label: "Align center",
    icon: AlignCenter,
    pressed: (m) => m.align === "center",
    run: (e) => void e.chain().focus().toggleTextAlign("center").run(),
  },
  {
    id: "right",
    label: "Align right",
    icon: AlignRight,
    pressed: (m) => m.align === "right",
    run: (e) => void e.chain().focus().toggleTextAlign("right").run(),
  },
  {
    id: "undo",
    label: "Undo text change",
    icon: Undo2,
    disabled: (m) => !m.canUndo,
    run: (e) => void e.chain().focus().undo().run(),
  },
  {
    id: "redo",
    label: "Redo text change",
    icon: Redo2,
    disabled: (m) => !m.canRedo,
    run: (e) => void e.chain().focus().redo().run(),
  },
];

const BUBBLE_IDS = ["bold", "italic", "strike", "underline", "link"];

const BUBBLE_OPTIONS = {
  strategy: "fixed",
  placement: "top",
  offset: 8,
  flip: true,
  shift: { padding: 8 },
} as const;
/**
 * Where the bubble lives: a host of its own under the body, so no panel clips it. Not the body itself:
 * the bubble hides on blur unless focus went to something inside its parent, and everything is
 * inside the body.
 */
const BUBBLE_HOST = "hl-text-bubble-host";
const bubbleHost = (): HTMLElement => {
  let host = document.getElementById(BUBBLE_HOST);
  if (!host) {
    host = document.createElement("div");
    host.id = BUBBLE_HOST;
    document.body.appendChild(host);
  }
  return host;
};

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function ToolButton({
  item,
  model,
  editor,
  linkDisabled,
  linkDescribedBy,
  onLink,
  tabIndex,
  onFocus,
  buttonRef,
}: {
  item: Item;
  model: EditorModel;
  editor: Editor;
  linkDisabled: boolean;
  linkDescribedBy: string | undefined;
  onLink: () => void;
  tabIndex?: number;
  onFocus?: () => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  const isLink = item.id === "link";
  const disabled = isLink ? linkDisabled : (item.disabled?.(model) ?? false);
  return (
    <button
      ref={buttonRef}
      type="button"
      data-tool={item.id}
      aria-label={item.label}
      aria-pressed={item.pressed ? item.pressed(model) : undefined}
      aria-describedby={isLink ? linkDescribedBy : undefined}
      disabled={disabled}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onMouseDown={keepFocus}
      onClick={() => (isLink ? onLink() : item.run(editor))}
      className={BUTTON}
    >
      <Icon icon={item.icon} size={18} strokeWidth={EDITOR_ICON_STROKE} />
    </button>
  );
}

/**
 * The fixed toolbar. On a phone it is compact (it wraps to a second row) and sticks under the
 * workspace's pinned header, whose measured height is `--hl-toolbar-h`, so it stays in view while a
 * long text scrolls.
 */
export function FormatToolbar({
  editor,
  model,
  linkDisabled,
  linkDescribedBy,
  onLink,
}: {
  editor: Editor;
  model: EditorModel;
  linkDisabled: boolean;
  linkDescribedBy: string | undefined;
  onLink: () => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [roving, setRoving] = useState(0);
  const enabled = ITEMS.map((item) =>
    item.id === "link" ? !linkDisabled : !(item.disabled?.(model) ?? false),
  );
  const tabStop = enabled[roving] ? roving : enabled.findIndex(Boolean);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const live = buttons.current.filter(
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

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={onKey}
      data-text-toolbar=""
      style={{ top: "var(--hl-toolbar-h, 0px)" }}
      className="sticky z-10 -mx-1 flex flex-wrap gap-1 bg-[#fafaf8] px-1 py-1.5"
    >
      {ITEMS.map((item, index) => (
        <ToolButton
          key={item.id}
          item={item}
          model={model}
          editor={editor}
          linkDisabled={linkDisabled}
          linkDescribedBy={linkDescribedBy}
          onLink={onLink}
          tabIndex={tabStop === index ? 0 : -1}
          onFocus={() => setRoving(index)}
          buttonRef={(element) => {
            buttons.current[index] = element;
          }}
        />
      ))}
    </div>
  );
}

/** The bubble over a selection (760px and up): the five inline buttons, appended to the body so no panel clips it. */
export function SelectionBubble({
  editor,
  model,
  linkDisabled,
  linkDescribedBy,
  onLink,
  hidden,
}: {
  editor: Editor;
  model: EditorModel;
  linkDisabled: boolean;
  linkDescribedBy: string | undefined;
  onLink: () => void;
  /** True while the link panel is open: the bubble would be in the way. */
  hidden: boolean;
}) {
  // Stable props: the menu re-reads them whenever they change, and each re-read is a transaction.
  const shouldShow = useCallback(
    ({ editor: current, state }: { editor: Editor; state: { selection: { empty: boolean } } }) =>
      !hidden && current.isFocused && !state.selection.empty,
    [hidden],
  );
  return (
    <BubbleMenu
      editor={editor}
      updateDelay={0}
      appendTo={bubbleHost}
      shouldShow={shouldShow}
      options={BUBBLE_OPTIONS}
    >
      <div
        role="toolbar"
        aria-label="Selection formatting"
        data-text-bubble=""
        className="z-40 flex gap-1 rounded-md border border-ink bg-surface p-1"
      >
        {ITEMS.filter((item) => BUBBLE_IDS.includes(item.id)).map((item) => (
          <ToolButton
            key={item.id}
            item={item}
            model={model}
            editor={editor}
            linkDisabled={linkDisabled}
            linkDescribedBy={linkDescribedBy}
            onLink={onLink}
          />
        ))}
      </div>
    </BubbleMenu>
  );
}
