"use client";

import {
  Bold,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { EDITOR_ICON_STROKE, Icon } from "@/components/app/icon";

/**
 * The body editor's toolbar (M16-13), in the look of the text block's `FormatToolbar`: 44 by 44
 * buttons, `role="toolbar"`, the arrow keys move between them, and a press never takes the focus out
 * of the editor (a phone's keyboard stays open). Unlike the text block's, it does not wrap: at 390px
 * it scrolls sideways inside its own row, so the page itself never scrolls sideways.
 */

const BUTTON =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface";

/** What the toolbar reads from the editor on every change (see `useEditorState` in body-editor). */
export interface BodyModel {
  heading: 0 | 2 | 3 | 4;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const EMPTY_MODEL: BodyModel = {
  heading: 0,
  bold: false,
  italic: false,
  strike: false,
  link: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
  canUndo: false,
  canRedo: false,
};

export function readModel(editor: Editor): BodyModel {
  const level = [2, 3, 4].find((n) => editor.isActive("heading", { level: n })) ?? 0;
  return {
    heading: level as BodyModel["heading"],
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    strike: editor.isActive("strike"),
    link: editor.isActive("link"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    blockquote: editor.isActive("blockquote"),
    codeBlock: editor.isActive("codeBlock"),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

interface Item {
  id: string;
  label: string;
  icon: LucideIcon;
  pressed?: (model: BodyModel) => boolean;
  disabled?: (model: BodyModel) => boolean;
  run?: (editor: Editor) => void;
}

const heading = (level: 2 | 3 | 4, icon: LucideIcon): Item => ({
  id: `h${level}`,
  label: `Heading ${level}`,
  icon,
  pressed: (m) => m.heading === level,
  run: (e) => void e.chain().focus().toggleHeading({ level }).run(),
});

const ITEMS: Item[] = [
  heading(2, Heading2),
  heading(3, Heading3),
  heading(4, Heading4),
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
  // Link and Image open a panel; the component wires them.
  { id: "link", label: "Link", icon: LinkIcon, pressed: (m) => m.link },
  {
    id: "bullets",
    label: "Bullet list",
    icon: List,
    pressed: (m) => m.bulletList,
    run: (e) => void e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbers",
    label: "Numbered list",
    icon: ListOrdered,
    pressed: (m) => m.orderedList,
    run: (e) => void e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    icon: TextQuote,
    pressed: (m) => m.blockquote,
    run: (e) => void e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    icon: SquareCode,
    pressed: (m) => m.codeBlock,
    run: (e) => void e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "rule",
    label: "Divider",
    icon: Minus,
    run: (e) => void e.chain().focus().setHorizontalRule().run(),
  },
  { id: "image", label: "Image", icon: ImageIcon },
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

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

export function BodyToolbar({
  editor,
  model,
  disabled,
  panel,
  onLink,
  onImage,
}: {
  editor: Editor | null;
  model: BodyModel;
  disabled: boolean;
  /** Which panel is open, so its button reads as expanded. */
  panel: "link" | "image" | null;
  onLink: () => void;
  onImage: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const live = [...(row.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter(
      (button) => !button.disabled,
    );
    if (live.length === 0) return;
    const at = live.indexOf(document.activeElement as HTMLButtonElement);
    let to = 0;
    if (event.key === "ArrowRight") to = at < 0 ? 0 : (at + 1) % live.length;
    else if (event.key === "ArrowLeft") to = at <= 0 ? live.length - 1 : at - 1;
    else if (event.key === "End") to = live.length - 1;
    event.preventDefault();
    live[to]!.focus();
    live[to]!.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div
      ref={row}
      role="toolbar"
      aria-label="Body formatting"
      data-body-toolbar=""
      onKeyDown={onKey}
      className="flex max-w-full min-w-0 gap-1 overflow-x-auto rounded-md bg-page p-1.5 [scrollbar-width:thin]"
    >
      {ITEMS.map((item, index) => {
        const opens = item.id === "link" || item.id === "image";
        const off = disabled || editor === null || (item.disabled?.(model) ?? false);
        return (
          <button
            key={item.id}
            type="button"
            data-tool={item.id}
            aria-label={item.label}
            aria-pressed={item.pressed ? item.pressed(model) : undefined}
            aria-expanded={opens ? panel === item.id : undefined}
            disabled={off}
            tabIndex={index === 0 ? 0 : -1}
            onMouseDown={keepFocus}
            onClick={() => {
              if (item.id === "link") onLink();
              else if (item.id === "image") onImage();
              else if (editor) item.run?.(editor);
            }}
            className={BUTTON}
          >
            <Icon icon={item.icon} size={18} strokeWidth={EDITOR_ICON_STROKE} />
          </button>
        );
      })}
    </div>
  );
}
