"use client";

import { useEffect, useRef } from "react";
import { ImageUploadControl } from "@/components/editor/image-upload-control";
import { LIMITS, newListItem, type ItemsBlock, type ListItem } from "@/lib/document";
import { Field, controlClass } from "../field";
import { TextAreaField } from "../text-field";
import { UrlField } from "../url-field";
import { CountedField } from "./counted-field";
import { AddButton, ItemCard, ItemControls, moved } from "./list-forms";
import { OverrideControls } from "./override-controls";
import { fieldError, itemHasError, type BlockFormProps } from "./types";

/** A toggle switch in a 44px row, the look of "Feature this link". */
function SwitchRow({
  label,
  hint,
  on,
  field,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  field: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        aria-pressed={on}
        data-field={field}
        onClick={onToggle}
        className="flex min-h-12 min-w-[52px] max-w-full items-center justify-between gap-3 text-left text-[13px] font-semibold text-ink-2"
      >
        <span className="min-w-0">{label}</span>
        <span
          aria-hidden="true"
          className={`relative block h-[18px] w-8 shrink-0 rounded-full ${on ? "bg-ink" : "bg-line-3"}`}
        >
          <span
            className={`absolute top-0.5 block size-3.5 rounded-full bg-surface ${on ? "left-4" : "left-0.5"}`}
          />
        </span>
      </button>
      <p className="m-0 text-xs text-text-2">{hint}</p>
    </div>
  );
}

/**
 * Item and price list (M12-01): an optional heading, List or Grid, then one card per item (name,
 * price as typed, description, photo, link, a Sold switch, Move up, Move down, Remove) and "Add
 * item" up to 100. An upload that finishes after more typing is applied to the latest block, so
 * nothing typed meanwhile is lost. Publish errors sit under the exact field (items carry
 * `data-item-id`).
 */
export function ItemsForm({ block, onChange, errors }: BlockFormProps) {
  const latest = useRef<BlockFormProps["block"]>(block);
  useEffect(() => {
    latest.current = block;
  }, [block]);
  if (block.type !== "items") return null;
  const list: ItemsBlock = block;
  const setItems = (items: ListItem[]) => onChange({ ...list, items });
  const patch = (id: string, next: Partial<ListItem>) =>
    setItems(list.items.map((item) => (item.id === id ? { ...item, ...next } : item)));
  const setImage = (id: string, image: ListItem["image"] | null) => {
    // Applied to the block as it is by the time the upload ends, not as it was when it began.
    const current = latest.current.type === "items" ? latest.current : list;
    onChange({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== id) return item;
        const { image: dropped, ...rest } = item;
        void dropped;
        return image ? { ...rest, image } : rest;
      }),
    });
  };
  const full = list.items.length >= LIMITS.itemsMax;
  const listError = fieldError(errors, list.id, "items");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <CountedField
          label="Heading (optional)"
          field="heading"
          max={LIMITS.itemsHeading}
          value={list.heading ?? ""}
          error={fieldError(errors, list.id, "heading")}
          onChange={(heading) => {
            const { heading: dropped, ...rest } = list;
            void dropped;
            onChange(heading === "" ? rest : { ...rest, heading });
          }}
          className="flex-1 basis-[220px]"
        />
        <Field label="Layout" className="w-48 flex-none">
          {(control) => (
            <select
              {...control}
              data-field="layout"
              value={list.layout === "grid" ? "grid" : "list"}
              onChange={(event) =>
                onChange({ ...list, layout: event.target.value === "grid" ? "grid" : "list" })
              }
              className={controlClass(false)}
            >
              <option value="list">List</option>
              <option value="grid">Two columns</option>
            </select>
          )}
        </Field>
      </div>
      {listError ? (
        <p data-field="items" role="alert" className="text-[13px] text-bad">
          {listError}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {list.items.map((item, index) => (
          <ItemCard
            key={item.id}
            label={`Item ${index + 1}`}
            itemId={item.id}
            invalid={itemHasError(errors, list.id, item.id)}
          >
            <div className="flex flex-wrap gap-3">
              <CountedField
                label="Name"
                field="name"
                max={LIMITS.itemName}
                value={item.name}
                error={fieldError(errors, list.id, "name", item.id)}
                onChange={(name) => patch(item.id, { name })}
                className="flex-1 basis-[220px]"
              />
              <CountedField
                label="Price"
                field="price"
                max={LIMITS.itemPrice}
                value={item.price}
                hint="Shown exactly as typed, like 12 or Free."
                error={fieldError(errors, list.id, "price", item.id)}
                onChange={(price) => patch(item.id, { price })}
                className="w-40 flex-none"
              />
            </div>
            <TextAreaField
              label="Description"
              field="description"
              max={LIMITS.itemDescription}
              rows={3}
              value={item.description}
              error={fieldError(errors, list.id, "description", item.id)}
              onChange={(description) => patch(item.id, { description })}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-ink-2">Photo</span>
              <ImageUploadControl
                kind="content"
                label="photo"
                value={item.image ?? null}
                onChange={(image) =>
                  setImage(
                    item.id,
                    image ? { path: image.path, width: image.width, height: image.height } : null,
                  )
                }
              />
              <div aria-live="polite" className="empty:hidden">
                {(fieldError(errors, list.id, "image", item.id) ??
                fieldError(errors, list.id, "image.path", item.id)) ? (
                  <p data-field="image" className="text-[13px] text-bad">
                    {fieldError(errors, list.id, "image", item.id) ??
                      fieldError(errors, list.id, "image.path", item.id)}
                  </p>
                ) : null}
              </div>
            </div>
            <UrlField
              label="Link (optional)"
              optional
              value={item.url ?? ""}
              error={fieldError(errors, list.id, "url", item.id)}
              onChange={(url) => {
                const { url: dropped, ...rest } = item;
                void dropped;
                setItems(
                  list.items.map((it) =>
                    it.id === item.id ? (url === "" ? rest : { ...rest, url }) : it,
                  ),
                );
              }}
            />
            <SwitchRow
              label="Sold"
              field="sold"
              on={item.sold}
              hint="Strikes through the price and shows Sold."
              onToggle={() => patch(item.id, { sold: !item.sold })}
            />
            <ItemControls
              index={index}
              count={list.items.length}
              minCount={1}
              onMove={(to) => setItems(moved(list.items, index, to))}
              onRemove={() => setItems(list.items.filter((it) => it.id !== item.id))}
            />
          </ItemCard>
        ))}
      </ol>
      <AddButton disabled={full} onClick={() => setItems([...list.items, newListItem()])}>
        Add item
      </AddButton>
      {full ? (
        <p className="text-xs text-text-2">You can add up to {LIMITS.itemsMax} items.</p>
      ) : null}
      <OverrideControls block={list} onChange={onChange} errors={errors} />
    </div>
  );
}
