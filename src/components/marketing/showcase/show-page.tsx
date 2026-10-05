import type { CSSProperties, ReactNode } from "react";
import { demoThemeVars, DemoPicture } from "../demo/demo-page";
import { TRY_FONT_VARIABLES } from "../try/fonts";
import { ADDRESS_SUFFIX } from "../home/address";
import type { ShowBlock, ShowBrand, ShowSocial, ShowTheme } from "./data";
import "../demo/demo-page.css";
import "./showcase.css";

/** The --t-* values a demo page reads, with the theme's own heading and body faces. */
function themeVars(theme: ShowTheme): CSSProperties {
  return {
    ...demoThemeVars(theme),
    "--t-font-heading": theme.headingStack,
    "--t-font-body": theme.bodyStack,
  } as CSSProperties;
}

const GLYPHS: Record<ShowSocial, ReactNode> = {
  instagram: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="4" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M4.5 12h15M12 4.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5z" />
    </>
  ),
  email: (
    <>
      <rect x="4.5" y="6.5" width="15" height="11" rx="1.5" />
      <path d="M5 7.5l7 5.5 7-5.5" />
    </>
  ),
  youtube: (
    <>
      <rect x="4" y="6.5" width="16" height="11" rx="3" />
      <path d="M10.5 9.5v5l4-2.5z" />
    </>
  ),
  tiktok: <path d="M14 5v9.2a3.2 3.2 0 1 1-3.2-3.2M14 5c.4 2 1.8 3.4 4 3.6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  linkedin: (
    <>
      <path d="M7 10.5V17M7 7.5v.1M11 17v-6.5M11 13c0-1.7 1.2-2.6 2.6-2.6S16 11.3 16 13v4" />
    </>
  ),
  threads: (
    <path d="M15.5 9.5c-.6-1.6-1.8-2.4-3.5-2.4-2.4 0-3.8 1.9-3.8 4.9s1.4 4.9 3.8 4.9c2 0 3.2-1 3.2-2.5 0-1.6-1.4-2.3-3.2-2.3-1.2 0-2 .4-2 1.1" />
  ),
};

function Social({ kind }: { kind: ShowSocial }) {
  return (
    <span className="dp-social-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {GLYPHS[kind]}
      </svg>
    </span>
  );
}

function Play() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sc-play-glyph">
      <path d="M9 7l8 5-8 5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sc-chevron" data-open={open}>
      <path d="M7 10l5 5 5-5" />
    </svg>
  );
}

function Block({ block, theme }: { block: ShowBlock; theme: ShowTheme }) {
  switch (block.type) {
    case "link":
      return (
        <span className="dp-link" data-button-style={theme.buttonStyle}>
          {block.live ? <span className="sc-live-dot" aria-hidden="true" /> : null}
          {block.label}
        </span>
      );
    case "header":
      return <span className="dp-header">{block.text}</span>;
    case "text":
      return <span className="dp-text">{block.text}</span>;
    case "card":
      return (
        <span className="dp-card">
          <span className="dp-card-banner">
            <DemoPicture
              name={block.image}
              alt={block.alt}
              width={640}
              height={256}
              className="dp-card-image"
            />
            <span className="dp-card-title">{block.title}</span>
          </span>
          <span className="dp-card-foot">
            <span>{block.caption}</span>
            <span aria-hidden="true" className="dp-card-arrow">
              →
            </span>
          </span>
        </span>
      );
    case "image":
      return (
        <span className="dp-image">
          <DemoPicture name={block.image} alt={block.alt} width={640} height={400} />
        </span>
      );
    case "grid":
      return (
        <span className="dp-grid">
          {block.cells.map((cell) => (
            <span key={cell.title} className="dp-grid-cell">
              <span className="dp-grid-title">{cell.title}</span>
              <span className="dp-grid-sub">{cell.subtitle}</span>
            </span>
          ))}
        </span>
      );
    case "gallery":
      return (
        <span className="sc-gallery">
          {block.tiles.map((tile) => (
            <span key={tile.image} className="sc-tile">
              <DemoPicture name={tile.image} alt={tile.alt} width={320} height={320} />
              <span className="sc-tile-label">{tile.label}</span>
            </span>
          ))}
        </span>
      );
    case "embed":
      return block.kind === "audio" ? (
        <span className="sc-embed sc-embed-audio">
          <span className="sc-embed-row">
            <span className="sc-cover">
              <DemoPicture name={block.image} alt={block.alt} width={160} height={160} />
            </span>
            <span className="sc-embed-text">
              <span className="sc-embed-title">{block.title}</span>
              <span className="sc-embed-sub">{block.caption}</span>
            </span>
            <span className="sc-play">
              <Play />
            </span>
          </span>
          <span className="sc-progress" aria-hidden="true">
            <span className="sc-progress-fill" />
          </span>
        </span>
      ) : (
        <span className="sc-embed sc-embed-video">
          <span className="sc-video">
            <DemoPicture name={block.image} alt={block.alt} width={640} height={360} />
            <span className="sc-play sc-play-over">
              <Play />
            </span>
          </span>
          <span className="sc-embed-foot">
            <span className="sc-embed-title">{block.title}</span>
            <span className="sc-embed-sub">{block.caption}</span>
          </span>
        </span>
      );
    case "faq":
      return (
        <span className="sc-faq">
          {block.items.map((item, index) => (
            <span key={item.q} className="sc-faq-item">
              <span className="sc-faq-q">
                <span>{item.q}</span>
                <Chevron open={index === 0 && Boolean(item.a)} />
              </span>
              {index === 0 && item.a ? <span className="sc-faq-a">{item.a}</span> : null}
            </span>
          ))}
        </span>
      );
    case "discount":
      return (
        <span className="sc-discount">
          <span className="sc-discount-desc">{block.description}</span>
          <span className="sc-discount-row">
            <span className="sc-discount-code">{block.code}</span>
            <span className="sc-discount-copy">Copy</span>
          </span>
        </span>
      );
    case "map":
      return (
        <span className="sc-map">
          <svg viewBox="0 0 240 70" aria-hidden="true" className="sc-map-art" preserveAspectRatio="xMidYMid slice">
            <path d="M-10 52L70 30L150 44L250 12" />
            <path d="M40 80L80 -10M120 80L150 -10M190 80L205 -10" />
            <path d="M-10 18L250 36" />
            <circle cx="132" cy="33" r="6" className="sc-map-pin" />
            <circle cx="132" cy="33" r="2" className="sc-map-pin-dot" />
          </svg>
          <span className="sc-map-body">
            <span className="sc-map-name">{block.name}</span>
            <span className="sc-map-address">{block.address}</span>
          </span>
        </span>
      );
  }
}

/**
 * One brand's link page in its own theme, at phone scale, under a browser-style address bar. The
 * same blocks the product has; decorative (holds no links or controls).
 */
export function ShowPage({ brand }: { brand: ShowBrand }) {
  const { theme } = brand;
  return (
    <div className={`sc-screen ${TRY_FONT_VARIABLES}`} style={themeVars(theme)}>
      <span className="sc-bar">
        {brand.handle}
        {ADDRESS_SUFFIX}
      </span>
      <div className="sc-page">
        <div
          className="dp sc-dp"
          data-density={theme.density}
          data-bg-type={theme.bgType}
          data-heading-font={theme.fontHeading}
        >
          <span className="dp-col">
            <span className="dp-avatar">
              <DemoPicture
                name={brand.avatar.image}
                alt={brand.avatar.alt}
                width={160}
                height={160}
              />
            </span>
            <span className="dp-name">{brand.name}</span>
            <span className="dp-bio">{brand.bio}</span>
            <span className="dp-social">
              {brand.social.map((kind) => (
                <Social key={kind} kind={kind} />
              ))}
            </span>
            <span className="dp-blocks">
              {brand.blocks.map((block, index) => (
                <Block key={index} block={block} theme={theme} />
              ))}
            </span>
          </span>
        </div>
        <span className="sc-fade" aria-hidden="true" />
      </div>
    </div>
  );
}
