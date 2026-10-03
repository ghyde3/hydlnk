import { clientEnv } from "@/lib/env/client";
import { TRY_FONT_VARIABLES } from "./fonts";
import { LazyTry } from "./lazy-try";
import type { TryPreset } from "./sample-page";
import { TryStatic } from "./try-static";

export type { TryPreset } from "./sample-page";
export type { TryThemeId } from "./themes";

/**
 * The try-it builder: a live phone preview of a sample page that visitors restyle and add blocks to
 * on the spot (nothing is saved), ending in a link to claim a name. Place it inside a section; the
 * section brings its own heading. `preset` opens it on a fitting theme, blocks, name or social
 * icons, so a landing page can start where its visitors are:
 *
 *   <TryBuilder preset={{ theme: "noir", socials: ["tiktok", "instagram"], blocks: ["social", "link", "embed"] }} />
 *
 * A server component. It paints the phone with no JavaScript and loads the interactive builder
 * only as it nears the screen.
 */
export function TryBuilder({ preset }: { preset?: TryPreset }) {
  const rootDomain = clientEnv.NEXT_PUBLIC_ROOT_DOMAIN;
  return (
    <div className={TRY_FONT_VARIABLES} data-try="">
      <LazyTry
        preset={preset}
        rootDomain={rootDomain}
        fallback={<TryStatic preset={preset} rootDomain={rootDomain} />}
      />
    </div>
  );
}
