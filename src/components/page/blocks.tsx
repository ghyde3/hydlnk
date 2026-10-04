import { Fragment, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import {
  EMBED_PROVIDER_NAMES,
  SOCIAL_PLATFORM_LABELS,
  isLinkFeatured,
  parseEmbed,
  textSegments,
  type Block,
  type CardBlock,
  type DividerBlock,
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
  validBlockOverrides,
  type BlockOverrides,
  type TokenSet,
} from "@/lib/theme";
import { EmbedFacade } from "./embed-facade";
import { EmbedPoster } from "./embed-poster";
import { ImagePicture, focusStyle } from "./image-frame";
import { LinkGlyph, LinkThumb, resolveLinkIcon } from "./link-icon";
import { mailtoLink, outboundHref, type OutboundAttrs } from "./outbound";
import { SocialGlyph } from "./social-icons";

/**
 * The block renderers. Nothing outside `src/components/page/` outputs block markup: the editor's
 * preview and the public page both reach these through `PageRenderer`.
 *
 * Rules every renderer follows (tenant content is untrusted):
 *   - text is React text, so it is escaped; there is no raw HTML anywhere;
 *   - every href comes from `outboundHref` / `mailtoLink`, every embed `src` from `parseEmbed`,
 *     every image address from `mediaUrl(path)` (this host's `/media/...`) of a validated image reference;
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
  /**
   * Embeds are drawn as still posters, never as a player: no Play button, no iframe, so nothing is
   * requested from YouTube or Spotify and nothing can start (the shared preview, M6-10: a stranger
   * who opens a draft link has not asked for a request to a third party). Links, cards and everything
   * else stay as they are; only `EmbedView` reads this.
   */
  inertEmbeds?: boolean;
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

/**
 * The block's resolved tokens, and inline variables for just the keys it overrides (M3-18, M6-45).
 * Every block type calls this with its own `overrides` and puts `style` on its own element, so the
 * variables reach only that block's children: never a sibling, another block of the same type or the
 * page root. Only a value that passes its token's schema is drawn (`validBlockOverrides`); a bad one
 * is left out and that block follows the page. With no usable override, `style` is `undefined` and
 * the block's markup is what it was before overrides existed.
 */
function blockTokens(
  tokens: TokenSet,
  overrides: BlockOverrides | undefined,
): {
  resolved: TokenSet;
  style: CSSProperties | undefined;
  /** The overrides that were drawn: the validated subset of the block's own. */
  own: BlockOverrides | undefined;
} {
  const own = validBlockOverrides(overrides);
  const resolved = resolveBlockTokens(tokens, own);
  if (!own) return { resolved, style: undefined, own };
  const all = tokensToCssVars(resolved);
  const vars: Record<string, string> = {};
  for (const key of BLOCK_OVERRIDE_KEYS) {
    if (own[key] === undefined) continue;
    const name = tokenCssVarName(key);
    const value = all[name];
    if (value !== undefined) vars[name] = value;
  }
  return {
    resolved,
    style: Object.keys(vars).length > 0 ? (vars as CSSProperties) : undefined,
    own,
  };
}

function LinkView({ block, ctx }: { block: LinkBlock; ctx: BlockContext }) {
  const { resolved, style } = blockTokens(ctx.tokens, block.overrides);
  // M6-20: a decorative first child (a glyph or a thumbnail) before the label. Without an icon the
  // anchor holds the bare label, as it always did. M6-22: `data-featured` comes from a lookup of
  // the three allowed words, so any other stored value renders no attribute.
  const icon = resolveLinkIcon(block.icon);
  return (
    <LinkBox
      className="pg-link"
      data-block-id={block.id}
      data-block-type="link"
      data-button-style={resolved.buttonStyle}
      data-icon={icon?.kind}
      data-featured={isLinkFeatured(block.featured) ? block.featured : undefined}
      style={style}
      thumbnail={ctx.thumbnail}
      link={outboundHref(block.url, { pageId: ctx.pageId, id: block.id })}
    >
      {icon === null ? (
        block.label
      ) : (
        <>
          {icon.kind === "builtin" ? (
            <LinkGlyph name={icon.name} />
          ) : (
            <LinkThumb image={icon.image} />
          )}
          <span className="pg-link-label">{block.label}</span>
        </>
      )}
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
            style={focusStyle(image)}
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

function HeaderView({ block, ctx }: { block: HeaderBlock; ctx: BlockContext }) {
  // `text` is the heading's color: the stylesheet gives `.pg-header` an explicit color from it.
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <h2 className="pg-header" data-block-id={block.id} data-block-type="header" style={style}>
      {block.text}
    </h2>
  );
}

/** One piece of formatted text: italic inside bold, so overlapping ranges nest as `<strong><em>`. */
function formatted(segment: { text: string; bold: boolean; italic: boolean }): ReactNode {
  let node: ReactNode = segment.text;
  if (segment.italic) node = <em>{node}</em>;
  if (segment.bold) node = <strong>{node}</strong>;
  return node;
}

/**
 * A text block (M2-16, M6-28). The text itself is never parsed: `white-space: pre-line` keeps the
 * author's line breaks, and bold, italic and links come only from the block's structured `marks`.
 * Every piece of text is a React text node (escaped); a link's `href` and `rel` come from
 * `outboundHref`, so it points at the click redirect and never carries its destination. A link
 * without a usable address (a draft) and every link in a thumbnail render as plain or inert text.
 */
function TextView({ block, ctx }: { block: TextBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const segments = textSegments(block.text, block.marks);
  const plain =
    segments.length === 1 && !segments[0]!.link && !segments[0]!.bold && !segments[0]!.italic;
  const children: ReactNode[] = [];
  for (let i = 0; i < segments.length && !plain;) {
    const link = segments[i]!.link;
    if (!link) {
      children.push(<Fragment key={i}>{formatted(segments[i]!)}</Fragment>);
      i += 1;
      continue;
    }
    const group: ReactNode[] = [];
    const first = i;
    for (; i < segments.length && segments[i]!.link?.id === link.id; i++) {
      group.push(<Fragment key={i}>{formatted(segments[i]!)}</Fragment>);
    }
    const attrs = outboundHref(link.url, { pageId: ctx.pageId, id: link.id });
    if (ctx.thumbnail) {
      children.push(
        <span key={first} className="pg-text-link">
          {group}
        </span>,
      );
    } else if (!attrs.href) {
      children.push(<Fragment key={first}>{group}</Fragment>);
    } else {
      children.push(
        <a key={first} className="pg-text-link" {...attrs}>
          {group}
        </a>,
      );
    }
  }
  return (
    <p className="pg-text" data-block-id={block.id} data-block-type="text" style={style}>
      {plain ? block.text : children}
    </p>
  );
}

function DividerView({ block, ctx }: { block: DividerBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <hr className="pg-divider" data-block-id={block.id} data-block-type="divider" style={style} />
  );
}

function ImageView({ block, ctx }: { block: ImageBlock; ctx: BlockContext }) {
  const { style, own } = blockTokens(ctx.tokens, block.overrides);
  const image = block.image;
  if (!image) {
    if (ctx.mode === "live") return null;
    return (
      <div
        className="pg-placeholder"
        data-block-id={block.id}
        data-block-type="image"
        style={style}
      >
        Image
      </div>
    );
  }
  const link = block.url?.trim() ?? "";

  // The picture, in its shaped frame when the block has a shape (M6-23): see ./image-frame.
  const picture = <ImagePicture image={image} alt={block.alt} shape={block.shape} />;
  return (
    <div
      className="pg-image"
      data-block-id={block.id}
      data-block-type="image"
      // An image has no border of its own: the stylesheet draws one only for a block that sets its
      // own border thickness (M6-45), so no existing image gains the page's border.
      data-bordered={own?.borderWidth !== undefined ? "true" : undefined}
      style={style}
    >
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
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <nav
      className="pg-social"
      aria-label="Social"
      data-block-id={block.id}
      data-block-type="social"
      style={style}
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
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const embed = parseEmbed(block.url);
  if (!embed) {
    if (ctx.mode === "live") return null;
    return (
      <div
        className="pg-placeholder"
        data-block-id={block.id}
        data-block-type="embed"
        style={style}
      >
        Embed
      </div>
    );
  }
  const provider = EMBED_PROVIDER_NAMES[embed.provider];
  const inert = ctx.thumbnail || ctx.inertEmbeds;
  return (
    <div
      className="pg-embed"
      data-block-id={block.id}
      data-block-type="embed"
      data-embed-provider={embed.provider}
      style={style}
    >
      {embed.provider === "spotify" ? (
        inert ? (
          <div
            className="pg-embed-spotify"
            aria-hidden="true"
            style={{ height: spotifyHeight(embed.kind) }}
          />
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
        )
      ) : inert ? (
        <EmbedPoster embed={embed} />
      ) : (
        // One facade for every other provider (M6-27); the key resets a tapped player when the
        // author switches the address to another video.
        <EmbedFacade
          key={embed.src}
          provider={embed.provider}
          kind={embed.kind}
          src={embed.src}
          caption={block.caption}
        />
      )}
      <p className="pg-embed-caption">
        {block.caption === "" ? provider : `${block.caption} · ${provider}`}
      </p>
    </div>
  );
}

function GridView({ block, ctx }: { block: GridBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <div className="pg-grid" data-block-id={block.id} data-block-type="grid" style={style}>
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
      return <HeaderView block={block} ctx={ctx} />;
    case "text":
      return <TextView block={block} ctx={ctx} />;
    case "image":
      return <ImageView block={block} ctx={ctx} />;
    case "social":
      return <SocialView block={block} ctx={ctx} />;
    case "embed":
      return <EmbedView block={block} ctx={ctx} />;
    case "grid":
      return <GridView block={block} ctx={ctx} />;
    case "divider":
      return <DividerView block={block} ctx={ctx} />;
    default:
      return null;
  }
}
