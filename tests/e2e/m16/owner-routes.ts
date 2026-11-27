import { expect, type Browser } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { signIn } from "../fixtures/data";
import { appRaw, authCookies, cookieHeader } from "../fixtures/http";
import { DEV_PORT } from "../helpers";

/**
 * The blog specs' changes to a live site, made the way the product makes them: through the real app
 * routes, signed in as the site's owner, so the writer expires the cache tags in the server's own
 * process. A write straight to the database is invisible to a production build until its cache
 * expires by itself (see tests/e2e/fixtures/expire.ts); `next dev` caches nothing, so there both
 * ways show at once. Fixtures written BEFORE a site's first request need none of this.
 */

const APP = `http://app.localhost:${DEV_PORT}`;

export interface OwnerSession {
  cookie: string;
  close(): Promise<void>;
}

/** The owner signed in, in a context of its own (closed by `close`). */
export async function ownerSession(browser: Browser, email: string): Promise<OwnerSession> {
  const context = await browser.newContext();
  await signIn(context, email);
  const cookie = cookieHeader(await authCookies(context));
  return { cookie, close: () => context.close() };
}

async function call(session: OwnerSession, path: string, body?: unknown) {
  const response = await appRaw(path, {
    method: "POST",
    cookie: session.cookie,
    headers: { origin: APP, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.status, `${path}: ${response.body}`).toBe(200);
  return response;
}

async function revOf(entryId: string): Promise<number> {
  const { data, error } = await adminClient()
    .from("content_entries")
    .select("rev")
    .eq("id", entryId)
    .single();
  if (error) throw new Error(error.message);
  return Number(data.rev);
}

/** Publish, unpublish, trash or restore one post through its app route, at its current rev. */
export async function postAction(
  session: OwnerSession,
  siteId: string,
  entryId: string,
  action: "publish" | "unpublish" | "trash" | "restore",
): Promise<void> {
  await call(session, `/api/pages/${siteId}/entries/${entryId}/${action}`, {
    rev: await revOf(entryId),
  });
}

/** A new post, its draft written and published through the route (dated now). */
export async function publishNewPost(
  session: OwnerSession,
  site: { pageId: string },
  typeId: string,
  draft: { title: string; slug: string; body?: string; [key: string]: unknown },
): Promise<string> {
  const made = await adminClient()
    .from("content_entries")
    .insert({
      site_id: site.pageId,
      type_id: typeId,
      draft: { body: `Hello from ${draft.title}.`, ...draft } as never,
    })
    .select("id")
    .single();
  if (made.error) throw new Error(`adding a post failed: ${made.error.message}`);
  await postAction(session, site.pageId, made.data.id as string, "publish");
  return made.data.id as string;
}

/** The post's draft changed (a draft is never on a public path) and published through the route. */
export async function republishPost(
  session: OwnerSession,
  siteId: string,
  entryId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const current = await adminClient()
    .from("content_entries")
    .select("draft")
    .eq("id", entryId)
    .single();
  if (current.error) throw new Error(current.error.message);
  const updated = await adminClient()
    .from("content_entries")
    .update({ draft: { ...(current.data.draft as object), ...patch } as never })
    .eq("id", entryId);
  if (updated.error) throw new Error(updated.error.message);
  await postAction(session, siteId, entryId, "publish");
}

/** Turn the blog on or off through the Pages route (expires the type and the site). */
export async function setBlog(session: OwnerSession, siteId: string, enabled: boolean) {
  await call(session, `/api/pages/${siteId}/types/post`, { enabled });
}

/**
 * Expire the blog's cache the way the app does after a change of the type (the archive path set to
 * what it is): its type tag and the site's. For a fixture written straight to the database once the
 * site has been requested, when the fixture needs a date or shape the routes do not make.
 */
export async function expireBlog(session: OwnerSession, siteId: string, archivePath = "blog") {
  await call(session, `/api/pages/${siteId}/types/post`, { archivePath });
}
