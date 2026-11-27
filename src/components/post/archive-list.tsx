import type { ReactElement } from "react";
import { BLOG_CLASSES } from "@/lib/blog/test-ids";
import { archiveHref, postHref, termHref, type PostCard } from "@/lib/blog/types";
import { ownImage, postDateLabel } from "./post-article";

/**
 * The list of an archive page (Wave B, M16-05): the blog itself, one of its pages, a category or a
 * tag. One card per post, the whole card one link, then the pager. No "use client", no hooks. Text
 * is React text; hrefs come from the vetted builders of `@/lib/blog/types`; a card's picture is
 * drawn only from the owner's own folder.
 */

export interface ArchiveListProps {
  archivePath: string;
  posts: readonly PostCard[];
  /** This page's number (from 1) and how many pages there are. */
  page: number;
  pages: number;
  /** The term whose posts these are, on a category or tag page. */
  term?: { taxonomy: "category" | "tag"; slug: string } | undefined;
  /** A line above the list ("Category · Posts" on a term page). */
  kicker?: string | undefined;
  ownerId: string;
}

function pageHref(props: ArchiveListProps, page: number): string | null {
  return props.term
    ? termHref(props.archivePath, props.term.taxonomy, props.term.slug, page)
    : archiveHref(props.archivePath, page);
}

export function ArchiveList(props: ArchiveListProps): ReactElement {
  const { posts, page, pages } = props;
  const newer = page > 1 ? pageHref(props, page - 1) : null;
  const older = page < pages ? pageHref(props, page + 1) : null;
  return (
    <div className={`pg-archive ${BLOG_CLASSES.archive}`}>
      {props.kicker ? <p className="pg-archive-kicker">{props.kicker}</p> : null}
      {posts.length === 0 ? (
        <p className="pg-archive-empty">No posts yet</p>
      ) : (
        <ul className="pg-archive-list">
          {posts.map((post, index) => {
            const href = postHref(props.archivePath, post.slug);
            if (href === null) return null;
            const date = postDateLabel(post.publishedAt);
            const image = ownImage(post.featuredImage, props.ownerId);
            return (
              <li key={post.id} className={`pg-archive-card ${BLOG_CLASSES.archiveCard}`}>
                <a className="pg-archive-link" href={href}>
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="pg-archive-img"
                      src={image.src}
                      alt=""
                      width={image.width}
                      height={image.height}
                      {...(index === 0 ? {} : { loading: "lazy" as const })}
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                  <h2 className="pg-archive-title">{post.title}</h2>
                  {date ? (
                    <time className="pg-archive-date" dateTime={date.iso}>
                      {date.label}
                    </time>
                  ) : null}
                  {post.excerpt === "" ? null : (
                    <p className="pg-archive-excerpt">{post.excerpt}</p>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 ? (
        <nav className="pg-archive-pager" aria-label="Pages">
          {newer ? (
            <a className="pg-archive-page" rel="prev" href={newer}>
              Newer posts
            </a>
          ) : (
            <span />
          )}
          <span className="pg-archive-count">{`Page ${page} of ${pages}`}</span>
          {older ? (
            <a className="pg-archive-page" rel="next" href={older}>
              Older posts
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
