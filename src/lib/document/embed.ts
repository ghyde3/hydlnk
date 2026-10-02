import { isHttpUrl } from "./url";

export type EmbedProvider = "youtube" | "spotify";
export type SpotifyKind = "track" | "album" | "playlist" | "episode" | "show" | "artist";
export type EmbedKind = "video" | SpotifyKind;

export interface ParsedEmbed {
  provider: EmbedProvider;
  /** `video` for every YouTube form; the Spotify resource type otherwise. */
  kind: EmbedKind;
  /** Validated against `[A-Za-z0-9_-]` (YouTube, 11 chars) or base62 (Spotify, 22 chars). */
  id: string;
  /** Rebuilt from `provider`, `kind` and `id`; never copied from the input. */
  src: string;
}

export const EMBED_ERROR_MESSAGE =
  "Paste a link to a YouTube video or a Spotify track, album, playlist or episode.";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_KINDS = new Set<string>(["track", "album", "playlist", "episode", "show", "artist"]);

function youtube(id: string | null | undefined): ParsedEmbed | null {
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return {
    provider: "youtube",
    kind: "video",
    id,
    src: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

/**
 * Parses an embeddable URL: YouTube (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`,
 * `youtube.com/embed/`) or Spotify (`open.spotify.com/{track|album|playlist|episode|show|artist}/`).
 * The host must be exactly one of the allowlisted hosts (no subdomain or suffix tricks, no
 * credentials, no custom port), and `src` is built from the parsed id only. Returns null for
 * everything else, including channels, playlists-by-query and other providers.
 */
export function parseEmbed(input: string): ParsedEmbed | null {
  if (!isHttpUrl(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.port !== "") return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  if (host === "youtu.be") return youtube(segments[0]);

  if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") return youtube(url.searchParams.get("v"));
    if (segments[0] === "shorts" || segments[0] === "embed") return youtube(segments[1]);
    return null;
  }

  if (host === "open.spotify.com") {
    // Spotify adds a locale segment to some links: /intl-de/track/{id}.
    if (segments[0] && /^intl-[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(segments[0])) segments.shift();
    const [kind, id] = segments;
    if (!kind || !SPOTIFY_KINDS.has(kind) || !id || !SPOTIFY_ID.test(id)) return null;
    return {
      provider: "spotify",
      kind: kind as SpotifyKind,
      id,
      src: `https://open.spotify.com/embed/${kind}/${id}`,
    };
  }

  return null;
}
