"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useEffect, useLayoutEffect, useRef, type Dispatch } from "react";
import type { Block, PublishError } from "@/lib/document";
import { BLOCK_FORMS, blockRowSummary } from "@/lib/editor/contracts";
import type { EditorAction, FocusRequest } from "@/lib/editor/state";
import { OverrideChip } from "@/components/themes";
import { GripIcon } from "./icons";

/** A text control to start typing in: the file input of an image control is hidden, so it is skipped. */
const FIRST_FIELD = "input:not([type=file]):not([type=hidden]), textarea, select";

interface BlockRowProps {
  block: Block;
  /** Position in the page (0-based) and the number of blocks, for Move up / Move down. */
  index: number;
  total: number;
  expanded: boolean;
  /** Publish errors for this block only. */
  errors: PublishError[];
  /** A pending focus request, only when it is for this block. */
  focus: FocusRequest | null;
  dispatch: Dispatch<EditorAction>;
}

/**
 * One row of the block list (M2-11, M2-12, M2-13, M2-14): drag handle, type, title and sub line,
 * visibility toggle, and an edit panel with the block's form (the renderer area's BLOCK_FORMS) and
 * Move up, Move down and Delete block. Only the handle is a drag activator (and the only element
 * with `touch-action: none`), so a swipe that starts on the row scrolls the page.
 */
export const BlockRow = memo(function BlockRow({
  block,
  index,
  total,
  expanded,
  errors,
  focus,
  dispatch,
}: BlockRowProps) {
  const sortable = useSortable({ id: block.id });
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition } =
    sortable;
  const rowRef = useRef<HTMLLIElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const moveUpRef = useRef<HTMLButtonElement>(null);
  const moveDownRef = useRef<HTMLButtonElement>(null);
  const pendingMove = useRef<"up" | "down" | null>(null);

  const summary = blockRowSummary(block);
  const hidden = block.visible === false;
  const invalid = errors.length > 0;
  const Form = BLOCK_FORMS[block.type];
  const panelDomId = `block-panel-${block.id}`;

  // Focus requests: a new block's first input (a divider: the row), a failed publish's first
  // invalid input, the neighbor of a deleted row. Each also scrolls the target into view.
  const nonce = focus?.nonce ?? null;
  useEffect(() => {
    if (!focus || nonce === null) return;
    const panel = panelRef.current;
    const row = rowRef.current;
    if (focus.kind === "first-input" || focus.kind === "invalid-input") {
      // The first invalid control in the panel: an input marked invalid, or the Upload button when
      // the image is what is missing (that error has no input of its own). Whichever comes first.
      const invalidControls =
        focus.kind === "invalid-input" && panel
          ? [
              panel.querySelector<HTMLElement>('[aria-invalid="true"]'),
              panel
                .querySelector<HTMLElement>('p[data-field="image"]')
                ?.parentElement?.parentElement?.querySelector<HTMLElement>(
                  "button:not(:disabled)",
                ) ?? null,
            ]
              .filter((el): el is HTMLElement => el !== null)
              .sort((a, b) =>
                a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
              )
          : [];
      const target = invalidControls[0] ?? panel?.querySelector<HTMLElement>(FIRST_FIELD);
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.focus({ preventScroll: true });
      } else {
        row?.scrollIntoView({ block: "nearest" });
      }
    } else if (focus.kind === "row") {
      row?.scrollIntoView({ block: "nearest" });
      row?.focus({ preventScroll: true });
    } else if (focus.kind === "row-button") {
      mainRef.current?.focus({ preventScroll: false });
    }
    dispatch({ type: "focus/handled", nonce });
    // `focus` is read through `nonce`: a new request always has a new nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, dispatch]);

  // Moving a row re-orders its DOM node, which drops focus: put it back on the same button (or on
  // its twin when the move reached an end and the button became disabled).
  useLayoutEffect(() => {
    const wanted = pendingMove.current;
    if (!wanted) return;
    pendingMove.current = null;
    const primary = wanted === "up" ? moveUpRef.current : moveDownRef.current;
    const other = wanted === "up" ? moveDownRef.current : moveUpRef.current;
    const target = primary && !primary.disabled ? primary : other;
    target?.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const border = invalid
    ? "border-bad bg-bad-line"
    : expanded
      ? "border-ink bg-surface"
      : "border-line bg-surface";

  return (
    <li
      ref={(element) => {
        rowRef.current = element;
        setNodeRef(element);
      }}
      tabIndex={-1}
      data-block-id={block.id}
      data-block-type={block.type}
      data-invalid={invalid ? "" : undefined}
      data-hidden={hidden ? "true" : undefined}
      className={`overflow-hidden rounded-md border ${border} ${sortable.isDragging ? "opacity-40" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="flex items-center gap-0.5 pr-1">
        {/*
          The dimmed part of a hidden row (M2-12: 55% opacity): the handle and the text. The Hidden
          chip and the toggle stay at full strength, so the control that brings the block back is
          not faded. A hidden row's text is drawn in black: at 55% it composites to #737373, which
          is the darkest a dimmed row can be and still reads at 4.5:1 on white.
        */}
        <div
          data-dim={hidden ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-0.5"
          style={{ opacity: hidden ? 0.55 : 1 }}
        >
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
            className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center text-[#9a958d]"
          >
            <GripIcon />
          </button>
          <button
            ref={mainRef}
            type="button"
            aria-expanded={expanded}
            aria-controls={expanded ? panelDomId : undefined}
            onClick={() => dispatch({ type: "block/toggle-expanded", id: block.id })}
            className={`flex min-h-[58px] min-w-0 flex-1 flex-col items-start justify-center gap-0.5 px-1 py-1.5 text-left ${
              hidden ? "text-[#000]" : "text-ink"
            }`}
          >
            <span
              className={`font-mono text-[11px] tracking-[0.06em] uppercase ${
                hidden ? "text-[#000]" : "text-text-3"
              }`}
            >
              {summary.typeLabel}
            </span>
            <span className="max-w-full truncate text-sm font-semibold">{summary.title}</span>
            {summary.sub ? (
              <span
                className={`max-w-full truncate font-mono text-xs ${
                  hidden ? "text-[#000]" : "text-text-2"
                }`}
              >
                {summary.sub}
              </span>
            ) : null}
          </button>
        </div>
        <OverrideChip block={block} />
        {hidden ? (
          <span className="hidden shrink-0 rounded-sm bg-track px-[7px] py-[3px] font-mono text-[11px] whitespace-nowrap text-text-2 hl:inline-block">
            Hidden
          </span>
        ) : null}
        <button
          type="button"
          aria-pressed={!hidden}
          aria-label="Visible on page"
          onClick={() => dispatch({ type: "block/toggle-visible", id: block.id })}
          className="flex h-12 w-[52px] shrink-0 items-center justify-center"
        >
          <span
            aria-hidden="true"
            className={`relative block h-[18px] w-8 rounded-full ${hidden ? "bg-line-3" : "bg-ink"}`}
          >
            <span
              className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${hidden ? "left-0.5" : "left-4"}`}
            />
          </span>
        </button>
      </div>

      {expanded ? (
        <div
          id={panelDomId}
          ref={panelRef}
          className="flex flex-col gap-3 border-t border-line bg-[#fafaf8] py-3.5 pr-3.5 pl-4 hl:pl-9"
        >
          <Form
            block={block}
            errors={errors}
            onChange={(next) => dispatch({ type: "block/update", block: next })}
            onImage={(image) => dispatch({ type: "block/set-image", id: block.id, image })}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              ref={moveUpRef}
              type="button"
              disabled={index === 0}
              onClick={() => {
                pendingMove.current = "up";
                dispatch({ type: "block/move", id: block.id, delta: -1 });
              }}
              className="min-h-11 flex-1 basis-[84px] rounded-md border border-line-3 bg-surface px-3 text-[13px] font-medium text-ink disabled:opacity-50"
            >
              Move up
            </button>
            <button
              ref={moveDownRef}
              type="button"
              disabled={index === total - 1}
              onClick={() => {
                pendingMove.current = "down";
                dispatch({ type: "block/move", id: block.id, delta: 1 });
              }}
              className="min-h-11 flex-1 basis-[84px] rounded-md border border-line-3 bg-surface px-3 text-[13px] font-medium text-ink disabled:opacity-50"
            >
              Move down
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "block/delete", id: block.id })}
              className="min-h-11 flex-1 basis-[84px] rounded-md border border-bad-line bg-surface px-3 text-[13px] font-medium text-bad"
            >
              Delete block
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
});
