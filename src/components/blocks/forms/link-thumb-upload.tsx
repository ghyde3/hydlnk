"use client";

import { Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { EDITOR_ICON_STROKE, Icon } from "@/components/app/icon";
import { PositionDialog } from "@/components/editor/position-dialog";
import { LINK_THUMB_UPLOAD_KIND, imageRefSchema, type ImageRef } from "@/lib/document";
import { sniffImageType } from "@/lib/editor/sniff";
import { MAX_UPLOAD_BYTES } from "@/lib/media/limits";
import {
  FILE_TOO_BIG_MESSAGE,
  UNREADABLE_IMAGE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  uploadErrorMessage,
} from "@/lib/media/messages";
import { decodeForPositioning, type PositionPhoto } from "@/lib/media/position-crop";

/** What the help line under the buttons says. */
export const LINK_THUMB_HELP = "JPG, PNG or WebP. Shown as a small square next to the label.";

/**
 * Upload, replace and remove a link's thumbnail (M6-21). A picked file is type-checked (the real
 * bytes), decoded and shown in the "Position your image" dialog (M6-24, the profile photo's dialog
 * with a square viewfinder); only what "Use image" draws is uploaded, to POST /api/media with
 * `kind=avatar` (a square 400px WebP of at most 100 KB, stored as `{uid}/avatar-{hash}.webp`): the
 * same route, limits, quota and rate limit as the profile photo, so a thumbnail is counted like any
 * other upload. Cancel, Escape and a picture the browser cannot read upload nothing. The control
 * hands exactly `{path, width, height}` to `onImage` and nothing else. Replacing or removing only
 * changes the reference: no Storage call, so an object the published page still uses stays
 * readable. An error shows under the buttons and leaves the icon as it was.
 */
export function LinkThumbUpload({
  hasImage,
  onImage,
}: {
  /** The link already has a thumbnail: the button says "Replace image" and Remove shows. */
  hasImage: boolean;
  /** An upload finished (the new reference) or Remove was pressed (null). */
  onImage: (image: ImageRef | null) => void;
}) {
  const suspended = useAccountSuspended();
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  /** The last file sent, so "Try again" can send it again (kept only while a retry makes sense). */
  const retryFile = useRef<File | null>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  // The picked picture, decoded, while the position dialog is open (null otherwise).
  const [positioned, setPositioned] = useState<PositionPhoto | null>(null);
  const heldPhoto = useRef<PositionPhoto | null>(null);
  useEffect(() => {
    heldPhoto.current = positioned;
  }, [positioned]);
  // A decoded picture is freed when the control goes away.
  useEffect(() => () => heldPhoto.current?.close(), []);
  // Cancel and Escape give focus back to the button that opened the dialog.
  const refocusButton = useRef(false);
  useEffect(() => {
    if (positioned !== null || !refocusButton.current) return;
    refocusButton.current = false;
    uploadButton.current?.focus();
  }, [positioned]);

  function fail(message: string, retryable = false, file?: File): void {
    retryFile.current = retryable ? (file ?? null) : null;
    setCanRetry(retryable && file !== undefined);
    setError(message);
  }

  async function send(file: File): Promise<void> {
    setBusy(true);
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(FILE_TOO_BIG_MESSAGE);
        return;
      }
      const body = new FormData();
      body.append("file", file);
      body.append("kind", LINK_THUMB_UPLOAD_KIND);
      const response = await fetch("/api/media", { method: "POST", body });
      if (!response.ok) {
        // The route says what is wrong in `message` (M5-13); over the plan's total (M4-31) the same
        // field carries the plan's sentence, and sending the same file again is worth offering once
        // the person has made room.
        const text = await response.text().catch(() => "");
        const quota = response.status === 413 ? isQuotaBody(text) : false;
        fail(
          uploadErrorMessage(response.status, parseBody(text)),
          quota || response.status >= 500,
          file,
        );
        return;
      }
      const parsed = imageRefSchema.safeParse(await response.json());
      if (!parsed.success) {
        fail(UPLOAD_FAILED_MESSAGE, true, file);
        return;
      }
      // Only the reference goes into the draft: the route's public url is derived from the path.
      onImage({ path: parsed.data.path, width: parsed.data.width, height: parsed.data.height });
    } catch {
      fail(UPLOAD_FAILED_MESSAGE, true, file);
    } finally {
      setBusy(false);
    }
  }

  /** A picked file: the real type is checked, the picture is decoded, then the dialog opens. */
  async function pick(picked: File): Promise<void> {
    setError(null);
    setCanRetry(false);
    retryFile.current = null;
    const type = await sniffImageType(picked);
    if (type === null) {
      setError(UNSUPPORTED_TYPE_MESSAGE);
      return;
    }
    const photo = await decodeForPositioning(picked, type !== "jpg");
    if (!photo) {
      setError(UNREADABLE_IMAGE_MESSAGE);
      return;
    }
    setPositioned((previous) => {
      previous?.close();
      return photo;
    });
  }

  function closeDialog(giveFocusBack: boolean): void {
    refocusButton.current = giveFocusBack;
    setPositioned((previous) => {
      previous?.close();
      return null;
    });
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must fire a change again
    if (file) void pick(file);
  }

  return (
    <div data-testid="link-thumb-upload" className="flex min-w-0 flex-col gap-1.5">
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
          disabled={busy || suspended}
          aria-busy={busy}
          aria-describedby={helpId}
          title={suspended ? SUSPENDED_REASON : undefined}
          onClick={() => fileRef.current?.click()}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-progress disabled:opacity-60"
        >
          <Icon icon={Upload} size={15} strokeWidth={EDITOR_ICON_STROKE} />
          {busy ? "Uploading..." : hasImage ? "Replace image" : "Upload image"}
        </button>
        {hasImage ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setCanRetry(false);
              onImage(null);
            }}
            className="min-h-11 rounded-md border border-bad-line bg-surface px-3 text-[13px] font-semibold text-bad disabled:opacity-60"
          >
            Remove
          </button>
        ) : null}
      </div>
      <span id={helpId} className="text-xs text-text-2">
        {LINK_THUMB_HELP}
      </span>
      {suspended ? <span className="text-xs text-text-2">{SUSPENDED_REASON}</span> : null}
      {error ? (
        <span id={errorId} role="alert" className="text-[13px] text-bad">
          {error}
        </span>
      ) : null}
      {error && canRetry ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const file = retryFile.current;
            if (file) {
              setError(null);
              void send(file);
            }
          }}
          className="inline-flex min-h-11 w-fit items-center rounded-md border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink disabled:cursor-progress disabled:opacity-60"
        >
          Try again
        </button>
      ) : null}
      {positioned ? (
        <PositionDialog
          photo={positioned}
          variant="image"
          onUse={(file) => {
            closeDialog(false);
            void send(file);
          }}
          onCancel={() => closeDialog(true)}
        />
      ) : null}
    </div>
  );
}

/** Whether a 413 body is the route's `upload_quota` sentence (the plan's total is full). */
function isQuotaBody(text: string): boolean {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    return body.error === "upload_quota" && typeof body.message === "string" && body.message !== "";
  } catch {
    return false;
  }
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
