import type { CSSProperties } from "react";
import type { Block, PublishedDocument } from "@/lib/schemas";
import {
  BLOCK_OVERRIDE_KEYS,
  resolveBlockTokens,
  tokenCssVarName,
  tokensToCssVars,
  type BlockOverrides,
  type TokenSet,
} from "@/lib/theme";

type LinkButtonBlock = Extract<Block, { type: "link_button" }>;

/** "Mara Okafor" -> "MO". */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase();
}

/** Only the variables a block actually overrides; the rest inherit from the page root. */
function overrideVars(resolved: TokenSet, overrides: BlockOverrides | undefined) {
  if (!overrides) return undefined;
  const all = tokensToCssVars(resolved);
  const vars: Record<string, string> = {};
  for (const key of BLOCK_OVERRIDE_KEYS) {
    if (overrides[key] === undefined) continue;
    const name = tokenCssVarName(key);
    const value = all[name];
    if (value !== undefined) vars[name] = value;
  }
  return vars as CSSProperties;
}

/**
 * Placeholder tenant page: avatar, name, bio and the visible link buttons. M2 replaces it with the
 * shared block renderer that the editor preview uses too.
 *
 * Styling reads tenant variables only. The theme reaches the page as --t-* custom properties set
 * on the root element from the tokens frozen at publish time; tenant.css does the rest.
 * Everything tenant-controlled is rendered as React text or as an attribute, so it is escaped, and
 * every URL already passed safeUrlSchema when the document was parsed.
 */
export function TenantPage({
  document,
  handle,
  rootOrigin,
}: {
  document: PublishedDocument;
  handle: string;
  /** Origin of the HYDLNK root host, for the badge and report links. */
  rootOrigin: string;
}) {
  const tokens = document.resolvedTokens;
  const { profile } = document;
  const links = document.blocks.filter(
    (block): block is LinkButtonBlock => block.type === "link_button" && block.visible,
  );

  return (
    <div
      className="tenant-root"
      style={tokensToCssVars(tokens) as CSSProperties}
      data-density={tokens.density}
      data-align={tokens.align}
    >
      <main className="tenant-main">
        <div className="tenant-avatar" aria-hidden="true">
          {profile.avatarUrl ? (
            // A plain <img>: the URL is tenant-supplied, and uploads are already resized to 400px
            // at upload time (PLAN.md), so next/image would add nothing but a remotePatterns list.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt=""
              width={96}
              height={96}
              referrerPolicy="no-referrer"
            />
          ) : (
            initialsOf(profile.displayName)
          )}
        </div>
        <h1 className="tenant-name">{profile.displayName}</h1>
        {profile.bio ? <p className="tenant-bio">{profile.bio}</p> : null}

        {links.length > 0 ? (
          <ul className="tenant-links">
            {links.map((block) => {
              const blockTokens = resolveBlockTokens(tokens, block.overrides);
              return (
                <li key={block.id}>
                  <a
                    className="tenant-link"
                    href={block.url}
                    rel="noopener nofollow ugc"
                    data-button-style={blockTokens.buttonStyle}
                    style={overrideVars(blockTokens, block.overrides)}
                  >
                    {block.label}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </main>

      <footer className="tenant-footer">
        <a href={rootOrigin}>Made with HYDLNK</a>
        <a href={`${rootOrigin}/report?handle=${encodeURIComponent(handle)}`}>Report</a>
      </footer>
    </div>
  );
}
