"use client";

import { useEffect, useState } from "react";
import type { LatestPosts, PostCard } from "@/lib/blog/types";

/**
 * What a latest-posts block draws in the editor's preview, and the categories its picker offers
 * (M16-07): one read of `GET /api/pages/{site}/posts/latest` per mounted editor, published posts
 * only (the route calls the live page's own reads). `latest` is null while the blog is off or the
 * answer has not come; the block then shows its hint. Nothing here throws.
 */

export interface LatestPostsData {
  state: "loading" | "ready" | "error";
  latest: LatestPosts | null;
  categories: { id: string; name: string }[];
}

const EMPTY: LatestPostsData = { state: "loading", latest: null, categories: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function cardOf(value: unknown): PostCard | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.slug !== "string")
    return null;
  const image = isRecord(value.featuredImage) ? value.featuredImage : null;
  return {
    id: value.id,
    slug: value.slug,
    title: text(value.title),
    excerpt: text(value.excerpt),
    publishedAt: text(value.publishedAt),
    featuredImage:
      image &&
      typeof image.path === "string" &&
      typeof image.width === "number" &&
      typeof image.height === "number"
        ? { path: image.path, width: image.width, height: image.height }
        : null,
    categoryIds: Array.isArray(value.categoryIds)
      ? value.categoryIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

/** The route's answer as data; anything unexpected reads as "no posts". */
export function parseLatestPosts(body: unknown): Omit<LatestPostsData, "state"> {
  if (!isRecord(body) || body.kind !== "ok") return { latest: null, categories: [] };
  const raw = isRecord(body.latest) ? body.latest : null;
  const latest: LatestPosts | null =
    raw && typeof raw.archivePath === "string" && Array.isArray(raw.posts)
      ? {
          archivePath: raw.archivePath,
          posts: raw.posts.flatMap((post) => cardOf(post) ?? []),
        }
      : null;
  const categories = Array.isArray(body.categories)
    ? body.categories.flatMap((entry) =>
        isRecord(entry) && typeof entry.id === "string"
          ? [{ id: entry.id, name: text(entry.name) }]
          : [],
      )
    : [];
  return { latest, categories };
}

export function useLatestPosts(siteId: string | null | undefined): LatestPostsData {
  const [data, setData] = useState<LatestPostsData>(EMPTY);
  useEffect(() => {
    if (!siteId) return;
    let live = true;
    fetch(`/api/pages/${encodeURIComponent(siteId)}/posts/latest`, {
      headers: { accept: "application/json" },
    })
      .then(async (response) => (response.ok ? ((await response.json()) as unknown) : null))
      .then((body) => {
        if (live) setData({ state: body === null ? "error" : "ready", ...parseLatestPosts(body) });
      })
      .catch(() => {
        if (live) setData({ state: "error", latest: null, categories: [] });
      });
    return () => {
      live = false;
    };
  }, [siteId]);
  return data;
}
