"use client";

import { useId } from "react";
import { clientEnv } from "@/lib/env/client";
import { rootOrigin } from "@/lib/routing/urls";
import { CARD, CARD_TITLE, SECONDARY_BUTTON } from "./styles";

/**
 * "Use with Claude or ChatGPT" (M10-34): the Share tab's last card, a sentence and a 44px link to
 * the marketing /connect page, which explains the connector step by step. The page is on the root
 * host and the editor on the app host, so the link is absolute, built from the configured root
 * domain, and opens in a new tab so the editor and its draft stay where they are. It reads no
 * workspace state and calls no endpoint.
 */
export function ConnectCard() {
  const headingId = useId();
  const href = `${rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/connect`;

  return (
    <section aria-labelledby={headingId} data-testid="connect-card" className={CARD}>
      <h2 id={headingId} className={CARD_TITLE}>
        Use with Claude or ChatGPT
      </h2>
      <p className="m-0 text-sm leading-relaxed text-text-2">
        Connect HYDLNK to an AI app and ask it to edit your draft, check your numbers or publish for
        you. You choose what it can do.
      </p>
      <div>
        <a href={href} target="_blank" rel="noopener" className={SECONDARY_BUTTON}>
          See how to connect
        </a>
      </div>
    </section>
  );
}
