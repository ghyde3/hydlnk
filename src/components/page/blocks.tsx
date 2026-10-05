import { Fragment, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import {
  EMBED_PROVIDER_NAMES,
  SOCIAL_PLATFORM_LABELS,
  isLinkFeatured,
  parseEmbed,
  textLines,
  textSegments,
  type AlignValue,
  type Block,
  type CardBlock,
  type ContactBlock,
  type DiscountBlock,
  type DividerBlock,
  type EmbedBlock,
  type FaqBlock,
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
import { EmbedFacadeSlot } from "./embed-slot";
import { EmbedPoster } from "./embed-poster";
import { ImagePicture, focusStyle } from "./image-frame";
import { LinkGlyph, LinkThumb, resolveLinkIcon } from "./link-icon";
import { LockMark, lockOf, lockedLinkAttrs } from "./lock-mark";
import { mailtoLink, outboundHref, telLink, vcardLink, type OutboundAttrs } from "./outbound";
import { SocialGlyph } from "./social-icons";
import { AppsView, BookView, MapView } from "./store-blocks";

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
export function LinkBox({
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
export function blockTokens(
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
  // M9-30: a locked link keeps its /r/ href on the live page and gains `data-locked`, a padlock and
  // hidden words; in the preview, the shared draft and the dock it has no href at all.
  const lock = lockOf(block);
  const link = lockedLinkAttrs(
    outboundHref(block.url, { pageId: ctx.pageId, id: block.id }),
    lock,
    ctx.mode === "preview" || ctx.thumbnail === true,
  );
  return (
    <LinkBox
      className={lock === null ? "pg-link" : "pg-link pg-lock"}
      data-block-id={block.id}
      data-block-type="link"
      data-button-style={resolved.buttonStyle}
      data-icon={icon?.kind}
      data-featured={isLinkFeatured(block.featured) ? block.featured : undefined}
      data-locked={lock ?? undefined}
      style={style}
      thumbnail={ctx.thumbnail}
      link={link}
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
      {lock === null ? null : <LockMark kind={lock} />}
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

/**
 * One piece of formatted text: the marks nest as `<strong><em><s><u>`, bold outermost (a link, when
 * there is one, wraps whatever it covers).
 */
function formatted(segment: {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
}): ReactNode {
  let node: ReactNode = segment.text;
  if (segment.underline) node = <u>{node}</u>;
  if (segment.strike) node = <s>{node}</s>;
  if (segment.italic) node = <em>{node}</em>;
  if (segment.bold) node = <strong>{node}</strong>;
  return node;
}

/** The `data-align` of a line, written from the closed list, never from the document's own string. */
function alignAttribute(align: AlignValue | null): "left" | "center" | "right" | undefined {
  if (align === "left") return "left";
  if (align === "center") return "center";
  if (align === "right") return "right";
  return undefined;
}

/**
 * The pieces of one run of text as React nodes: formatted pieces, with each link's pieces gathered
 * under one anchor. A link's `href` and `rel` come from `outboundHref`, so it points at the click
 * redirect and never carries its destination. A link without a usable address (a draft) renders as
 * plain text, and every link in a thumbnail as inert text.
 */
function textRun(segments: ReturnType<typeof textSegments>, ctx: BlockContext): ReactNode[] {
  const children: ReactNode[] = [];
  for (let i = 0; i < segments.length;) {
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
  return children;
}

/**
 * A text block (M2-16, M6-28, M9-11). The text itself is never parsed: `white-space: pre-line` keeps
 * the author's line breaks, and bold, italic, strike, underline, links and alignment come only from
 * the block's structured `marks`. Every piece of text is a React text node (escaped).
 *
 * A block without an `align` mark is one run in the paragraph. A block with one draws every line as
 * a `.pg-text-line` block of its own (the line breaks are the spans' own, so they are not written
 * as text) with `data-align` for the alignments the author chose; the stylesheet sets `text-align`
 * from that attribute, so no `style` and no tenant string reaches the markup.
 */
function TextView({ block, ctx }: { block: TextBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const lines = textLines(block.text, block.marks);
  if (lines) {
    return (
      <p className="pg-text" data-block-id={block.id} data-block-type="text" style={style}>
        {lines.map((line, index) => (
          <span key={index} className="pg-text-line" data-align={alignAttribute(line.align)}>
            {textRun(line.segments, ctx)}
          </span>
        ))}
      </p>
    );
  }
  const segments = textSegments(block.text, block.marks);
  const only = segments[0]!;
  const plain =
    segments.length === 1 &&
    !only.link &&
    !only.bold &&
    !only.italic &&
    !only.strike &&
    !only.underline;
  return (
    <p className="pg-text" data-block-id={block.id} data-block-type="text" style={style}>
      {plain ? block.text : textRun(segments, ctx)}
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
      {inert ? (
        <EmbedPoster embed={embed} />
      ) : (
        // One facade for every provider, Spotify included (M6-27, M8-05): a poster and a Play button
        // that carry what the player needs, upgraded on a tap by the one tenant script on the live
        // page and by the React `EmbedFacade` in the interactive previews. The key resets a tapped
        // player when the author switches the address to another video.
        <EmbedFacadeSlot
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
 * A FAQ (M9-16): one native `<details>` per question, all closed, every answer already in the
 * HTML. The disclosure is the browser's own (a tap, Enter or Space), so it needs no script and
 * works with JavaScript off. Questions and answers are React text (escaped) and the answer is plain
 * text: no marks and no links. In a thumbnail (the editor's dock) there is nothing to open: only the
 * questions are drawn, as plain boxes.
 */
function FaqView({ block, ctx }: { block: FaqBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <div className="pg-faq" data-block-id={block.id} data-block-type="faq" style={style}>
      {block.items.map((item) =>
        ctx.thumbnail ? (
          <div key={item.id} className="pg-faq-item">
            <div className="pg-faq-q">{item.question}</div>
          </div>
        ) : (
          <details key={item.id} className="pg-faq-item">
            <summary className="pg-faq-q">{item.question}</summary>
            <p className="pg-faq-a">{item.answer}</p>
          </details>
        ),
      )}
    </div>
  );
}

/**
 * Contact details (M9-17): the name, a phone number and an email address as plain `tel:` and
 * `mailto:` links (not tracked, like the social email icon), the hours, and "Save contact", which
 * goes to the page's own `/c/<pageId>/<blockId>` route (M9-18). Every value is React text; an
 * address that is not usable (a draft) renders without an `href`. Nothing here needs JavaScript.
 */
function ContactView({ block, ctx }: { block: ContactBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const phone = block.phone ?? "";
  const email = block.email ?? "";
  const hours = block.hours ?? "";
  return (
    <div className="pg-contact" data-block-id={block.id} data-block-type="contact" style={style}>
      <p className="pg-contact-name">{block.name}</p>
      {phone === "" ? null : (
        <LinkBox className="pg-contact-phone" thumbnail={ctx.thumbnail} link={telLink(phone)}>
          {phone}
        </LinkBox>
      )}
      {email === "" ? null : (
        <LinkBox className="pg-contact-email" thumbnail={ctx.thumbnail} link={mailtoLink(email)}>
          {email}
        </LinkBox>
      )}
      {hours === "" ? null : <p className="pg-contact-hours">{hours}</p>}
      <LinkBox
        className="pg-contact-save"
        thumbnail={ctx.thumbnail}
        link={vcardLink({ pageId: ctx.pageId, id: block.id })}
        {...(ctx.thumbnail ? {} : { download: true })}
      >
        Save contact
      </LinkBox>
    </div>
  );
}

/**
 * A discount code (M9-19): the description, the code itself (always visible and selectable in one
 * gesture), a Copy button and, with a shop link, "Shop now" through `/r/<pageId>/<blockId>` (the
 * destination is never in the markup). The Copy button is drawn hidden until the one tenant script
 * marks the block `data-js`, so a page without JavaScript never shows a dead button; the script
 * copies the `data-copy` value and writes `data-copied` and the status text. The code is React text
 * and an escaped attribute. In a thumbnail there is no button at all (a button inside the dock's
 * button is not valid markup, and nothing in a thumbnail can be pressed).
 */
function DiscountView({ block, ctx }: { block: DiscountBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const shop =
    (block.url ?? "").trim() === ""
      ? null
      : outboundHref(block.url, { pageId: ctx.pageId, id: block.id });
  const description = block.description ?? "";
  return (
    <div className="pg-discount" data-block-id={block.id} data-block-type="discount" style={style}>
      {description === "" ? null : <p className="pg-discount-desc">{description}</p>}
      <code className="pg-discount-code">{block.code}</code>
      {ctx.thumbnail ? null : (
        <>
          <button
            type="button"
            className="pg-discount-copy"
            data-copy={block.code}
            data-copied="Copied"
          >
            Copy
          </button>{" "}
          <span className="pg-discount-status" role="status"></span>
        </>
      )}
      {shop === null ? null : (
        <LinkBox className="pg-discount-shop" thumbnail={ctx.thumbnail} link={shop}>
          Shop now
        </LinkBox>
      )}
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
    case "faq":
      return <FaqView block={block} ctx={ctx} />;
    case "contact":
      return <ContactView block={block} ctx={ctx} />;
    case "discount":
      return <DiscountView block={block} ctx={ctx} />;
    case "book":
      return <BookView block={block} ctx={ctx} />;
    case "apps":
      return <AppsView block={block} ctx={ctx} />;
    case "map":
      return <MapView block={block} ctx={ctx} />;
    case "page_link":
      // M11-07: the renderer worker replaces this (a link button with a relative href, no /r).
      return null;
    default:
      return null;
  }
}
