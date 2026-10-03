import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import {
  SOCIAL_PLATFORM_LABELS,
  parseEmbed,
  type Block,
  type CardBlock,
  type EmbedBlock,
  type GridBlock,
  type HeaderBlock,
  type ImageBlock,
  type LinkBlock,
  type SocialBlock,
  type TextBlock,
} from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import {
  BLOCK_OVERRIDE_KEYS,
  resolveBlockTokens,
  tokenCssVarName,
  tokensToCssVars,
  type BlockOverrides,
  type TokenSet,
} from "@/lib/theme";
import { YouTubeFacade } from "./embed-facade";
import { mailtoLink, outboundHref, type OutboundAttrs } from "./outbound";
import { SocialGlyph } from "./social-icons";

/**
 * The block renderers. Nothing outside `src/components/page/` outputs block markup: the editor's
 * preview and the public page both reach these through `PageRenderer`.
 *
 * Rules every renderer follows (tenant content is untrusted):
 *   - text is React text, so it is escaped; there is no raw HTML anywhere;
 *   - every href comes from `outboundHref` / `mailtoLink`, every embed `src` from `parseEmbed`,
 *     every image URL from `mediaUrl(path)` of a validated image reference;
 *   - styling reads `--t-*` variables only; a block's own overrides are applied as inline `--t-*`
 *     variables on the block, so everything inside it follows.
 */

export interface BlockContext {
  pageId: string;
  /** The page's resolved tokens, the starting point for a block's overrides. */
  tokens: TokenSet;
  /**
   * Where the page is mounted. The markup of a complete page is the same in both modes; the mode
   * only decides what an incomplete block (a draft's empty image or an unusable embed) shows:
   * a dashed placeholder in the editor preview, nothing on the live page.
   */
  mode: "live" | "preview";
  /**
   * A small decorative copy of the page (the editor's phone dock, M6-01). Nothing in it is
   * interactive and nothing in it loads from a third party: an embed is drawn as a still poster
   * instead of a Play button (a button inside the dock's button would not be valid markup) or an
   * iframe. Everything else is the same markup as a normal preview.
   */
  thumbnail?: boolean;
}

/**
 * The element behind every outbound link: an anchor. In a thumbnail (the editor's dock) it is a
 * plain box with the same classes and no href, rel or label: a small copy of the page must not
 * hold dozens of tiny links, and nothing in it can be activated anyway.
 */
function LinkBox({
  thumbnail,
  link,
  ...props
}: ComponentPropsWithoutRef<"a"> & { thumbnail?: boolean; link: OutboundAttrs }) {
  if (thumbnail) {
    const rest: ComponentPropsWithoutRef<"a"> = { ...props };
    delete rest["aria-label"];
    return <div {...(rest as ComponentPropsWithoutRef<"div">)} />;
  }
  return <a {...props} {...link} />;
}

/** The block's resolved tokens, and inline variables for just the keys it overrides. */
function blockTokens(
  tokens: TokenSet,
  overrides: BlockOverrides | undefined,
): { resolved: TokenSet; style: CSSProperties | undefined } {
  const resolved = resolveBlockTokens(tokens, overrides);
  if (!overrides) return { resolved, style: undefined };
  const all = tokensToCssVars(resolved);
  const vars: Record<string, string> = {};
  for (const key of BLOCK_OVERRIDE_KEYS) {
    if (overrides[key] === undefined) continue;
    const name = tokenCssVarName(key);
    const value = all[name];
    if (value !== undefined) vars[name] = value;
  }
  return { resolved, style: Object.keys(vars).length > 0 ? (vars as CSSProperties) : undefined };
}

function LinkView({ block, ctx }: { block: LinkBlock; ctx: BlockContext }) {
  const { resolved, style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <LinkBox
      className="pg-link"
      data-block-id={block.id}
      data-block-type="link"
      data-button-style={resolved.buttonStyle}
      style={style}
      thumbnail={ctx.thumbnail}
      link={outboundHref(block.url, { pageId: ctx.pageId, id: block.id })}
    >
      {block.label}
    </LinkBox>
  );
}

function CardView({ block, ctx }: { block: CardBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const image = block.image;
  return (
    <LinkBox
      className="pg-card"
      data-block-id={block.id}
      data-block-type="card"
      style={style}
      thumbnail={ctx.thumbnail}
      link={outboundHref(block.url, { pageId: ctx.pageId, id: block.id })}
    >
      <span className="pg-card-banner" data-has-image={image ? "true" : undefined}>
        {image ? (
          // A plain <img>: `path` is a validated reference into the page-media bucket, so
          // next/image would add nothing but a remotePatterns list. The title is the link text,
          // so the picture itself has an empty alt.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="pg-card-image"
            src={mediaUrl(image.path)}
            alt=""
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="pg-card-title">{block.title}</span>
      </span>
      <span className="pg-card-foot">
        <span className="pg-card-caption">{block.caption === "" ? "View" : block.caption}</span>
        <span className="pg-card-arrow" aria-hidden="true">
          →
        </span>
      </span>
    </LinkBox>
  );
}

function HeaderView({ block }: { block: HeaderBlock }) {
  return (
    <h2 className="pg-header" data-block-id={block.id} data-block-type="header">
      {block.text}
    </h2>
  );
}

function TextView({ block }: { block: TextBlock }) {
  // `white-space: pre-line` keeps the author's line breaks; the text is never parsed or linked.
  return (
    <p className="pg-text" data-block-id={block.id} data-block-type="text">
      {block.text}
    </p>
  );
}

function DividerView({ block }: { block: Block }) {
  return <hr className="pg-divider" data-block-id={block.id} data-block-type="divider" />;
}

function ImageView({ block, ctx }: { block: ImageBlock; ctx: BlockContext }) {
  const image = block.image;
  if (!image) {
    if (ctx.mode === "live") return null;
    return (
      <div className="pg-placeholder" data-block-id={block.id} data-block-type="image">
        Image
      </div>
    );
  }
  const link = block.url?.trim() ?? "";

  const picture = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="pg-image-img"
      src={mediaUrl(image.path)}
      alt={block.alt}
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
  return (
    <div className="pg-image" data-block-id={block.id} data-block-type="image">
      {link === "" ? (
        picture
      ) : (
        <LinkBox
          className="pg-image-link"
          thumbnail={ctx.thumbnail}
          link={outboundHref(link, { pageId: ctx.pageId, id: block.id })}
        >
          {picture}
        </LinkBox>
      )}
    </div>
  );
}

function SocialView({ block, ctx }: { block: SocialBlock; ctx: BlockContext }) {
  return (
    <nav
      className="pg-social"
      aria-label="Social"
      data-block-id={block.id}
      data-block-type="social"
    >
      {block.icons.map((icon) => (
        <LinkBox
          key={icon.id}
          className="pg-social-link"
          aria-label={SOCIAL_PLATFORM_LABELS[icon.platform]}
          data-item-id={icon.id}
          thumbnail={ctx.thumbnail}
          link={
            icon.platform === "email"
              ? mailtoLink(icon.address)
              : outboundHref(icon.url, { pageId: ctx.pageId, id: icon.id })
          }
        >
          <SocialGlyph platform={icon.platform} />
        </LinkBox>
      ))}
    </nav>
  );
}

/** Spotify embeds are 152px tall for a single track or episode, 352px for the rest. */
function spotifyHeight(kind: string): number {
  return kind === "track" || kind === "episode" ? 152 : 352;
}

function EmbedView({ block, ctx }: { block: EmbedBlock; ctx: BlockContext }) {
  const embed = parseEmbed(block.url);
  if (!embed) {
    if (ctx.mode === "live") return null;
    return (
      <div className="pg-placeholder" data-block-id={block.id} data-block-type="embed">
        Embed
      </div>
    );
  }
  const provider = embed.provider === "youtube" ? "YouTube" : "Spotify";
  return (
    <div
      className="pg-embed"
      data-block-id={block.id}
      data-block-type="embed"
      data-embed-provider={embed.provider}
    >
      {ctx.thumbnail ? (
        embed.provider === "youtube" ? (
          <div className="pg-embed-play" aria-hidden="true">
            <span className="pg-embed-play-disc">
              <svg className="pg-embed-play-glyph" viewBox="0 0 24 24" focusable="false">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          </div>
        ) : (
          <div
            className="pg-embed-spotify"
            aria-hidden="true"
            style={{ height: spotifyHeight(embed.kind) }}
          />
        )
      ) : embed.provider === "youtube" ? (
        <YouTubeFacade src={embed.src} caption={block.caption} />
      ) : (
        <iframe
          className="pg-embed-spotify"
          src={embed.src}
          title={block.caption === "" ? "Spotify player" : `${block.caption} (Spotify player)`}
          width="100%"
          height={spotifyHeight(embed.kind)}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      <p className="pg-embed-caption">
        {block.caption === "" ? provider : `${block.caption} · ${provider}`}
      </p>
    </div>
  );
}

function GridView({ block, ctx }: { block: GridBlock; ctx: BlockContext }) {
  return (
    <div className="pg-grid" data-block-id={block.id} data-block-type="grid">
      {block.cells.map((cell) => (
        <LinkBox
          key={cell.id}
          className="pg-cell"
          data-item-id={cell.id}
          thumbnail={ctx.thumbnail}
          link={outboundHref(cell.url, { pageId: ctx.pageId, id: cell.id })}
        >
          <span className="pg-cell-title">{cell.title}</span>
          {cell.subtitle === "" ? null : <span className="pg-cell-subtitle">{cell.subtitle}</span>}
        </LinkBox>
      ))}
    </div>
  );
}

/**
 * One block. Hidden blocks render nothing (Publish already strips them; this is defense in depth),
 * and so does a `type` this version does not know, without throwing.
 */
export function BlockView({ block, ctx }: { block: Block; ctx: BlockContext }) {
  if (block.visible === false) return null;
  switch (block.type) {
    case "link":
      return <LinkView block={block} ctx={ctx} />;
    case "card":
      return <CardView block={block} ctx={ctx} />;
    case "header":
      return <HeaderView block={block} />;
    case "text":
      return <TextView block={block} />;
    case "image":
      return <ImageView block={block} ctx={ctx} />;
    case "social":
      return <SocialView block={block} ctx={ctx} />;
    case "embed":
      return <EmbedView block={block} ctx={ctx} />;
    case "grid":
      return <GridView block={block} ctx={ctx} />;
    case "divider":
      return <DividerView block={block} />;
    default:
      return null;
  }
}
