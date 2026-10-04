import { EmbedFacade } from "@/components/page/embed-facade";
import { provideEmbedFacade } from "@/components/page/embed-slot";

/**
 * Draws embeds the way the editor's previews do: with the React facade, which mounts the player on a
 * tap with React state. The renderer's default (and the live page's) is the plain markup that the one
 * tenant script upgrades (M8-05); in the real build the editor registers the facade from its own
 * client modules (src/lib/editor/contracts.ts). Import this first in a test that taps a facade.
 */
provideEmbedFacade(EmbedFacade);
