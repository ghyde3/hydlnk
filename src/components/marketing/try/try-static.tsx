import { BLOCK_CATALOG } from "../block-catalog";
import { ButtonLink } from "../primitives";
import { signupUrl } from "../signup-handoff";
import { PREVIEW_HINT, TRY_BLOCK_KINDS, buildTryDoc, type TryPreset } from "./sample-page";
import { initialTryState } from "./try-state";
import { TryLayout, TryPhone } from "./try-phone";

/**
 * The builder as it first appears: the sample page in its phone, drawn on the server, and the nine
 * blocks listed as plain text. No JavaScript. The interactive builder (lazy-try.tsx) replaces it as
 * the section nears the screen; people without JavaScript keep this, and the sign-up link.
 */
export function TryStatic({ preset, rootDomain }: { preset?: TryPreset; rootDomain: string }) {
  const doc = buildTryDoc(initialTryState(preset), preset);
  return (
    <TryLayout
      phone={<TryPhone doc={doc} />}
      caption={<p className="try-status">{PREVIEW_HINT}</p>}
      panel={
        <>
          <p className="try-hint">
            Pick a theme, change the colors and fonts, and add blocks to the page. Every theme and
            every block is free on every plan.
          </p>
          <ul className="try-static-list">
            {BLOCK_CATALOG.filter((block) =>
              (TRY_BLOCK_KINDS as readonly string[]).includes(block.id),
            ).map((block) => (
              <li key={block.id}>
                <p className="text-sm font-semibold">{block.name}</p>
                <p className="mt-1 text-[13px] leading-[1.45] text-text-2">{block.short}</p>
              </li>
            ))}
          </ul>
          <div className="try-cta">
            <p className="text-base font-semibold">Like it?</p>
            <ButtonLink href={signupUrl(rootDomain)}>Claim your name to keep building</ButtonLink>
          </div>
        </>
      }
    />
  );
}
