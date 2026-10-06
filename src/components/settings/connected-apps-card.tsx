import { Card } from "@/components/app/screen";
import { clientEnv } from "@/lib/env/client";
import { loadConnectedApps, type ConnectedApp } from "@/lib/oauth/grants";
import {
  CONNECTED_APPS_INTRO,
  CONNECTED_APPS_LINK,
  CONNECTED_APPS_LOAD_ERROR,
  CONNECTED_APPS_TITLE,
} from "@/lib/oauth/messages";
import { rootOrigin } from "@/lib/routing/urls";
import { failIfInjected } from "@/lib/testing/faults";
import { ConnectedAppsList } from "./connected-apps-list";

/**
 * The Connected apps card of Settings & billing (M10-18): every app the signed-in person has let
 * manage their pages, with what it may do, when it was connected and last used, and Revoke. A server
 * component: the grants are read with the secret key (the tables have no client access), filtered by
 * the verified session user, and only unrevoked grants whose app still exists are listed. The one
 * client part is the list, which owns the Revoke buttons and the "can no longer access" message.
 *
 * The card never shows a token, a hash, a client id or a grant id as text (the grant id lives only in
 * the button's call). If the read fails the card says so and the rest of the screen renders.
 */
export async function ConnectedAppsCard({ userId }: { userId: string }) {
  let apps: ConnectedApp[] | null = null;
  try {
    // The end-to-end specs' way to make this read fail (M5-20); does nothing in production.
    await failIfInjected("connected-apps-load");
    apps = await loadConnectedApps(userId);
  } catch (error) {
    console.error(
      "[settings] loading connected apps failed",
      error instanceof Error ? error.message : "unknown",
    );
  }
  const connectHref = `${rootOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)}/connect`;

  return (
    <Card className="flex flex-col gap-3.5">
      <h2 className="text-sm font-semibold">{CONNECTED_APPS_TITLE}</h2>
      <p className="text-sm leading-relaxed text-text-2">{CONNECTED_APPS_INTRO}</p>
      {apps === null ? (
        <p role="alert" className="text-sm text-bad">
          {CONNECTED_APPS_LOAD_ERROR}
        </p>
      ) : (
        <ConnectedAppsList apps={apps} />
      )}
      <a
        data-connected-apps=""
        href={connectHref}
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink underline"
      >
        {CONNECTED_APPS_LINK}
      </a>
    </Card>
  );
}
