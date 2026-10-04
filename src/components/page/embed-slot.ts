import type { ReactNode } from "react";
import type { EmbedKind, EmbedProvider } from "@/lib/document";
import { EmbedFacadeMarkup } from "./embed-facade-markup";

/**
 * Which component draws an embed's tap-to-play facade (M8-05, M8-02). The renderer is one module
 * with no client component in its import graph, so the live page can be built to finished HTML by a
 * route handler; the facade it draws by default is the plain markup (`EmbedFacadeMarkup`), which the
 * one tenant script upgrades on a tap. The editor's interactive previews (the workspace bezel, the
 * full-size phone sheet, the owner's Preview page) draw the same markup through the React
 * `EmbedFacade`, which mounts the same iframe on a tap with React state: they call
 * `provideEmbedFacade` once, from the client module that imports them (the editor's seam module and
 * the Preview page's client wrapper). Only browser and SSR modules ever call it; the
 * route handler's layer never imports those, so it can never be handed a client component.
 * The first paint of every facade is the same markup byte for byte, which is what keeps preview and
 * live page identical.
 */

export interface EmbedFacadeProps {
  provider: EmbedProvider;
  kind: EmbedKind;
  /** `parseEmbed(url).src`, never the tenant's URL. */
  src: string;
  caption: string;
}

export type EmbedFacadeComponent = (props: EmbedFacadeProps) => ReactNode;

let facade: EmbedFacadeComponent = EmbedFacadeMarkup;

/**
 * The facade of an embed block: draws whichever component is provided right now, the plain markup
 * unless an interactive preview provided another. A component of its own, declared once, so a
 * block's facade keeps its identity (and a tapped player its state) from one render to the next; the
 * block gives it a `key` that follows the player's address.
 */
export function EmbedFacadeSlot(props: EmbedFacadeProps): ReactNode {
  return facade(props);
}

/**
 * Called by the client modules of the interactive previews, once, at module scope. Refuses a client
 * reference: that is what a server-components module would hold for `EmbedFacade`, and handing it to
 * this module (shared by every server render, the live tenant route included) would break the live page.
 */
export function provideEmbedFacade(component: EmbedFacadeComponent): void {
  if ((component as { $$typeof?: symbol }).$$typeof === Symbol.for("react.client.reference")) {
    throw new Error("provideEmbedFacade must be called from client modules, not server components");
  }
  facade = component;
}
