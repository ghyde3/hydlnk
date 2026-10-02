"use client";

import { useId, useState, type ReactNode } from "react";
import {
  EMAIL_ERROR_MESSAGE,
  LIMITS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  changeSocialPlatform,
  isEmailAddress,
  newGridCell,
  newSocialIcon,
  type GridBlock,
  type SocialBlock,
  type SocialIcon,
  type SocialPlatform,
} from "@/lib/document";
import { FORM_BUTTON, FORM_BUTTON_DANGER, Field, controlClass } from "../field";
import { TextField } from "../text-field";
import { UrlField } from "../url-field";
import { fieldError, itemHasError, type BlockFormProps } from "./types";

/** `list` with the item at `from` moved to `to`; the same list when either index is out of range. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Move up, Move down and Remove for one item of an icon or cell list. */
function ItemControls({
  index,
  count,
  minCount,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  minCount: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className={FORM_BUTTON}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        Move up
      </button>
      <button
        type="button"
        className={FORM_BUTTON}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        Move down
      </button>
      <button
        type="button"
        className={FORM_BUTTON_DANGER}
        disabled={count <= minCount}
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function ItemCard({
  label,
  itemId,
  invalid,
  children,
}: {
  label: string;
  itemId: string;
  invalid: boolean;
  children: ReactNode;
}) {
  return (
    <li
      role="group"
      aria-label={label}
      data-item-id={itemId}
      data-invalid={invalid ? "true" : undefined}
      className={`flex flex-col gap-3 rounded-md border p-3 ${
        invalid ? "border-bad bg-bad-line/20" : "border-line bg-surface"
      }`}
    >
      {children}
    </li>
  );
}

function AddButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${FORM_BUTTON} self-start`}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true" className="mr-1.5 text-brass-text">
        +
      </span>
      {children}
    </button>
  );
}

// Social icons ------------------------------------------------------------------------------------

function EmailInput({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | null;
  onChange: (next: string) => void;
}) {
  // Shown after the first blur and then on every change, like the URL field; Publish's own message
  // stays until the value validates.
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const local = touched && trimmed !== "" && !isEmailAddress(trimmed) ? EMAIL_ERROR_MESSAGE : null;
  const shown = local ?? (error && !(touched && isEmailAddress(trimmed)) ? error : null);
  return (
    <Field label="Email address" error={shown} className="min-w-0 flex-1 basis-[220px]">
      {(control) => (
        <input
          {...control}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="you@example.com"
          value={value}
          data-field="address"
          onChange={(event) => onChange(event.target.value.slice(0, LIMITS.email))}
          onBlur={() => {
            setTouched(true);
            if (value !== trimmed) onChange(trimmed);
          }}
          className={controlClass(shown !== null, "font-mono")}
        />
      )}
    </Field>
  );
}

function SocialIconRow({
  icon,
  index,
  count,
  errors,
  blockId,
  onChange,
  onMove,
  onRemove,
}: {
  icon: SocialIcon;
  index: number;
  count: number;
  errors: BlockFormProps["errors"];
  blockId: string;
  onChange: (next: SocialIcon) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const selectId = useId();
  const label = `Icon ${index + 1}: ${SOCIAL_PLATFORM_LABELS[icon.platform]}`;
  return (
    <ItemCard label={label} itemId={icon.id} invalid={itemHasError(errors, blockId, icon.id)}>
      <div className="flex flex-wrap gap-3">
        <div className="flex w-40 min-w-0 flex-none flex-col gap-1.5">
          <label htmlFor={selectId} className="text-[13px] font-semibold text-ink-2">
            Platform
          </label>
          <select
            id={selectId}
            value={icon.platform}
            data-field="platform"
            onChange={(event) =>
              onChange(changeSocialPlatform(icon, event.target.value as SocialPlatform))
            }
            className={controlClass(false, "pr-8")}
          >
            {SOCIAL_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {SOCIAL_PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
        </div>
        {icon.platform === "email" ? (
          <EmailInput
            value={icon.address}
            error={fieldError(errors, blockId, "address", icon.id)}
            onChange={(address) => onChange({ ...icon, address })}
          />
        ) : (
          <UrlField
            value={icon.url}
            error={fieldError(errors, blockId, "url", icon.id)}
            onChange={(url) => onChange({ ...icon, url })}
            className="flex-1 basis-[220px]"
          />
        )}
      </div>
      <ItemControls
        index={index}
        count={count}
        minCount={LIMITS.socialIconsMin}
        onMove={onMove}
        onRemove={onRemove}
      />
    </ItemCard>
  );
}

/** The first platform not already in the row, so "Add icon" does not repeat Instagram. */
function nextPlatform(icons: readonly SocialIcon[]): SocialPlatform {
  const used = new Set(icons.map((icon) => icon.platform));
  return SOCIAL_PLATFORMS.find((platform) => !used.has(platform)) ?? "website";
}

/** Social row: one row per icon (platform, address, move, remove) and "Add icon" up to eight. */
export function SocialForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "social") return null;
  const social: SocialBlock = block;
  const setIcons = (icons: SocialIcon[]) => onChange({ ...social, icons });
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {social.icons.map((icon, index) => (
          <SocialIconRow
            key={icon.id}
            icon={icon}
            index={index}
            count={social.icons.length}
            errors={errors}
            blockId={social.id}
            onChange={(next) => setIcons(social.icons.map((it) => (it.id === icon.id ? next : it)))}
            onMove={(to) => setIcons(moved(social.icons, index, to))}
            onRemove={() => setIcons(social.icons.filter((it) => it.id !== icon.id))}
          />
        ))}
      </ol>
      <AddButton
        disabled={social.icons.length >= LIMITS.socialIconsMax}
        onClick={() => setIcons([...social.icons, newSocialIcon(nextPlatform(social.icons))])}
      >
        Add icon
      </AddButton>
    </div>
  );
}

// Grid ----------------------------------------------------------------------------------------------

/** Two-column grid: per cell a title, subtitle and address; move, remove (min 2) and "Add cell" (max 6). */
export function GridForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "grid") return null;
  const grid: GridBlock = block;
  const setCells = (cells: GridBlock["cells"]) => onChange({ ...grid, cells });
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {grid.cells.map((cell, index) => (
          <ItemCard
            key={cell.id}
            label={`Cell ${index + 1}`}
            itemId={cell.id}
            invalid={itemHasError(errors, grid.id, cell.id)}
          >
            <div className="flex flex-wrap gap-3">
              <TextField
                label="Title"
                field="title"
                max={LIMITS.cellTitle}
                value={cell.title}
                error={fieldError(errors, grid.id, "title", cell.id)}
                onChange={(title) =>
                  setCells(grid.cells.map((it) => (it.id === cell.id ? { ...it, title } : it)))
                }
                className="flex-1 basis-[220px]"
              />
              <TextField
                label="Subtitle"
                field="subtitle"
                max={LIMITS.cellSubtitle}
                value={cell.subtitle}
                error={fieldError(errors, grid.id, "subtitle", cell.id)}
                onChange={(subtitle) =>
                  setCells(grid.cells.map((it) => (it.id === cell.id ? { ...it, subtitle } : it)))
                }
                className="flex-1 basis-[220px]"
              />
            </div>
            <UrlField
              value={cell.url}
              error={fieldError(errors, grid.id, "url", cell.id)}
              onChange={(url) =>
                setCells(grid.cells.map((it) => (it.id === cell.id ? { ...it, url } : it)))
              }
            />
            <ItemControls
              index={index}
              count={grid.cells.length}
              minCount={LIMITS.gridCellsMin}
              onMove={(to) => setCells(moved(grid.cells, index, to))}
              onRemove={() => setCells(grid.cells.filter((it) => it.id !== cell.id))}
            />
          </ItemCard>
        ))}
      </ol>
      <AddButton
        disabled={grid.cells.length >= LIMITS.gridCellsMax}
        onClick={() => setCells([...grid.cells, newGridCell()])}
      >
        Add cell
      </AddButton>
    </div>
  );
}
