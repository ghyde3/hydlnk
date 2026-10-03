"use client";

import {
  CARD_BANNER_RATIO,
  IMAGE_SHAPES,
  IMAGE_SHAPE_RATIO,
  LIMITS,
  embedLabel,
  parseEmbed,
  pickShape,
  type CardBlock,
  type Focus,
  type ImageBlock,
  type ImageRef,
  type ImageShape,
} from "@/lib/document";
import { ImageUploadControl } from "@/components/editor/image-upload-control";
import { Field, controlClass } from "../field";
import { TextField } from "../text-field";
import { UrlField } from "../url-field";
import { FocusPicker } from "./focus-picker";
import { OverrideControls } from "./override-controls";
import { fieldError, imageError, type BlockFormProps } from "./types";

/**
 * The upload, replace and remove control with a caption and the Publish gate's message for the
 * image ("Upload an image.", "That image isn’t in your uploads. Upload it again."). The message is
 * shown whenever the gate gave one; the editor drops it as soon as the draft changes.
 */
function ImageField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: ImageRef | null;
  error: string | null;
  onChange: (next: ImageRef | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <ImageUploadControl kind="content" label="image" value={value} onChange={onChange} />
      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <p data-field="image" className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** `block` with its image's focus set, or removed (`undefined`: "Center"). A new image arrives without one. */
function withFocus<B extends CardBlock | ImageBlock>(block: B, focus: Focus | undefined): B {
  if (!block.image) return block;
  const image: ImageRef = { ...block.image };
  if (focus) image.focus = focus;
  else delete image.focus;
  return { ...block, image };
}

const SHAPE_LABELS: Record<ImageShape, string> = {
  square: "Square",
  landscape: "Landscape",
  wide: "Wide",
};

/**
 * The image block's Shape select (M6-25): Original (no `shape` key) or Square, Landscape, Wide. A
 * value the draft holds that is not one of the three (written straight to the database) shows as
 * "Pick a shape" until a real one is chosen, so it can always be fixed from here.
 */
function ShapeField({
  block,
  error,
  onChange,
}: {
  block: ImageBlock;
  error: string | null;
  onChange: (next: ImageBlock) => void;
}) {
  const picked = pickShape(block.shape);
  const unknown = block.shape !== undefined && picked === null;
  return (
    <Field
      label="Shape"
      error={error}
      hint={picked === null ? "Choose a shape to crop and position the image." : undefined}
    >
      {(control) => (
        <select
          {...control}
          data-field="shape"
          value={picked ?? (unknown ? "unknown" : "original")}
          onChange={(event) => {
            const value = event.target.value;
            const next: ImageBlock = { ...block };
            const shape = pickShape(value);
            if (shape) next.shape = shape;
            else delete next.shape;
            onChange(next);
          }}
          className={controlClass(error != null && error !== "")}
        >
          {unknown ? (
            <option value="unknown" disabled>
              Pick a shape
            </option>
          ) : null}
          <option value="original">Original</option>
          {IMAGE_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {SHAPE_LABELS[shape]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * Link card: title, caption, address and the banner image (upload, replace, remove), its focus
 * (M6-25, once a banner exists), then the card's two override controls (Color and Corner radius: M3-18; a card has no button style).
 */
export function CardForm({ block, onChange, onImage, errors }: BlockFormProps) {
  if (block.type !== "card") return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <TextField
          label="Title"
          field="title"
          max={LIMITS.cardTitle}
          value={block.title}
          error={fieldError(errors, block.id, "title")}
          onChange={(title) => onChange({ ...block, title })}
          className="flex-1 basis-[220px]"
        />
        <TextField
          label="Caption"
          field="caption"
          max={LIMITS.cardCaption}
          value={block.caption}
          error={fieldError(errors, block.id, "caption")}
          hint="Shown under the banner. Leave it empty to show “View”."
          onChange={(caption) => onChange({ ...block, caption })}
          className="flex-1 basis-[220px]"
        />
      </div>
      <UrlField
        value={block.url}
        error={fieldError(errors, block.id, "url")}
        onChange={(url) => onChange({ ...block, url })}
      />
      <ImageField
        label="Banner image"
        value={block.image}
        error={imageError(errors, block.id)}
        onChange={onImage}
      />
      {block.image ? (
        <FocusPicker
          image={block.image}
          ratio={CARD_BANNER_RATIO}
          error={fieldError(errors, block.id, "focus")}
          onChange={(focus) => onChange(withFocus(block, focus))}
        />
      ) : null}
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}

/** Image: the upload control, shape and focus (M6-25), alt text and an optional link. */
export function ImageForm({ block, onChange, onImage, errors }: BlockFormProps) {
  if (block.type !== "image") return null;
  // The focus control is only for a cropped image: with the original shape nothing is cropped.
  // The one exception: a focus the Publish gate refused (written straight to the draft) is shown,
  // so the person can see the error and clear it with Center.
  const shape = pickShape(block.shape);
  const focusError = fieldError(errors, block.id, "focus");
  return (
    <div className="flex flex-col gap-3">
      <ImageField
        label="Image"
        value={block.image}
        error={imageError(errors, block.id)}
        onChange={onImage}
      />
      <ShapeField block={block} error={fieldError(errors, block.id, "shape")} onChange={onChange} />
      {block.image && (shape || focusError) ? (
        <FocusPicker
          image={block.image}
          ratio={
            shape
              ? IMAGE_SHAPE_RATIO[shape]
              : { width: block.image.width, height: block.image.height }
          }
          error={focusError}
          onChange={(focus) => onChange(withFocus(block, focus))}
        />
      ) : null}
      <TextField
        label="Alt text"
        field="alt"
        max={LIMITS.imageAlt}
        value={block.alt}
        error={fieldError(errors, block.id, "alt")}
        hint="Describe the image for people who can't see it"
        onChange={(alt) => onChange({ ...block, alt })}
      />
      <UrlField
        label="Link (optional)"
        optional
        value={block.url ?? ""}
        error={fieldError(errors, block.id, "url")}
        onChange={(url) => onChange({ ...block, url })}
      />
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}

/** Embed: caption and an address from one of the eight providers (M6-26). */
export function EmbedForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "embed") return null;
  const embed = parseEmbed(block.url.trim());
  // What was recognized: "YouTube video", "Spotify track", "Vimeo video", "Instagram reel"... (M6-27).
  const detected = embed === null ? null : embedLabel(embed);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <TextField
          label="Caption"
          field="caption"
          max={LIMITS.embedCaption}
          value={block.caption}
          error={fieldError(errors, block.id, "caption")}
          onChange={(caption) => onChange({ ...block, caption })}
          className="flex-1 basis-[220px]"
        />
        <UrlField
          kind="embed"
          value={block.url}
          error={fieldError(errors, block.id, "url")}
          hint={detected}
          onChange={(url) => onChange({ ...block, url })}
          className="flex-1 basis-[220px]"
        />
      </div>
      <OverrideControls block={block} onChange={onChange} errors={errors} />
    </div>
  );
}
