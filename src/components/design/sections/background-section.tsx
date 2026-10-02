"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { backgroundImagePath } from "@/components/page/background";
import type { DesignSectionProps } from "@/components/design/types";
import {
  MAX_UPLOAD_BYTES,
  NOT_AN_IMAGE_MESSAGE,
  TOO_BIG_MESSAGE,
  quotaMessageFromText,
} from "@/components/editor/image-upload-control";
import { imageRefSchema, type ImageRef } from "@/lib/document";
import { sniffImageType } from "@/lib/editor/sniff";
import { mediaUrl } from "@/lib/media/url";
import { tokenSetSchema } from "@/lib/theme";
import { OptionButton, OptionGroup } from "./shape-section";

/**
 * Background on the Design screen: solid or gradient (M3-14), an uploaded image with replace and
 * remove (M3-15), and the overlay and blur that go with an image (M3-16).
 *
 * The image goes through the same route as every tenant image, POST /api/media with kind
 * `background`, and the draft stores that object's public page-media URL (`mediaUrl(path)`),
 * never anything typed. Replacing or removing only changes the draft: the object the published
 * page still uses stays in Storage, so the live page cannot break before the next Publish.
 */

const UNUSABLE_MESSAGE = "That image can’t be used. Choose a smaller or different one.";
const SIGNED_OUT_MESSAGE = "You’re signed out. Sign in again to upload.";
const FAILED_MESSAGE = "Couldn’t upload that image. Try again.";

/** The widest blur the token allows (the slider follows the schema, so the two cannot disagree). */
const BLUR_MAX = tokenSetSchema.shape.blur.maxValue ?? 20;

function messageForStatus(status: number): string {
  if (status === 413) return TOO_BIG_MESSAGE;
  if (status === 415) return NOT_AN_IMAGE_MESSAGE;
  if (status === 422) return UNUSABLE_MESSAGE;
  if (status === 401) return SIGNED_OUT_MESSAGE;
  return FAILED_MESSAGE;
}

/** Posts one image to the upload route, reporting how much of it has been sent (0 to 100). */
function postBackground(file: File, onProgress: (percent: number) => void): Promise<ImageRef> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("file", file);
    body.append("kind", "background");
    const request = new XMLHttpRequest();
    request.open("POST", "/api/media");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    request.onerror = () => reject(new Error(FAILED_MESSAGE));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        // Over the plan's total (M4-31): the route's own sentence says which plan and what to do.
        const quota = request.status === 413 ? quotaMessageFromText(request.responseText) : null;
        reject(new Error(quota ?? messageForStatus(request.status)));
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(request.responseText);
      } catch {
        reject(new Error(FAILED_MESSAGE));
        return;
      }
      const parsed = imageRefSchema.safeParse(json);
      if (!parsed.success) {
        reject(new Error(FAILED_MESSAGE));
        return;
      }
      resolve({ path: parsed.data.path, width: parsed.data.width, height: parsed.data.height });
    };
    request.send(body);
  });
}

type BackgroundKind = "solid" | "gradient";

const KINDS: readonly { value: BackgroundKind; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
];

export function BackgroundSection({ resolved, setToken }: DesignSectionProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;

  // The upload finishes long after the click that started it: always call the newest setToken.
  const setTokenRef = useRef(setToken);
  useEffect(() => {
    setTokenRef.current = setToken;
  }, [setToken]);

  // An image counts only when the token is one of the owner's page-media URLs (the renderer draws
  // nothing else), so the page is "image" exactly when the renderer would draw one.
  const imagePath = backgroundImagePath(resolved.bgImage);
  const imageActive = resolved.bgType === "image" && imagePath !== null;
  const kind: BackgroundKind | "image" = imageActive
    ? "image"
    : resolved.bgType === "gradient"
      ? "gradient"
      : "solid";

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
    setProgress(0);
    try {
      const image = await postBackground(file, setProgress);
      // The URL is rebuilt from the stored path, so what the draft holds is always the bucket's.
      setTokenRef.current("bgImage", mediaUrl(image.path));
      setTokenRef.current("bgType", "image");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : FAILED_MESSAGE);
    } finally {
      setProgress(null);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must fire a change again
    if (file) void upload(file);
  }

  function removeImage(): void {
    setError(null);
    setToken("bgType", "solid");
    setToken("bgImage", null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <OptionGroup label="Background">
          {KINDS.map((option) => (
            <OptionButton
              key={option.value}
              pressed={kind === option.value}
              onPick={() => setToken("bgType", option.value)}
            >
              {option.label}
            </OptionButton>
          ))}
          <button
            type="button"
            disabled={uploading}
            aria-busy={uploading}
            data-active={kind === "image" ? "true" : undefined}
            onClick={() => fileRef.current?.click()}
            style={{ flex: "1 1 60px" }}
            className={`min-h-11 min-w-0 rounded-sm border px-2 text-sm font-medium hl:min-h-10 disabled:cursor-progress disabled:opacity-60 ${
              kind === "image"
                ? "border-transparent bg-surface text-ink ring-1 ring-line-2"
                : "border-dashed border-line-3 bg-transparent text-text-2"
            }`}
          >
            Image…
          </button>
        </OptionGroup>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose a background image"
          data-testid="background-file"
          onChange={onPick}
          className="hidden"
          tabIndex={-1}
        />
        <span className="text-xs text-text-2">Image: JPG, PNG or WebP, up to 4 MB.</span>
        {uploading ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-text-2" aria-live="polite">
              Uploading… {progress}%
            </span>
            <div
              role="progressbar"
              aria-label="Uploading background image"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1.5 overflow-hidden rounded-sm bg-track"
            >
              <div className="h-full bg-brass" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}
        {error ? (
          <span role="alert" className="text-[13px] text-bad">
            {error}
          </span>
        ) : null}
      </div>

      {imageActive && imagePath !== null ? (
        <>
          <div className="flex flex-wrap items-center gap-3.5">
            <span
              role="img"
              aria-label="Current background image"
              className="block h-[72px] w-[108px] shrink-0 overflow-hidden rounded-md border border-line-2 bg-track"
            >
              {/* A plain <img>: the path is an image reference into the public page-media bucket. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(imagePath)}
                alt=""
                width={108}
                height={72}
                className="size-full object-cover"
                referrerPolicy="no-referrer"
              />
            </span>
            <button
              type="button"
              disabled={uploading}
              onClick={removeImage}
              className="min-h-11 rounded-md border border-bad-line bg-surface px-3 text-[13px] font-semibold text-bad disabled:opacity-60"
            >
              Remove image
            </button>
          </div>
          <Slider
            label="Overlay"
            value={Math.round(resolved.overlayOpacity * 100)}
            max={100}
            unit="%"
            onChange={(value) => setToken("overlayOpacity", value / 100)}
          />
          <Slider
            label="Blur"
            value={Math.round(resolved.blur)}
            max={BLUR_MAX}
            unit="px"
            onChange={(value) => setToken("blur", value)}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * A labelled range input with its value beside the label. The input is the whole 44px touch
 * target; arrow keys, Home, End and Page keys come with the native control.
 */
function Slider({
  label,
  value,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const text = `${value}${unit}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        <span aria-hidden="true" className="font-mono text-[13px] text-text-2">
          {text}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
        className="m-0 h-11 w-full cursor-pointer accent-brass"
      />
    </div>
  );
}
