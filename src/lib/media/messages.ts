/**
 * The sentences the upload route answers with and the editor shows (M5-13). Plain constants, safe
 * in server and client code. The route sends one of them as `message` with its status and `error`
 * code; a client shows `message` as it came, and falls back to `uploadErrorMessage` when there is no
 * JSON body (a gateway error, a body the platform refused before the route ran).
 */

export const UNSUPPORTED_TYPE_MESSAGE = "That file type isn’t supported. Use JPEG, PNG or WebP.";
export const FILE_TOO_BIG_MESSAGE = "That file is too big. Use an image under 4 MB.";
export const UNREADABLE_IMAGE_MESSAGE = "We couldn’t read that image. Try a different file.";
export const IMAGE_TOO_LARGE_MESSAGE = "That image is too large. Use one under 40 megapixels.";
export const IMAGE_TOO_WIDE_MESSAGE =
  "That image is too large. Use one no more than 8000 pixels on a side.";
export const RATE_LIMITED_MESSAGE = "Too many uploads. Try again in a little while.";
export const SIGNED_OUT_UPLOAD_MESSAGE = "You’re signed out. Sign in again to upload.";
export const UPLOAD_FAILED_MESSAGE = "Couldn’t upload that image. Try again.";

/** The sentence for a failed upload: the route's own `message` when it sent one, else by status. */
export function uploadErrorMessage(status: number, body?: { message?: unknown } | null): string {
  if (body && typeof body.message === "string" && body.message !== "") return body.message;
  if (status === 413) return FILE_TOO_BIG_MESSAGE;
  if (status === 415) return UNSUPPORTED_TYPE_MESSAGE;
  if (status === 422) return UNREADABLE_IMAGE_MESSAGE;
  if (status === 401) return SIGNED_OUT_UPLOAD_MESSAGE;
  if (status === 429) return RATE_LIMITED_MESSAGE;
  return UPLOAD_FAILED_MESSAGE;
}
