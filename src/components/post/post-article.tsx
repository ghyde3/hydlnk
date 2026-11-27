import type { ReactElement } from "react";
import { readingMinutes } from "@/lib/blog/markdown";
import { BLOG_CLASSES } from "@/lib/blog/test-ids";
import { termHref, type PostView, type TermView } from "@/lib/blog/types";
import { IMAGE_PATH_PATTERN } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { PostBody } from "./post-body";

/**
 * A post as an article: title, date, reading time, featured image, the body and its categories and
 * tags (Wave B, M16-04). The live post page and the share preview draw the same component. No
 * "use client", no hooks. Everything is React text; the only hrefs are `termHref` (both parts
 * checked again) and what `PostBody` vets; the featured image is drawn only from the owner's own
 * folder. Styling is in page-renderer.css and reads `--t-*` only.
 */

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/** "November 20, 2026" (UTC, so the cached page reads the same everywhere), or null for no date. */
export function postDateLabel(
  iso: string | null | undefined,
): { iso: string; label: string } | null {
  if (typeof iso !== "string") return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  return { iso: date.toISOString(), label: DATE.format(date) };
}

/** The image reference when it is a valid upload path in the owner's folder with sane sizes, else null. */
export function ownImage(
  image: { path: string; width: number; height: number } | null | undefined,
  ownerId: string,
): { src: string; width: number; height: number } | null {
  if (!image || typeof image.path !== "string" || ownerId === "") return null;
  if (!IMAGE_PATH_PATTERN.test(image.path) || !image.path.startsWith(`${ownerId}/`)) return null;
  const size = (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20000;
  if (!size(image.width) || !size(image.height)) return null;
  return { src: mediaUrl(image.path), width: image.width, height: image.height };
}

export function PostArticle(props: {
  post: PostView;
  archivePath: string;
  terms: TermView[];
  ownerId: string;
  embeds: "facade" | "inert";
}): ReactElement {
  const { post, archivePath, terms, ownerId } = props;
  const inert = props.embeds !== "facade";
  const date = postDateLabel(post.publishedAt);
  const featured = ownImage(post.featuredImage, ownerId);
  const minutes = readingMinutes(post.body);
  return (
    <article className={`pg-post ${BLOG_CLASSES.post}`}>
      <header className="pg-post-head">
        <h1 className="pg-post-title">{post.title}</h1>
        <p className="pg-post-meta">
          {date ? <time dateTime={date.iso}>{date.label}</time> : null}
          {date ? <span aria-hidden="true"> · </span> : null}
          <span>{`${minutes} min read`}</span>
        </p>
      </header>
      {featured ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="pg-post-featured"
          src={featured.src}
          alt=""
          width={featured.width}
          height={featured.height}
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <PostBody markdown={post.body} ownerId={ownerId} embeds={inert ? "inert" : "facade"} />
      {terms.length > 0 ? (
        <ul className="pg-post-terms" aria-label="Categories and tags">
          {terms.map((term) => {
            // In the private share preview nothing leads out of the draft: terms are plain text.
            const href = inert ? null : termHref(archivePath, term.taxonomy, term.slug);
            return (
              <li key={`${term.taxonomy}:${term.id}`} className="pg-post-termitem">
                {href === null ? (
                  <span className="pg-post-term">{term.name}</span>
                ) : (
                  <a className="pg-post-term" href={href}>
                    {term.name}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
