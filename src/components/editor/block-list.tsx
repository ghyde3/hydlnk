"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMemo, useState, type Dispatch } from "react";
import type { Block, PublishError } from "@/lib/document";
import { blockRowSummary } from "@/lib/editor/contracts";
import { EMPTY_BLOCKS_MESSAGE } from "@/lib/editor/messages";
import type { EditorAction, FocusRequest } from "@/lib/editor/state";
import { BlockRow } from "./block-row";
import { GripIcon } from "./icons";

const NO_ERRORS: PublishError[] = [];

/** The list only moves up and down. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function nameOf(block: Block | undefined): string {
  if (!block) return "Block";
  const { title, typeLabel } = blockRowSummary(block);
  return title || typeLabel;
}

/**
 * The heading, the empty state and the ordered, sortable list of blocks (M2-11, M2-14). Reordering
 * works by dragging the handle (pointer and touch) or with the keyboard (Space to lift, arrows,
 * Space to drop, Escape to cancel); the edit panel's Move up and Move down do the same without a
 * drag. dnd-kit's live region announces the pickup, the move and the drop in terms of the block's
 * title and position.
 */
export function BlockList({
  blocks,
  expandedId,
  errors,
  focus,
  announcement,
  announceSeq,
  dispatch,
}: {
  blocks: Block[];
  expandedId: string | null;
  errors: PublishError[];
  focus: FocusRequest | null;
  announcement: string;
  announceSeq: number;
  dispatch: Dispatch<EditorAction>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const ids = useMemo(() => blocks.map((block) => block.id), [blocks]);
  const errorsByBlock = useMemo(() => {
    const map = new Map<string, PublishError[]>();
    for (const error of errors) {
      if (error.blockId === null) continue;
      const list = map.get(error.blockId);
      if (list) list.push(error);
      else map.set(error.blockId, [error]);
    }
    return map;
  }, [errors]);

  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const blockById = (id: UniqueIdentifier) => blocks.find((block) => block.id === id);
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${nameOf(blockById(active.id))}. Position ${position(active.id)} of ${ids.length}.`,
    // dnd-kit reports "over" right at pickup (the block over itself): that is not a move, and
    // announcing it would replace the pickup message.
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? `${nameOf(blockById(active.id))} moved to position ${position(over.id)} of ${ids.length}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(blockById(active.id))} dropped at position ${position(over.id)} of ${ids.length}.`
        : `${nameOf(blockById(active.id))} dropped.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${nameOf(blockById(active.id))} is back at position ${position(active.id)} of ${ids.length}.`,
  };

  function onDragStart(event: DragStartEvent): void {
    setActiveId(event.active.id);
  }
  function onDragEnd(event: DragEndEvent): void {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      dispatch({ type: "block/reorder", activeId: String(active.id), overId: String(over.id) });
    }
  }

  const active = activeId === null ? undefined : blockById(activeId);
  const activeSummary = active ? blockRowSummary(active) : null;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-0.5 pt-1">
        <h2 className="font-mono text-[13px] font-semibold tracking-[0.06em] text-text-2 uppercase">
          Blocks · {blocks.length}
        </h2>
        <span className="text-xs text-text-2">Tap a block to edit it</span>
      </div>

      {blocks.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-3 bg-surface px-4 py-5 text-center text-sm text-text-2">
          {EMPTY_BLOCKS_MESSAGE}
        </p>
      ) : (
        <DndContext
          id="editor-blocks"
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[verticalOnly]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To pick up a block, press Space. Use the arrow keys to move it, Space to drop it, Escape to cancel.",
            },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
              {blocks.map((block, index) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  index={index}
                  total={blocks.length}
                  expanded={expandedId === block.id}
                  errors={errorsByBlock.get(block.id) ?? NO_ERRORS}
                  focus={focus && "blockId" in focus && focus.blockId === block.id ? focus : null}
                  dispatch={dispatch}
                />
              ))}
            </ol>
          </SortableContext>
          <DragOverlay>
            {activeSummary ? (
              <div
                data-testid="drag-overlay"
                className="flex min-h-[58px] items-center gap-0.5 rounded-md border border-ink bg-surface pr-4 ring-1 ring-ink"
              >
                <span className="flex size-11 shrink-0 items-center justify-center text-[#9a958d]">
                  <GripIcon />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 px-1">
                  <span className="font-mono text-[11px] tracking-[0.06em] text-text-3 uppercase">
                    {activeSummary.typeLabel}
                  </span>
                  <span className="truncate text-sm font-semibold">{activeSummary.title}</span>
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        <span key={announceSeq}>{announcement}</span>
      </div>
    </>
  );
}
