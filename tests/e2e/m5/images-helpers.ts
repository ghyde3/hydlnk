import type { BrowserContext } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { authCookies, cookieHeader } from "../fixtures/http";
import { multipart, rawBuffer, SERVER_PORT, type RawBufferResponse } from "../m2/publish-helpers";

/**
 * Helpers for the Wave D image specs (M5-11 to M5-14): real images made with sharp (the upload
 * route decodes them), the upload route called the way curl would, and Storage reads with the
 * secret key.
 */

export const BUCKET = "page-media";
export const APP_HOST = `app.localhost:${SERVER_PORT}`;
export const MIB = 1024 * 1024;

/** What an upload response carries. */
export interface Uploaded {
  path: string;
  width: number;
  height: number;
  url: string;
}

export interface UploadOptions {
  kind?: string;
  filename?: string;
  contentType?: string;
  /** Extra form fields (owner, path, folder...). */
  extra?: Record<string, string>;
  origin?: string;
  cookie?: string;
}

/** POST /api/media on the app host. `cookie` is the sb- session cookie header, or none for 401. */
export function uploadMedia(data: Buffer, opts: UploadOptions = {}): Promise<RawBufferResponse> {
  const { body, contentType } = multipart([
    {
      name: "file",
      file: {
        filename: opts.filename ?? "photo.jpg",
        contentType: opts.contentType ?? "image/jpeg",
        data,
      },
    },
    ...(opts.kind === undefined ? [] : [{ name: "kind", value: opts.kind }]),
    ...Object.entries(opts.extra ?? {}).map(([name, value]) => ({ name, value })),
  ]);
  return rawBuffer(APP_HOST, "/api/media", {
    method: "POST",
    cookie: opts.cookie,
    headers: { "content-type": contentType, ...(opts.origin ? { origin: opts.origin } : {}) },
    body,
  });
}

export const sessionCookie = async (context: BrowserContext): Promise<string> =>
  cookieHeader(await authCookies(context));

export function uploaded(res: RawBufferResponse): Uploaded {
  if (res.status !== 200) throw new Error(`upload failed: ${res.status} ${res.text}`);
  return JSON.parse(res.text) as Uploaded;
}

export const errorOf = (res: RawBufferResponse): { error: string; message: string } =>
  JSON.parse(res.text) as { error: string; message: string };

/** The stored object, with the secret key. */
export async function downloadObject(path: string): Promise<Buffer> {
  const { data, error } = await adminClient().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`download ${path} failed: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Names of the objects directly under a user's folder. */
export async function objectNames(userId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from(BUCKET).list(userId, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((item) => item.id !== null).map((item) => item.name);
}

export async function objectExists(path: string): Promise<boolean> {
  // storage-js reports a missing object as `{data: false, error}`.
  const { data } = await adminClient().storage.from(BUCKET).exists(path);
  return data === true;
}

export async function usedBytes(userId: string): Promise<number> {
  const { data, error } = await adminClient().rpc("account_upload_bytes", { p_uid: userId });
  if (error) throw new Error(error.message);
  return Number(data);
}

/** Removes everything under the given users' folders (test cleanup). */
export async function removeFolders(userIds: string[]): Promise<void> {
  const bucket = adminClient().storage.from(BUCKET);
  for (const userId of userIds) {
    const { data } = await bucket.list(userId, { limit: 1000 });
    const names = (data ?? []).map((item) => `${userId}/${item.name}`);
    if (names.length > 0) await bucket.remove(names);
  }
}

export { SERVER_PORT };
export * from "./images-fixtures";
