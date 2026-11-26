import type { ReactElement, ReactNode } from "react";
import type { Token, Tokens } from "marked";
import { EmbedFacadeSlot } from "@/components/page/embed-slot";
import { EmbedPoster } from "@/components/page/embed-poster";
import { BLOG_CLASSES } from "@/lib/blog/test-ids";
import {
  MARKDOWN_MAX_DEPTH,
  bareUrlOf,
  decodeEntities,
  lexMarkdown,
  plainText,
} from "@/lib/blog/markdown";
import { EMBED_PROVIDER_NAMES, parseEmbed, safeHref } from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { mediaPathOf } from "@/lib/themes/bg-image";

/**
 * A post's Markdown body as React elements (Wave B, M16-04). No "use client" and no hooks: used in
 * the tenant route handlers and in the share page.
 *
 * This is the wave's main surface for hostile content, so it trusts nothing about the body, not
 * even that it passed the publish check:
 *   - `marked` only lexes (`lexMarkdown`). Every token type is drawn by a case below as a fixed
 *     element with fixed attributes; raw HTML (`html` tokens) and any token type without a case are
 *     drawn as their source text. There is no `marked.parse` and no `dangerouslySetInnerHTML`, so
 *     the only markup on the page is what this file spells out;
 *   - an anchor's `href` is `safeHref(token.href)`: http and https only. Anything else (a
 *     `javascript:`, `data:` or `mailto:` address, a relative path) draws the link's text alone.
 *     Body links are plain anchors with `rel`, never routed through `/r`;
 *   - an image's `src` is `ownMediaSrc`: the stored address of one of the OWNER's uploads, drawn
 *     from `/media/{uid}/{file}`. Any other address draws the alt text, never a request;
 *   - an embed is a paragraph that is exactly one bare URL `parseEmbed` accepts (the allowlist);
 *     the player address is rebuilt from the parsed id, as in the embed block;
 *   - titles (`[a](b "title")`), code-fence languages and table alignment never become free-form
 *     attributes: titles and languages are dropped, alignment is one of three words.
 */

/**
 * The address a body image is drawn from: `/media/{uid}/{file}` on the media origin when `address`
 * is, character for character, the stored address of an upload in the owner's own folder
 * (`uploadPathOf`), else null.
 */
/**
 * The upload a body image's address stands for, or null: the rule of `uploadPathOf` in
 * `src/lib/content/images.ts` (the publish gate), which this module cannot import, because that one
 * reaches the writer's error copy and the live path imports nothing from the editor side. A unit
 * test keeps the two equal. Only the stored form passes, character for character: what
 * `storageUrl(path)` builds for a `{uid}/{file}.{jpg|png|webp}` path on this project's Storage, and
 * exactly what a URL parser prints for it. With no project URL set, nothing is an upload.
 */
export function bodyUploadPath(address: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || typeof address !== "string") return null;
  let origin: string;
  let printed: string;
  try {
    origin = new URL(base).origin;
    printed = new URL(address).href;
  } catch {
    return null;
  }
  const path = mediaPathOf(address, origin);
  if (path === null) return null;
  return printed === address && address.endsWith(`/${path}`) ? path : null;
}

export function ownMediaSrc(address: string, ownerId: string): string | null {
  if (typeof address !== "string" || typeof ownerId !== "string" || ownerId === "") return null;
  const path = bodyUploadPath(address);
  if (path === null || !path.startsWith(`${ownerId}/`)) return null;
  return mediaUrl(path);
}

interface Ctx {
  ownerId: string;
  embeds: "facade" | "inert";
}

const ALIGN = new Set(["left", "center", "right"]);

function inline(tokens: readonly Token[] | undefined, ctx: Ctx, depth: number): ReactNode[] {
  if (!tokens) return [];
  if (depth > MARKDOWN_MAX_DEPTH) return [tokens.map((token) => token.raw).join("")];
  return tokens.map((token, index) => inlineToken(token, ctx, depth, index));
}

function inlineToken(token: Token, ctx: Ctx, depth: number, key: number): ReactNode {
  switch (token.type) {
    case "text": {
      const nested = (token as Tokens.Text).tokens;
      if (nested && nested.length > 0)
        return <span key={key}>{inline(nested, ctx, depth + 1)}</span>;
      return decodeEntities((token as Tokens.Text).text);
    }
    case "escape":
      return (token as Tokens.Escape).text;
    case "strong":
      return <strong key={key}>{inline((token as Tokens.Strong).tokens, ctx, depth + 1)}</strong>;
    case "em":
      return <em key={key}>{inline((token as Tokens.Em).tokens, ctx, depth + 1)}</em>;
    case "del":
      return <del key={key}>{inline((token as Tokens.Del).tokens, ctx, depth + 1)}</del>;
    case "codespan":
      return <code key={key}>{(token as Tokens.Codespan).text}</code>;
    case "br":
      return <br key={key} />;
    case "link": {
      const link = token as Tokens.Link;
      const children = inline(link.tokens, ctx, depth + 1);
      const href = safeHref(link.href);
      if (href === undefined) return <span key={key}>{children}</span>;
      return (
        <a key={key} href={href} rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    case "image": {
      const image = token as Tokens.Image;
      const alt = plainText(image.tokens).trim() || decodeEntities(image.text);
      const src = ownMediaSrc(image.href, ctx.ownerId);
      if (src === null) return <span key={key}>{alt}</span>;
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={key}
          className="pg-post-img"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      );
    }
    case "checkbox":
      return (token as Tokens.Checkbox).checked ? "☑ " : "☐ ";
    default:
      // Raw HTML and every token type this file does not know: the source, as text.
      return token.raw;
  }
}

function blocks(tokens: readonly Token[], ctx: Ctx, depth: number): ReactNode[] {
  if (depth > MARKDOWN_MAX_DEPTH) return [tokens.map((token) => token.raw).join("")];
  return tokens.map((token, index) => blockToken(token, ctx, depth, index));
}

function embedOf(token: Token, ctx: Ctx, key: number): ReactNode | undefined {
  const url = bareUrlOf(token);
  const embed = url === null ? null : parseEmbed(url);
  if (!embed) return undefined;
  return (
    <div key={key} className="pg-embed" data-embed-provider={embed.provider}>
      {ctx.embeds === "inert" ? (
        <EmbedPoster embed={embed} />
      ) : (
        <EmbedFacadeSlot provider={embed.provider} kind={embed.kind} src={embed.src} caption="" />
      )}
      <p className="pg-embed-caption">{EMBED_PROVIDER_NAMES[embed.provider]}</p>
    </div>
  );
}

function blockToken(token: Token, ctx: Ctx, depth: number, key: number): ReactNode {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "paragraph": {
      // Only a top-level paragraph may be an embed: never one inside a list, a quote or a table.
      const embed = depth === 0 ? embedOf(token, ctx, key) : undefined;
      if (embed !== undefined) return embed;
      return <p key={key}>{inline((token as Tokens.Paragraph).tokens, ctx, depth + 1)}</p>;
    }
    case "text": {
      // A tight list item's text.
      const nested = (token as Tokens.Text).tokens;
      return nested && nested.length > 0
        ? inline(nested, ctx, depth + 1)
        : decodeEntities((token as Tokens.Text).text);
    }
    case "heading": {
      const heading = token as Tokens.Heading;
      // The title is the page's one <h1>: a body heading starts at <h2> and stops at <h4>.
      const level = Math.min(Math.max(Number(heading.depth) || 1, 1) + 1, 4);
      const children = inline(heading.tokens, ctx, depth + 1);
      if (level === 2) return <h2 key={key}>{children}</h2>;
      if (level === 3) return <h3 key={key}>{children}</h3>;
      return <h4 key={key}>{children}</h4>;
    }
    case "code":
      return (
        <pre key={key}>
          <code>{`${(token as Tokens.Code).text}\n`}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote key={key}>
          {blocks((token as Tokens.Blockquote).tokens, ctx, depth + 1)}
        </blockquote>
      );
    case "hr":
      return <hr key={key} />;
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li key={index}>{blocks(item.tokens, ctx, depth + 1)}</li>
      ));
      if (!list.ordered) return <ul key={key}>{items}</ul>;
      const start = Number(list.start);
      return Number.isInteger(start) && start !== 1 && start >= 0 && start < 1e9 ? (
        <ol key={key} start={start}>
          {items}
        </ol>
      ) : (
        <ol key={key}>{items}</ol>
      );
    }
    case "checkbox":
      return (token as Tokens.Checkbox).checked ? "☑ " : "☐ ";
    case "table": {
      const table = token as Tokens.Table;
      const align = (cell: Tokens.TableCell) =>
        typeof cell.align === "string" && ALIGN.has(cell.align) && cell.align !== "left"
          ? { "data-align": cell.align }
          : {};
      return (
        <div key={key} className="pg-post-table hl-post-table">
          <table>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th key={index} {...align(cell)}>
                    {inline(cell.tokens, ctx, depth + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} {...align(cell)}>
                      {inline(cell.tokens, ctx, depth + 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "html":
      // Raw HTML is shown as what was typed, never parsed.
      return <p key={key}>{token.raw.trim()}</p>;
    default:
      return <p key={key}>{token.raw}</p>;
  }
}

export function PostBody(props: {
  markdown: string;
  ownerId: string;
  embeds: "facade" | "inert";
}): ReactElement {
  const ctx: Ctx = {
    ownerId: props.ownerId,
    embeds: props.embeds === "facade" ? "facade" : "inert",
  };
  return (
    <div className={`pg-post-body ${BLOG_CLASSES.postBody}`}>
      {blocks(lexMarkdown(props.markdown), ctx, 0)}
    </div>
  );
}
