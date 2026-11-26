"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SUSPENDED_REASON, useAccountSuspended } from "@/components/admin/suspension-context";
import { Field, FORM_BUTTON, controlClass } from "@/components/blocks/field";
import type { TypeSummary } from "@/lib/content/schemas/summaries";
import { PAGES_BLOG_TEST_IDS } from "@/lib/blog/test-ids";
import { NAV_MAX_ITEMS, NAV_MESSAGES } from "@/lib/document/nav";
import { fetchTypes, refusalMessage, setPostType } from "@/lib/posts/client";

/**
 * The blog's place in the Pages panel (M16-02): "Add blog" while the site has none, and once it is
 * on a "Blog" row that opens the Posts screen, with the offer to put Blog in the site's menu.
 *
 * It loads its own data from `GET types` (the workspace's layout knows nothing of the blog). "Add
 * blog" turns the built-in Post type on at `/blog`; when a page of the site already uses that
 * address the server says so (HL012) and the row asks for another one. The menu item is the Post
 * type's id, added to Home's draft menu like a page's: it shows on the site after Publish.
 */
export function PagesBlogRow({
  siteId,
  menuItems,
  onAddToMenu,
  onRemoveFromMenu,
  onType,
}: {
  siteId: string;
  /** The ids in the site's draft menu. */
  menuItems: readonly string[];
  /** Appends the Post type's id to the draft menu. */
  onAddToMenu: (typeId: string) => void;
  /** Takes the Post type's id out of the draft menu. */
  onRemoveFromMenu?: (typeId: string) => void;
  /** The Post type as the server last answered it (loaded, or just turned on): the menu's preview draws it. */
  onType?: (type: TypeSummary) => void;
}) {
  const suspended = useAccountSuspended();
  const [type, setType] = useState<TypeSummary | null>(null);
  const [posts, setPosts] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The latest `onType`, so the load below does not run again when the parent redraws.
  const typeSeen = useRef(onType);
  useEffect(() => {
    typeSeen.current = onType;
  }, [onType]);

  useEffect(() => {
    let stale = false;
    void fetchTypes(siteId).then((out) => {
      if (stale) return;
      if (out.kind === "ok") {
        const post = out.types.find((item) => item.key === "post") ?? null;
        setType(post);
        setPosts(out.usage.posts);
        if (post) typeSeen.current?.(post);
      }
      setReady(true);
    });
    return () => {
      stale = true;
    };
  }, [siteId]);

  async function add(event?: FormEvent) {
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
      setType(out.type);
      typeSeen.current?.(out.type);
      setPath(null);
      return;
    }
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

  // Nothing is drawn until the answer is in, so the panel does not jump from "Add blog" to the row.
  if (!ready || type === null) return null;

  if (type.enabled) {
    const inMenu = menuItems.includes(type.typeId);
    const menuFull = menuItems.length >= NAV_MAX_ITEMS;
    return (
      <div data-testid="pages-blog" className="flex min-w-0 flex-col gap-1.5">
        <Link
          href="/posts"
          data-testid={PAGES_BLOG_TEST_IDS.blogRow}
          className="flex min-h-11 w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md border border-line-3 bg-surface px-3 py-1.5 text-left"
        >
          <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere] text-ink">
            {type.labelPlural === "Posts" ? "Blog" : type.labelPlural}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-text-2">
            <span className="font-mono [overflow-wrap:anywhere]">
              /{type.archivePath ?? "blog"}
            </span>
            <span data-testid="pages-blog-count">
              {posts.toLocaleString("en-US")} {posts === 1 ? "post" : "posts"}
            </span>
            <span data-testid="pages-blog-menu-state">{inMenu ? "In menu" : "Not in menu"}</span>
          </span>
        </Link>
        {inMenu ? (
          <button
            type="button"
            data-testid="pages-blog-menu-remove"
            disabled={suspended}
            title={suspended ? SUSPENDED_REASON : undefined}
            onClick={() => onRemoveFromMenu?.(type.typeId)}
            className={`${FORM_BUTTON} self-start`}
          >
            Remove Blog from the menu
          </button>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              data-testid="pages-blog-menu"
              disabled={suspended || menuFull}
              title={suspended ? SUSPENDED_REASON : menuFull ? NAV_MESSAGES.menuFull : undefined}
              onClick={() => onAddToMenu(type.typeId)}
              className={FORM_BUTTON}
            >
              Add Blog to the menu
            </button>
            {menuFull ? <span className="text-xs text-text-2">{NAV_MESSAGES.menuFull}</span> : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={add} data-testid="pages-blog" className="flex min-w-0 flex-col gap-2">
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
                data-field="blog-address"
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
        data-testid={PAGES_BLOG_TEST_IDS.addBlog}
        disabled={suspended || busy}
        title={suspended ? SUSPENDED_REASON : undefined}
        className={`${FORM_BUTTON} self-start`}
      >
        {busy ? "Adding…" : "Add blog"}
      </button>
      {path === null && error ? (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {error}
        </p>
      ) : null}
    </form>
  );
}
