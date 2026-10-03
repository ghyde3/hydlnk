"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { imageRefSchema, type ImageRef } from "@/lib/document";
import { sniffImageType } from "@/lib/editor/sniff";
import {
  FILE_TOO_BIG_MESSAGE,
  UNREADABLE_IMAGE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  uploadErrorMessage,
} from "@/lib/media/messages";
import { decodeForPositioning, type PositionPhoto } from "@/lib/media/position-crop";
import { prepareImageForUpload } from "@/lib/media/upload-client";
import { mediaUrl } from "@/lib/media/url";
import { UploadIcon } from "./icons";
import { PositionDialog, type PositionVariant } from "./position-dialog";

/** The upload route's size limit (M2-08): 4 MB. Checked here first so a big file is never sent. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// The route's own sentences (M5-13): the one place the upload copy lives is src/lib/media/messages.ts.
export const NOT_AN_IMAGE_MESSAGE = UNSUPPORTED_TYPE_MESSAGE;
export const TOO_BIG_MESSAGE = FILE_TOO_BIG_MESSAGE;
const FAILED_MESSAGE = UPLOAD_FAILED_MESSAGE;

export interface ImageUploadControlProps {
  value: ImageRef | null;
  /** Picks the output size on the server (Milestone 5); the avatar variant is a round 72px photo. */
  kind: "avatar" | "background" | "content";
  onChange: (next: ImageRef | null) => void;
  /** What the image is called in the buttons: "photo" (avatar default) or "image". */
  label?: string;
  /** Fallback letters for the avatar when there is no photo. */
  initials?: string;
  /** The help line under the buttons, when the default for `kind` is not the right words (M6-33). */
  help?: string;
  /**
   * The words of the "Position your ..." dialog an `avatar` upload goes through (M6-24): "photo"
   * (the profile photo: "Position your photo", "Use photo") or "image" (a link's thumbnail:
   * "Position your image", "Use image"). Defaults to "photo" when the control's noun is "photo",
   * else "image".
   */
  positioning?: PositionVariant;
}

/**
 * Upload, replace and remove one image (M2-09). Posts the file to `/api/media`, which stores it and
 * answers `{path, width, height}`; the control hands exactly that to `onChange` and nothing else.
 *
 * `kind="avatar"` (the profile photo, a link's thumbnail) is a square crop made in the browser
 * (M6-24): a picked file is type-checked (the real bytes, not the name), decoded, and shown in the
 * "Position your photo" dialog; only what "Use photo" draws is uploaded, as a JPEG or PNG of at most
 * 800px that the route turns into the 400px WebP. Cancel, Escape and a picture the browser cannot
 * read upload nothing. "Adjust photo" reopens the dialog on the stored picture and uploads a new
 * object. The route and the stored reference do not change, and no crop value is stored.
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
  help: helpText,
  positioning: positioningVariant,
}: ImageUploadControlProps) {
  const noun = label ?? (kind === "avatar" ? "photo" : "image");
  // A suspended owner cannot upload (M5-09); the route answers 403 account_suspended regardless.
  const suspended = useAccountSuspended();
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  /** The last file sent, so "Try again" can send it again (kept only while a retry makes sense). */
  const retryFile = useRef<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  // An avatar is a square crop (M6-24): a picked file or the stored photo opens the "Position your
  // photo" dialog first, and only its result is uploaded. `preparing` covers the decode before it opens.
  const squareCrop = kind === "avatar";
  const variant: PositionVariant = positioningVariant ?? (noun === "photo" ? "photo" : "image");
  const uploadButton = useRef<HTMLButtonElement>(null);
  const adjustButton = useRef<HTMLButtonElement>(null);
  const [positioned, setPositioned] = useState<PositionPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  /** The button that opened the dialog: Cancel and Escape give focus back to it. */
  const opener = useRef<HTMLButtonElement | null>(null);
  const refocusOpener = useRef(false);
  const refocusAfterUpload = useRef(false);
  const heldPhoto = useRef<PositionPhoto | null>(null);
  useEffect(() => {
    heldPhoto.current = positioned;
  }, [positioned]);
  // A decoded picture is freed when the control goes away.
  useEffect(() => () => heldPhoto.current?.close(), []);
  useEffect(() => {
    if (positioned !== null || !refocusOpener.current) return;
    refocusOpener.current = false;
    (opener.current ?? uploadButton.current)?.focus();
  }, [positioned]);

  function fail(message: string, retryable = false, file?: File): void {
    retryFile.current = retryable ? (file ?? null) : null;
    setCanRetry(retryable && file !== undefined);
    setError(message);
  }

  async function upload(picked: File): Promise<void> {
    setError(null);
    setCanRetry(false);
    retryFile.current = null;
    if ((await sniffImageType(picked)) === null) {
      setError(NOT_AN_IMAGE_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      // A phone photo can be 6 to 12 MB and Vercel caps a request body at 4.5 MB: a photo that is too
      // big in bytes or pixels is redrawn at most 2400px on its longest edge first (M5-11).
      const file = await prepareImageForUpload(picked);
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(TOO_BIG_MESSAGE);
        return;
      }
      const body = new FormData();
      body.append("file", file);
      body.append("kind", kind);
      const response = await fetch("/api/media", { method: "POST", body });
      if (!response.ok) {
        // The route says what is wrong in `message` (M5-13); over the plan's total (M4-31) the same
        // field carries the plan's sentence, and sending the same file again is worth offering once
        // the person has made room.
        const text = await response.text().catch(() => "");
        const quota = response.status === 413 ? quotaMessageFromText(text) : null;
        const message = uploadErrorMessage(response.status, parseBody(text));
        fail(message, quota !== null || response.status >= 500, file);
        return;
      }
      const parsed = imageRefSchema.safeParse(await response.json());
      if (!parsed.success) {
        fail(FAILED_MESSAGE, true, file);
        return;
      }
      // Only the reference goes into the draft: the route's public url is derived from the path.
      onChange({ path: parsed.data.path, width: parsed.data.width, height: parsed.data.height });
    } catch {
      fail(FAILED_MESSAGE, true, picked);
    } finally {
      setBusy(false);
      // After the dialog, the button that showed "Uploading..." is the place to land.
      if (refocusAfterUpload.current) {
        refocusAfterUpload.current = false;
        queueMicrotask(() => {
          if (document.activeElement === document.body) uploadButton.current?.focus();
        });
      }
    }
  }

  /** Opens the dialog on `photo`, or says why not. */
  function openDialog(
    photo: PositionPhoto | null,
    failure: string,
    from: HTMLButtonElement | null,
  ): void {
    setPreparing(false);
    if (!photo) {
      setError(failure);
      return;
    }
    opener.current = from;
    setPositioned((previous) => {
      previous?.close();
      return photo;
    });
  }

  /** A picked file for a square crop: the real type is checked, the picture is decoded, then the dialog opens. */
  async function position(picked: File): Promise<void> {
    setError(null);
    setCanRetry(false);
    retryFile.current = null;
    const type = await sniffImageType(picked);
    if (type === null) {
      setError(NOT_AN_IMAGE_MESSAGE);
      return;
    }
    setPreparing(true);
    // A picture the browser cannot read opens no dialog and sends nothing. Over 4 MB and unreadable
    // is "too big" (the sentence it always had); anything else is "couldn't read it".
    openDialog(
      await decodeForPositioning(picked, type !== "jpg"),
      picked.size > MAX_UPLOAD_BYTES ? TOO_BIG_MESSAGE : UNREADABLE_IMAGE_MESSAGE,
      uploadButton.current,
    );
  }

  /** "Adjust": the stored picture, read back, in the same dialog. A new upload follows, with a new name. */
  async function adjust(): Promise<void> {
    if (!value) return;
    setError(null);
    setCanRetry(false);
    retryFile.current = null;
    setPreparing(true);
    let photo: PositionPhoto | null = null;
    try {
      const response = await fetch(mediaUrl(value.path));
      if (response.ok) {
        const blob = await response.blob();
        const type = await sniffImageType(blob);
        photo = type === null ? null : await decodeForPositioning(blob, type !== "jpg");
      }
    } catch {
      photo = null;
    }
    openDialog(
      photo,
      `We couldn’t open that ${noun}. Choose it again with Replace ${noun}.`,
      adjustButton.current,
    );
  }

  function closeDialog(giveFocusBack: boolean): void {
    refocusOpener.current = giveFocusBack;
    setPositioned((previous) => {
      previous?.close();
      return null;
    });
  }

  function onRetry(): void {
    const file = retryFile.current;
    if (file) void upload(file);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must fire a change again
    if (!file) return;
    if (squareCrop) void position(file);
    else void upload(file);
  }

  const help =
    helpText ??
    (kind === "avatar"
      ? "JPG or PNG, square works best. Without a photo, your initials show."
      : "JPG, PNG or WebP, up to 4 MB.");

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
            ref={uploadButton}
            type="button"
            disabled={busy || preparing || suspended}
            aria-busy={busy}
            title={suspended ? SUSPENDED_REASON : undefined}
            onClick={() => fileRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-progress disabled:opacity-60"
          >
            <UploadIcon />
            {busy ? "Uploading..." : value ? `Replace ${noun}` : `Upload ${noun}`}
          </button>
          {value && squareCrop ? (
            <button
              ref={adjustButton}
              type="button"
              disabled={busy || preparing || suspended}
              title={suspended ? SUSPENDED_REASON : undefined}
              onClick={() => void adjust()}
              className="inline-flex min-h-11 items-center rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-progress disabled:opacity-60"
            >
              {`Adjust ${noun}`}
            </button>
          ) : null}
          {value ? (
            <button
              type="button"
              disabled={busy || preparing}
              onClick={() => {
                setError(null);
                setCanRetry(false);
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
        {error && canRetry ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="inline-flex min-h-11 w-fit items-center rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-progress disabled:opacity-60"
          >
            Try again
          </button>
        ) : null}
      </div>
      {positioned ? (
        <PositionDialog
          photo={positioned}
          variant={variant}
          onUse={(file) => {
            refocusAfterUpload.current = true;
            closeDialog(false);
            void upload(file);
          }}
          onCancel={() => closeDialog(true)}
        />
      ) : null}
    </div>
  );
}

/**
 * The route's `upload_quota` sentence from a 413 body (`{error, message}`), or null for any other
 * 413 or a body that is not that JSON. Shared with the Design screen's background upload, so both
 * show the plan's own message ("Uploads are limited to 10 MB on Free. Delete an image or upgrade.").
 */
export function quotaMessageFromText(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (body.error === "upload_quota" && typeof body.message === "string" && body.message) {
      return body.message;
    }
  } catch {
    // Not JSON: the generic 413 sentence applies.
  }
  return null;
}

/** The route's JSON error body, or null when the text is not that JSON (a gateway page). */
function parseBody(text: string): { message?: unknown } | null {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null ? (body as { message?: unknown }) : null;
  } catch {
    return null;
  }
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
