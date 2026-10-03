"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { LinkGlyph, resolveLinkIcon } from "@/components/page/link-icon";
import {
  LINK_ICONS,
  LINK_ICON_LABELS,
  type ImageRef,
  type LinkBlock,
  type LinkIconName,
  type PublishError,
} from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { FORM_BUTTON } from "../field";
import { LinkThumbUpload } from "./link-thumb-upload";

/**
 * The Publish gate's message for a link's icon: `icon` for a missing, foreign or vanished
 * thumbnail, `icon.name` for a name that is not on the list, `icon.image.path` for a value that is
 * not a stored image reference at all.
 */
export function iconError(errors: readonly PublishError[], blockId: string): string | null {
  const hit = errors.find(
    (error) =>
      error.blockId === blockId &&
      error.itemId === undefined &&
      (error.field === "icon" || error.field.startsWith("icon.")),
  );
  return hit ? hit.message : null;
}

type Tab = "icons" | "image";

/** The segmented control's look in the Profile card and the Design screen: a track, a white chosen item. */
const SEGMENT =
  "flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-sm px-2 text-center text-sm leading-tight font-medium";

/**
 * The Icon field of a link block (M6-21): a 44px preview tile, a "Choose icon" button and, when it
 * is open, an inline panel (not a modal) with an "Icons | Your image" switch. Everything here is
 * on every plan. Choosing a built-in icon, uploading an image and "No icon" each write `icon`
 * through the editor (so each is an undo step); the two kinds never exist together.
 */
export function LinkIconField({
  block,
  error,
  onChange,
  onImage,
}: {
  block: LinkBlock;
  /** The Publish gate's message for this field, or null. */
  error: string | null;
  onChange: (next: LinkBlock) => void;
  /** An uploaded thumbnail (or null for Remove): applied to the block as it is by then. */
  onImage: (image: ImageRef | null) => void;
}) {
  const panelId = useId();
  const errorId = useId();
  const chooseRef = useRef<HTMLButtonElement>(null);
  const resolved = resolveLinkIcon(block.icon);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("icons");

  function toggle(): void {
    if (!open) setTab(resolved?.kind === "image" ? "image" : "icons");
    setOpen(!open);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape") return;
    // Escape in the position dialog cancels that dialog (it has its own handler), not this panel.
    if (event.target instanceof Element && event.target.closest("dialog")) return;
    event.stopPropagation();
    setOpen(false);
    chooseRef.current?.focus();
  }

  const choose = (name: LinkIconName): void =>
    onChange({ ...block, icon: { type: "builtin", name } });
  const clear = (): void => {
    const { icon, ...rest } = block;
    void icon; // dropped: no icon means no key
    onChange(rest);
  };

  return (
    <div data-testid="link-icon-field" className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">Icon</span>
      <div className="flex items-center gap-3">
        <PreviewTile resolved={resolved} />
        <button
          ref={chooseRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-describedby={error ? errorId : undefined}
          onClick={toggle}
          className={FORM_BUTTON}
        >
          Choose icon
        </button>
      </div>

      {open ? (
        <div
          id={panelId}
          data-testid="link-icon-panel"
          onKeyDown={onKeyDown}
          className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3"
        >
          <div
            role="group"
            aria-label="Icon source"
            className="flex gap-0.5 rounded-md border border-line bg-track p-[3px]"
          >
            {(
              [
                ["icons", "Icons"],
                ["image", "Your image"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={`${SEGMENT} ${
                  tab === value
                    ? "bg-surface text-ink ring-1 ring-line-2"
                    : "bg-transparent text-text-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "icons" ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-pressed={resolved === null}
                onClick={clear}
                className={`${FORM_BUTTON} w-fit ${
                  resolved === null ? "border-ink bg-track ring-1 ring-ink" : ""
                }`}
              >
                No icon
              </button>
              <div
                role="group"
                aria-label="Icons"
                className="grid grid-cols-[repeat(auto-fill,44px)] gap-1.5"
              >
                {LINK_ICONS.map((name) => {
                  const current = resolved?.kind === "builtin" && resolved.name === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-label={LINK_ICON_LABELS[name]}
                      aria-pressed={current}
                      data-icon-name={name}
                      onClick={() => choose(name)}
                      className={`flex size-11 items-center justify-center rounded-md border text-ink ${
                        current ? "border-ink bg-track ring-1 ring-ink" : "border-line-3 bg-surface"
                      }`}
                    >
                      <LinkGlyph name={name} />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <LinkThumbUpload hasImage={resolved?.kind === "image"} onImage={onImage} />
          )}
        </div>
      ) : null}

      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p id={errorId} data-field="icon" className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** 44px square: empty when the link has no icon, else the glyph or the 40px thumbnail. */
function PreviewTile({ resolved }: { resolved: ReturnType<typeof resolveLinkIcon> }) {
  const base =
    "flex size-11 shrink-0 items-center justify-center rounded-md border bg-surface text-ink";
  if (resolved === null) {
    return (
      <span
        data-testid="link-icon-tile"
        data-icon="none"
        aria-hidden="true"
        className={`${base} border-dashed border-line-3`}
      />
    );
  }
  if (resolved.kind === "builtin") {
    return (
      <span
        data-testid="link-icon-tile"
        data-icon="builtin"
        role="img"
        aria-label={`Current icon: ${LINK_ICON_LABELS[resolved.name]}`}
        className={`${base} border-line-2`}
      >
        <LinkGlyph name={resolved.name} />
      </span>
    );
  }
  return (
    <span
      data-testid="link-icon-tile"
      data-icon="image"
      role="img"
      aria-label="Current icon: your image"
      className={`${base} border-line-2`}
    >
      {/* A plain <img>: the path is an image reference into the public page-media bucket. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaUrl(resolved.image.path)}
        alt=""
        width={40}
        height={40}
        className="size-10 rounded-sm object-cover"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}
