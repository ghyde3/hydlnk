"use client";

import { useId } from "react";
import { ImageUploadControl } from "@/components/editor/image-upload-control";
import {
  APP_STORES,
  APP_STORE_LABELS,
  BOOK_STORES,
  BOOK_STORE_LABELS,
  LIMITS,
  STORE_DUPLICATE_MESSAGE,
  STORE_MISSING_MESSAGE,
  appStoresLimitMessage,
  bookStoresLimitMessage,
  newAppLink,
  newBookLink,
  type AppsBlock,
  type BookBlock,
  type PublishError,
} from "@/lib/document";
import { controlClass } from "../field";
import { UrlField } from "../url-field";
import { CountedTextField } from "./counted-text-field";
import { AddButton, ItemCard, ItemControls, moved } from "./list-forms";
import { OverrideControls } from "./override-controls";
import { fieldError, itemHasError, type BlockFormProps } from "./types";

/** The rows both store blocks share: one store, one address, and the move and remove buttons. */
interface StoreRow {
  id: string;
  store: string;
  url: string;
}

function StoreRowCard({
  row,
  index,
  rows,
  stores,
  labels,
  noun,
  blockId,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  row: StoreRow;
  index: number;
  rows: readonly StoreRow[];
  stores: readonly string[];
  labels: Readonly<Record<string, string>>;
  noun: string;
  blockId: string;
  errors: readonly PublishError[];
  onChange: (next: StoreRow) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const selectId = useId();
  const errorId = useId();
  const known = stores.includes(row.store);
  // The later of two rows with the same store is the one that is wrong (Publish names it too).
  const repeated = rows.findIndex((other) => other.store === row.store) !== index;
  const storeError = repeated
    ? STORE_DUPLICATE_MESSAGE
    : fieldError(errors, blockId, "store", row.id);
  const name = known ? labels[row.store] : "Store";
  return (
    <ItemCard
      label={`${noun} ${index + 1}: ${name}`}
      itemId={row.id}
      invalid={itemHasError(errors as PublishError[], blockId, row.id)}
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex w-48 min-w-0 flex-none flex-col gap-1.5">
          <label htmlFor={selectId} className="text-[13px] font-semibold text-ink-2">
            Store
          </label>
          <select
            id={selectId}
            value={known ? row.store : "unknown"}
            data-field="store"
            aria-invalid={storeError ? true : undefined}
            aria-describedby={storeError ? errorId : undefined}
            onChange={(event) => onChange({ ...row, store: event.target.value })}
            className={controlClass(storeError !== null, "pr-8")}
          >
            {known ? null : (
              <option value="unknown" disabled>
                Pick a store
              </option>
            )}
            {stores.map((store) => (
              <option key={store} value={store}>
                {labels[store]}
              </option>
            ))}
          </select>
          <div aria-live="polite" className="empty:hidden">
            {storeError ? (
              <p id={errorId} className="text-[13px] text-bad">
                {storeError}
              </p>
            ) : null}
          </div>
        </div>
        <UrlField
          value={row.url}
          error={fieldError(errors, blockId, "url", row.id)}
          onChange={(url) => onChange({ ...row, url })}
          className="flex-1 basis-[220px]"
        />
      </div>
      <ItemControls
        index={index}
        count={rows.length}
        minCount={0}
        onMove={onMove}
        onRemove={onRemove}
      />
    </ItemCard>
  );
}

/**
 * The store rows of a book or an app block, with "Add store" (disabled at the limit, with the
 * reason beside it) and the Publish gate's message for the list itself ("Add at least one store
 * link."). A row's own messages (its address, the blocked-site error, a repeated store) show under
 * its field.
 */
function StoreRows<L extends StoreRow>({
  blockId,
  links,
  stores,
  labels,
  max,
  limitMessage,
  noun,
  make,
  errors,
  onChange,
}: {
  blockId: string;
  links: readonly L[];
  stores: readonly string[];
  labels: Readonly<Record<string, string>>;
  max: number;
  limitMessage: string;
  noun: string;
  make: (store: never) => L;
  errors: readonly PublishError[];
  onChange: (next: L[]) => void;
}) {
  const listError =
    fieldError(errors, blockId, "links") ?? (links.length === 0 ? STORE_MISSING_MESSAGE : null);
  // "Add store" starts on a store the block does not have yet, so it does not add a repeat.
  const used = new Set(links.map((link) => link.store));
  const next = stores.find((store) => !used.has(store)) ?? stores[0]!;
  const full = links.length >= max;
  return (
    <div className="flex flex-col gap-2">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {links.map((link, index) => (
          <StoreRowCard
            key={link.id}
            row={link}
            index={index}
            rows={links}
            stores={stores}
            labels={labels}
            noun={noun}
            blockId={blockId}
            errors={errors}
            onChange={(row) =>
              onChange(links.map((it) => (it.id === link.id ? ({ ...it, ...row } as L) : it)))
            }
            onMove={(to) => onChange(moved(links, index, to))}
            onRemove={() => onChange(links.filter((it) => it.id !== link.id))}
          />
        ))}
      </ol>
      <div aria-live="polite" className="empty:hidden">
        {listError ? (
          <p data-field="links" className="text-[13px] text-bad">
            {listError}
          </p>
        ) : null}
      </div>
      <AddButton disabled={full} onClick={() => onChange([...links, make(next as never)])}>
        Add store
      </AddButton>
      {full ? (
        <p data-field="links-limit" className="text-xs text-text-2">
          {limitMessage}
        </p>
      ) : null}
    </div>
  );
}

/** The Publish gate's message for the cover: `cover` (a missing, foreign or vanished upload) or `cover.path`. */
function coverError(errors: readonly PublishError[], blockId: string): string | null {
  const hit = errors.find(
    (error) =>
      error.blockId === blockId &&
      error.itemId === undefined &&
      (error.field === "cover" || error.field.startsWith("cover.")),
  );
  return hit ? hit.message : null;
}

/** The cover control's help line: the 2:3 frame the page crops it to. */
export const BOOK_COVER_HELP = "JPG, PNG or WebP. Shown at a 2 to 3 ratio.";

/**
 * Book links (M9-20): the title and author, the cover (upload, replace, remove: the content upload,
 * so it counts in the account's quota and rate limit), up to three store rows and the style group
 * (Button style, Color, Corner radius).
 */
export function BookForm({ block, onChange, onImage, errors }: BlockFormProps) {
  if (block.type !== "book") return null;
  const book: BookBlock = block;
  const cover = coverError(errors, book.id);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <CountedTextField
          label="Title"
          field="title"
          max={LIMITS.bookTitle}
          value={book.title}
          error={fieldError(errors, book.id, "title")}
          onChange={(title) => onChange({ ...book, title })}
          className="flex-1 basis-[220px]"
        />
        <CountedTextField
          label="Author"
          field="author"
          max={LIMITS.bookAuthor}
          value={book.author}
          error={fieldError(errors, book.id, "author")}
          onChange={(author) => onChange({ ...book, author })}
          className="flex-1 basis-[220px]"
        />
      </div>
      <div className="flex flex-col gap-1.5" data-testid="book-cover">
        <span className="text-[13px] font-semibold text-ink-2">Cover</span>
        <ImageUploadControl
          kind="content"
          label="cover"
          help={BOOK_COVER_HELP}
          value={book.cover}
          onChange={onImage}
        />
        <div aria-live="polite" className="empty:hidden">
          {cover ? (
            <p data-field="cover" className="text-[13px] text-bad">
              {cover}
            </p>
          ) : null}
        </div>
      </div>
      <StoreRows
        blockId={book.id}
        links={book.links}
        stores={BOOK_STORES}
        labels={BOOK_STORE_LABELS}
        max={LIMITS.bookLinks}
        limitMessage={bookStoresLimitMessage(LIMITS.bookLinks)}
        noun="Store"
        make={newBookLink}
        errors={errors}
        onChange={(links) => onChange({ ...book, links })}
      />
      <OverrideControls block={book} onChange={onChange} errors={errors} />
    </div>
  );
}

/**
 * App store buttons (M9-21): up to two rows (the App Store, Google Play), each once, and the style
 * group (Color, Corner radius).
 */
export function AppsForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "apps") return null;
  const apps: AppsBlock = block;
  return (
    <div className="flex flex-col gap-3">
      <StoreRows
        blockId={apps.id}
        links={apps.links}
        stores={APP_STORES}
        labels={APP_STORE_LABELS}
        max={LIMITS.appLinks}
        limitMessage={appStoresLimitMessage(LIMITS.appLinks)}
        noun="Store"
        make={newAppLink}
        errors={errors}
        onChange={(links) => onChange({ ...apps, links })}
      />
      <OverrideControls block={apps} onChange={onChange} errors={errors} />
    </div>
  );
}
