"use client";

import { LIMITS, parseEmbed, type ImageRef } from "@/lib/document";
import { ImageUploadControl } from "@/components/editor/image-upload-control";
import { TextField } from "../text-field";
import { UrlField } from "../url-field";
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

/** Link card: title, caption, address and the banner image (upload, replace, remove). */
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
    </div>
  );
}

/** Image: the upload control, alt text and an optional link. */
export function ImageForm({ block, onChange, onImage, errors }: BlockFormProps) {
  if (block.type !== "image") return null;
  return (
    <div className="flex flex-col gap-3">
      <ImageField
        label="Image"
        value={block.image}
        error={imageError(errors, block.id)}
        onChange={onImage}
      />
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
    </div>
  );
}

/** Embed: caption and a YouTube or Spotify address. */
export function EmbedForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "embed") return null;
  const embed = parseEmbed(block.url.trim());
  const detected =
    embed === null
      ? null
      : embed.provider === "youtube"
        ? "YouTube video"
        : `Spotify ${embed.kind}`;
  return (
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
  );
}
