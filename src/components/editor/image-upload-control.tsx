"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { imageRefSchema, type ImageRef } from "@/lib/document";
import { sniffImageType } from "@/lib/editor/sniff";
import { mediaUrl } from "@/lib/media/url";
import { UploadIcon } from "./icons";

/** The upload route's size limit (M2-08): 4 MB. Checked here first so a big file is never sent. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const NOT_AN_IMAGE_MESSAGE = "That file isn’t a JPG, PNG or WebP image. Choose another.";
export const TOO_BIG_MESSAGE = "That image is over 4 MB. Choose a smaller one.";
const UNUSABLE_MESSAGE = "That image can’t be used. Choose a smaller or different one.";
const SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again to upload.";
const FAILED_MESSAGE = "Couldn’t upload that image. Try again.";

export interface ImageUploadControlProps {
  value: ImageRef | null;
  /** Picks the output size on the server (Milestone 5); the avatar variant is a round 72px photo. */
  kind: "avatar" | "background" | "content";
  onChange: (next: ImageRef | null) => void;
  /** What the image is called in the buttons: "photo" (avatar default) or "image". */
  label?: string;
  /** Fallback letters for the avatar when there is no photo. */
  initials?: string;
}

/**
 * Upload, replace and remove one image (M2-09). Posts the file to `/api/media`, which stores it and
 * answers `{path, width, height}`; the control hands exactly that to `onChange` and nothing else.
 * Replacing or removing only changes the reference: no Storage call, so an object the published
 * page still uses stays readable. Errors show under the buttons and leave `value` as it was.
 *
 * Used by the profile card (avatar) and by the image and card block forms (content).
 */
export function ImageUploadControl({
  value,
  kind,
  onChange,
  label,
  initials = "?",
}: ImageUploadControlProps) {
  const noun = label ?? (kind === "avatar" ? "photo" : "image");
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(TOO_BIG_MESSAGE);
      return;
    }
    if ((await sniffImageType(file)) === null) {
      setError(NOT_AN_IMAGE_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const response = await fetch("/api/media", { method: "POST", body });
      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }
      const parsed = imageRefSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError(FAILED_MESSAGE);
        return;
      }
      // Only the reference goes into the draft: the route's public url is derived from the path.
      onChange({ path: parsed.data.path, width: parsed.data.width, height: parsed.data.height });
    } catch {
      setError(FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must fire a change again
    if (file) void upload(file);
  }

  const help =
    kind === "avatar"
      ? "JPG or PNG, square works best. Without a photo, your initials show."
      : "JPG, PNG or WebP, up to 4 MB.";

  return (
    <div className="flex flex-wrap items-center gap-3.5">
      {kind === "avatar" ? (
        <Avatar value={value} initials={initials} />
      ) : (
        <Thumbnail value={value} noun={noun} />
      )}
      <div className="flex min-w-0 flex-1 basis-[200px] flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPick}
            className="hidden"
            tabIndex={-1}
          />
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-progress disabled:opacity-60"
          >
            <UploadIcon />
            {busy ? "Uploading..." : value ? `Replace ${noun}` : `Upload ${noun}`}
          </button>
          {value ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                onChange(null);
              }}
              className="min-h-11 rounded-md border border-bad-line bg-surface px-3 text-[13px] font-semibold text-bad disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
        <span id={helpId} className="text-xs text-text-2">
          {help}
        </span>
        {error ? (
          <span id={errorId} role="alert" className="text-[13px] text-bad">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function messageForStatus(status: number): string {
  if (status === 413) return TOO_BIG_MESSAGE;
  if (status === 415) return NOT_AN_IMAGE_MESSAGE;
  if (status === 422) return UNUSABLE_MESSAGE;
  if (status === 401) return SIGNED_OUT_MESSAGE;
  return FAILED_MESSAGE;
}

/** 72px circle: the photo (cover) or the initials on a neutral fill. */
function Avatar({ value, initials }: { value: ImageRef | null; initials: string }) {
  if (value) {
    return (
      <span
        role="img"
        aria-label="Profile photo"
        className="block size-[72px] shrink-0 overflow-hidden rounded-full border border-line-2 bg-track"
      >
        {/* A plain <img>: the path is an image reference into the public page-media bucket. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(value.path)}
          alt=""
          width={72}
          height={72}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={`Profile photo: initials ${initials}`}
      className="box-border flex size-[72px] shrink-0 items-center justify-center rounded-full border border-line-2 bg-track text-[22px] font-semibold text-ink-2"
    >
      {initials}
    </span>
  );
}

/** Rectangular preview for content and background images. */
function Thumbnail({ value, noun }: { value: ImageRef | null; noun: string }) {
  if (value) {
    return (
      <span
        role="img"
        aria-label={`Current ${noun}`}
        className="block h-[72px] w-[108px] shrink-0 overflow-hidden rounded-md border border-line-2 bg-track"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(value.path)}
          alt=""
          width={108}
          height={72}
          className="size-full object-cover"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="box-border flex h-[72px] w-[108px] shrink-0 items-center justify-center rounded-md border border-dashed border-line-3 text-xs text-text-2"
    >
      No {noun}
    </span>
  );
}
