"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { Field, FORM_BUTTON, FORM_BUTTON_DANGER, controlClass } from "@/components/blocks/field";
import type { EntrySummary, TermSummary, TypeSummary } from "@/lib/content";
import { POSTS_TEST_IDS } from "@/lib/blog/test-ids";
import { postLimitMessage } from "@/lib/limits/messages";
import { buildPostsMeter } from "@/lib/limits/meters";
import type { PlanId } from "@/lib/limits/table";
import {
  createPost,
  fetchPosts,
  fetchTypes,
  refusalMessage,
  setPostType,
} from "@/lib/posts/client";
import { NO_FILTERS, PostsFilters, type PostsFilterValue } from "./posts-filters";
import { PostsList } from "./posts-list";

/**
 * The Posts screen (M16-12, M16-02): the current site's posts with their state and date, filters, a
 * title search and "New post"; the plan's posts in the header; and the blog's own settings (its
 * address, and turning it off). While the blog is off the screen offers to turn it on.
 *
 * The first page comes from the server with the page; filters ask `GET posts` again. Nothing here
 * decides a limit: at the plan's posts the button gives way to the plan's sentence and the upgrade
 * link, and the server refuses the insert (HL010) whatever is sent.
 */

const PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50";
const CARD = "flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3.5 hl:p-5";

export interface PostsScreenProps {
  siteId: string;
  plan: PlanId;
  /** The site's Post type, or null when it could not be read. */
  type: TypeSummary | null;
  /** Posts the site holds, the trash included. */
  used: number;
  items: EntrySummary[];
  nextCursor: string | null;
  terms: TermSummary[];
}

export function PostsScreen(props: PostsScreenProps) {
  const [type, setType] = useState(props.type);
  if (!type?.enabled) {
    return <BlogOff siteId={props.siteId} onEnabled={setType} />;
  }
  return <BlogOn {...props} type={type} onType={setType} />;
}

/** The blog is off: one card that turns it on (and asks for another address when `/blog` is taken). */
export function BlogOff({
  siteId,
  onEnabled,
}: {
  siteId: string;
  onEnabled: (type: TypeSummary) => void;
}) {
  const suspended = useAccountSuspended();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enable(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await setPostType(siteId, {
      enabled: true,
      ...(path === null ? {} : { archivePath: path.trim() }),
    });
    setBusy(false);
    if (out.kind === "ok") {
      onEnabled(out.type);
      router.refresh();
      return;
    }
    // The address is used by a page or reserved: ask for another one.
    if (out.kind === "path" || (out.kind === "invalid" && path !== null)) {
      setPath((current) => current ?? "blog");
      setError(
        out.kind === "path"
          ? "That address is already used by a page of this site, or reserved. Choose another."
          : refusalMessage(out),
      );
      return;
    }
    setError(refusalMessage(out));
  }

  return (
    <section data-testid={POSTS_TEST_IDS.screen} data-blog="off" className={CARD}>
      <h2 className="m-0 text-sm font-semibold">Add a blog to this site</h2>
      <p className="m-0 text-sm text-text-2">
        Write posts with categories and tags. They appear at /blog on your site, in your theme, each
        on its own page.
      </p>
      <form onSubmit={enable} className="flex min-w-0 flex-col gap-3">
        {path !== null ? (
          <Field label="Blog address" error={error} hint="Lower-case letters, numbers and hyphens.">
            {(control) => (
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="font-mono text-base text-text-2">
                  /
                </span>
                <input
                  {...control}
                  type="text"
                  data-testid="blog-address"
                  value={path}
                  maxLength={40}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => setPath(event.target.value.replace(/^\/+/, ""))}
                  className={controlClass(error !== null, "font-mono")}
                />
              </div>
            )}
          </Field>
        ) : null}
        <button
          type="submit"
          data-testid="posts-add-blog"
          disabled={suspended || busy}
          title={suspended ? SUSPENDED_REASON : undefined}
          className={`${PRIMARY} self-start`}
        >
          {busy ? "Adding…" : "Add blog"}
        </button>
        {path === null && error ? (
          <p role="alert" className="m-0 text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function BlogOn({
  siteId,
  plan,
  type,
  onType,
  used: firstUsed,
  items: firstItems,
  nextCursor: firstCursor,
  terms,
}: PostsScreenProps & { type: TypeSummary; onType: (type: TypeSummary) => void }) {
  const suspended = useAccountSuspended();
  const router = useRouter();
  const [used, setUsed] = useState(firstUsed);
  const [items, setItems] = useState(firstItems);
  const [cursor, setCursor] = useState(firstCursor);
  const [filters, setFilters] = useState<PostsFilterValue>(NO_FILTERS);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  /** Only the newest request's answer is shown. */
  const request = useRef(0);
  const meter = buildPostsMeter(plan, used);
  const atLimit = meter.atLimit || limitMessage !== null;

  async function load(next: PostsFilterValue, after: string | null) {
    const mine = ++request.current;
    setLoading(true);
    setError(null);
    const out = await fetchPosts(siteId, {
      status: next.status,
      term: next.term,
      q: next.q.trim(),
      sort: next.sort,
      ...(after ? { cursor: after } : {}),
    });
    if (mine !== request.current) return;
    setLoading(false);
    if (out.kind !== "ok") {
      setError(refusalMessage(out));
      return;
    }
    setItems((current) => (after ? [...current, ...out.items] : out.items));
    setCursor(out.nextCursor);
  }

  // A filter asks at once; typing in the search waits for a pause.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  function changeFilters(next: PostsFilterValue) {
    const typed = next.q !== filters.q;
    setFilters(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(next, null), typed ? 350 : 0);
  }

  async function newPost() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const out = await createPost(siteId);
    if (out.kind === "ok") {
      router.push(`/posts/${out.id}`);
      return;
    }
    setCreating(false);
    if (out.kind === "limit") {
      setLimitMessage(out.message);
      const fresh = await fetchTypes(siteId);
      if (fresh.kind === "ok") setUsed(fresh.usage.posts);
      return;
    }
    setError(refusalMessage(out));
  }

  const filtered = filters.status !== "" || filters.term !== "" || filters.q.trim() !== "";

  return (
    <div data-testid={POSTS_TEST_IDS.screen} data-blog="on" className="flex min-w-0 flex-col gap-3">
      <section className={CARD}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="m-0 text-sm font-semibold">Posts</h2>
            <span data-testid="posts-usage" className="font-mono text-xs text-text-2">
              {meter.text}
            </span>
          </div>
          {atLimit ? null : (
            <button
              type="button"
              data-testid={POSTS_TEST_IDS.newPost}
              disabled={suspended || creating}
              title={suspended ? SUSPENDED_REASON : undefined}
              onClick={() => void newPost()}
              className={PRIMARY}
            >
              {creating ? "Creating…" : "New post"}
            </button>
          )}
        </div>
        {atLimit ? (
          <p
            role="status"
            data-testid={POSTS_TEST_IDS.limit}
            className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2"
          >
            <span className="min-w-0">{limitMessage ?? postLimitMessage(plan, used)}</span>
            {plan === "studio" ? null : (
              <Link
                href="/settings#plans"
                className="inline-flex min-h-11 items-center font-semibold text-ink underline"
              >
                Upgrade
              </Link>
            )}
          </p>
        ) : null}
        <PostsFilters
          value={filters}
          onChange={changeFilters}
          categories={terms.filter((term) => term.taxonomy === "category")}
        />
        {error ? (
          <p role="alert" data-testid="posts-error" className="m-0 text-[13px] text-bad">
            {error}
          </p>
        ) : null}
        <PostsList
          items={items}
          loading={loading}
          hasMore={cursor !== null}
          onMore={() => void load(filters, cursor)}
          filtered={filtered}
        />
        <p className="m-0 text-xs text-text-2">
          Trashed posts count toward your posts until they are deleted, 30 days after they are
          trashed.
        </p>
      </section>
      <BlogSettings siteId={siteId} type={type} onType={onType} />
    </div>
  );
}

/** The blog's address and its off switch (M16-02). Turning it off deletes nothing. */
function BlogSettings({
  siteId,
  type,
  onType,
}: {
  siteId: string;
  type: TypeSummary;
  onType: (type: TypeSummary) => void;
}) {
  const suspended = useAccountSuspended();
  const router = useRouter();
  const current = type.archivePath ?? "blog";
  const [path, setPath] = useState(current);
  const [busy, setBusy] = useState<"path" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function savePath(event: FormEvent) {
    event.preventDefault();
    if (busy || path.trim() === current) return;
    setBusy("path");
    setError(null);
    setSaved(false);
    const out = await setPostType(siteId, { archivePath: path.trim() });
    setBusy(null);
    if (out.kind === "ok") {
      onType(out.type);
      setPath(out.type.archivePath ?? path);
      setSaved(true);
      return;
    }
    setError(
      out.kind === "path"
        ? "That address is already used by a page of this site, or reserved. Choose another."
        : refusalMessage(out),
    );
  }

  async function turnOff() {
    if (busy) return;
    setBusy("off");
    setError(null);
    const out = await setPostType(siteId, { enabled: false });
    setBusy(null);
    if (out.kind === "ok") {
      onType(out.type);
      router.refresh();
      return;
    }
    setError(refusalMessage(out));
  }

  return (
    <section data-testid="blog-settings" className={CARD}>
      <h2 className="m-0 text-sm font-semibold">Blog settings</h2>
      <form onSubmit={savePath} className="flex min-w-0 flex-wrap items-end gap-2">
        <Field
          label="Blog address"
          error={error}
          hint="Where the list of posts lives. Every post’s address starts with it."
          className="min-w-0 flex-1 basis-56"
        >
          {(control) => (
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="font-mono text-base text-text-2">
                /
              </span>
              <input
                {...control}
                type="text"
                data-testid="blog-address"
                value={path}
                maxLength={40}
                disabled={suspended}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => {
                  setPath(event.target.value.replace(/^\/+/, ""));
                  setSaved(false);
                }}
                className={controlClass(error !== null, "font-mono")}
              />
            </div>
          )}
        </Field>
        <button
          type="submit"
          data-testid="blog-address-save"
          disabled={suspended || busy !== null || path.trim() === current || path.trim() === ""}
          className={FORM_BUTTON}
        >
          {busy === "path" ? "Saving…" : "Save address"}
        </button>
      </form>
      <p aria-live="polite" className="m-0 text-xs text-text-2 empty:hidden">
        {saved ? "Saved. The old address stops working on the next visit." : null}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {confirming ? (
          <>
            <button
              type="button"
              data-testid="blog-off-confirm"
              disabled={suspended || busy !== null}
              onClick={() => void turnOff()}
              className={FORM_BUTTON_DANGER}
            >
              {busy === "off" ? "Turning off…" : "Turn off the blog"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={FORM_BUTTON}>
              Keep it on
            </button>
            <span className="min-w-0 basis-full text-xs text-text-2">
              The blog and every post leave your site on the next visit. Nothing is deleted: turn it
              on again and they come back.
            </span>
          </>
        ) : (
          <button
            type="button"
            data-testid="blog-off"
            disabled={suspended}
            onClick={() => setConfirming(true)}
            className={FORM_BUTTON}
          >
            Turn off the blog
          </button>
        )}
      </div>
    </section>
  );
}
