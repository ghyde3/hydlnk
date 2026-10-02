import type { CSSProperties, ReactNode } from "react";
import type { DemoBlock, DemoBrand, DemoFont, DemoSocial, DemoTheme } from "./brands";
import { DEMO_FONT_VARIABLES } from "./fonts";
import "./demo-page.css";

const FONT_STACKS: Record<DemoFont, string> = {
  Fraunces: "var(--font-demo-fraunces), Georgia, serif",
  "Instrument Serif": "var(--font-demo-instrument), Georgia, serif",
  Geist: "var(--font-demo-geist), system-ui, sans-serif",
};

/** Demo theme -> the --t-* variables the demo stylesheet reads (inside .dp only). */
export function demoThemeVars(theme: DemoTheme): CSSProperties {
  return {
    "--t-bg": theme.bg,
    "--t-surface": theme.surface,
    "--t-text": theme.text,
    "--t-text-muted": theme.textMuted,
    "--t-accent": theme.accent,
    "--t-button-bg": theme.buttonBg,
    "--t-button-text": theme.buttonText,
    "--t-border": theme.border,
    "--t-font-heading": FONT_STACKS[theme.fontHeading],
    "--t-font-body": FONT_STACKS.Geist,
    "--t-weight-heading": String(theme.weightHeading),
    "--t-radius": `${theme.radius}px`,
    "--t-overlay-opacity": String(theme.overlayOpacity ?? 0),
  } as CSSProperties;
}

/** An image under public/marketing/demo: AVIF with a WebP fallback. */
export function DemoPicture({
  name,
  alt,
  width,
  height,
  className,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <picture>
      <source srcSet={`/marketing/demo/${name}.avif`} type="image/avif" />
      <img
        src={`/marketing/demo/${name}.webp`}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={className}
      />
    </picture>
  );
}

function SocialGlyph({ kind }: { kind: DemoSocial }) {
  const paths: Record<DemoSocial, ReactNode> = {
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
  };
  return (
    <span className="dp-social-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {paths[kind]}
      </svg>
    </span>
  );
}

function Block({ block, theme }: { block: DemoBlock; theme: DemoTheme }) {
  switch (block.type) {
    case "link":
      return (
        <span className="dp-link" data-button-style={block.style ?? theme.buttonStyle}>
          {block.label}
        </span>
      );
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
    case "header":
      return <span className="dp-header">{block.text}</span>;
    case "text":
      return <span className="dp-text">{block.text}</span>;
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
    case "divider":
      return <span className="dp-divider" />;
  }
}

/**
 * A demo link-in-bio page drawn with a demo theme: the same blocks the product has (link, card,
 * image, header, grid, social row), at phone scale. Decorative: it holds no links or controls.
 * `theme` defaults to the brand's own; `badge` shows the Free plan's footer badge.
 */
export function DemoPage({
  brand,
  theme = brand.theme,
  badge = false,
  inlineTheme = true,
  className = "",
}: {
  brand: DemoBrand;
  theme?: DemoTheme;
  badge?: boolean;
  /** False when a stylesheet supplies the --t-* variables (the token playground). */
  inlineTheme?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`dp ${DEMO_FONT_VARIABLES} ${className}`}
      style={inlineTheme ? demoThemeVars(theme) : undefined}
      data-density={theme.density}
      data-bg-type={theme.bgType}
      data-heading-font={theme.fontHeading}
    >
      {theme.bgType === "image" && theme.bgImage ? (
        <span className="dp-bg" aria-hidden="true">
          <DemoPicture name={theme.bgImage} alt="" width={600} height={1200} />
        </span>
      ) : null}
      <span className="dp-col">
        <span className="dp-avatar">
          <DemoPicture name={brand.avatar.image} alt={brand.avatar.alt} width={160} height={160} />
        </span>
        <span className="dp-name">{brand.name}</span>
        <span className="dp-bio">{brand.bio}</span>
        <span className="dp-social">
          {brand.social.map((kind) => (
            <SocialGlyph key={kind} kind={kind} />
          ))}
        </span>
        <span className="dp-blocks">
          {brand.blocks.map((block, index) => (
            <Block key={index} block={block} theme={theme} />
          ))}
        </span>
        {badge ? <span className="dp-badge">Made with HYDLNK</span> : null}
      </span>
    </div>
  );
}

/** The charcoal phone bezel around a demo page: 290 x 600. */
export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`hl-phone ${className}`} aria-hidden="true">
      <div className="hl-phone-screen">{children}</div>
    </div>
  );
}
