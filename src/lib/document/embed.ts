import { isHttpUrl } from "./url";

export type EmbedProvider =
  "youtube" | "spotify" | "vimeo" | "tiktok" | "instagram" | "soundcloud" | "applemusic" | "twitch";
export type SpotifyKind = "track" | "album" | "playlist" | "episode" | "show" | "artist";
/**
 * What the link points at. `video` for YouTube, Vimeo and TikTok; the Spotify resource type for
 * Spotify; `post`, `reel` and `tv` for Instagram; `track`, `playlist` and `artist` for SoundCloud;
 * `album`, `song` and `playlist` for Apple Music; `channel`, `video` and `clip` for Twitch.
 */
export type EmbedKind =
  "video" | SpotifyKind | "post" | "reel" | "tv" | "song" | "channel" | "clip";

export interface ParsedEmbed {
  provider: EmbedProvider;
  kind: EmbedKind;
  /**
   * The identifier validated out of the link: the YouTube, Vimeo, TikTok or Twitch video id, the
   * Spotify id, the Instagram shortcode, the SoundCloud path (`user/track`), the Apple Music id or
   * the Twitch channel or clip.
   */
  id: string;
  /**
   * Rebuilt from the validated parts only, never copied from the input: no query, no fragment and
   * no `parent` of the author's choosing survives. The Twitch `parent` is added in the browser at
   * tap time (see `embedPlayerSrc`).
   */
  src: string;
}

export const EMBED_ERROR_MESSAGE =
  "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.";

/** Shown instead of `EMBED_ERROR_MESSAGE` for a short link: it is not followed (no server fetch of a stranger's URL). */
export const EMBED_SHORT_LINK_MESSAGE =
  "That’s a short link. Open it in your browser, then copy the full address from the address bar.";

/** Display name of each provider: the caption suffix and the player's title. */
export const EMBED_PROVIDER_NAMES: Record<EmbedProvider, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  vimeo: "Vimeo",
  tiktok: "TikTok",
  instagram: "Instagram",
  soundcloud: "SoundCloud",
  applemusic: "Apple Music",
  twitch: "Twitch",
};

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_KINDS = new Set<string>(["track", "album", "playlist", "episode", "show", "artist"]);

const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{8,16}$/i;

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);
const TIKTOK_USER = /^@[A-Za-z0-9._]{1,64}$/;
const TIKTOK_ID = /^\d{15,20}$/;

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,20}$/;
const INSTAGRAM_USER = /^[A-Za-z0-9._]{1,30}$/;
const INSTAGRAM_PATH: Record<string, "post" | "reel" | "tv"> = {
  p: "post",
  reel: "reel",
  tv: "tv",
};
/** First path segments that are Instagram pages, not account names. */
const INSTAGRAM_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "about",
  "legal",
  "developer",
  "directory",
  "web",
  "challenge",
]);

const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);
const SOUNDCLOUD_SLUG = /^[A-Za-z0-9_-]{1,100}$/;
/** First path segments that are SoundCloud pages, not account names. */
const SOUNDCLOUD_RESERVED = new Set([
  "discover",
  "you",
  "search",
  "stream",
  "upload",
  "pages",
  "charts",
  "popular",
  "feed",
  "settings",
  "notifications",
  "messages",
  "people",
  "tracks",
  "playlists",
  "albums",
  "mobile",
  "jobs",
  "imprint",
  "terms-of-use",
  "community-guidelines",
  "creators",
  "pro",
  "go",
  "apps",
  "legal",
  "press",
  "manage",
  "library",
  "user",
  "users",
  "groups",
  "tags",
  "premium",
  "trending",
  "mixes",
  "login",
  "signup",
]);
/** Second path segments that are the account's own pages, not a track. */
const SOUNDCLOUD_PROFILE_PAGES = new Set([
  "tracks",
  "albums",
  "sets",
  "reposts",
  "likes",
  "following",
  "followers",
  "popular-tracks",
  "comments",
  "playlists",
  "spotlight",
  "tags",
]);

const APPLE_HOST = "music.apple.com";
const APPLE_STOREFRONT = /^[A-Za-z]{2}$/;
const APPLE_SLUG = /^[A-Za-z0-9._~%-]{1,120}$/;
const APPLE_ID = /^(?:\d{5,15}|pl\.[A-Za-z0-9-]{8,60})$/;
const APPLE_SONG_ID = /^\d{5,15}$/;
const APPLE_KINDS = new Set<string>(["album", "playlist", "song"]);

const TWITCH_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv"]);
const TWITCH_CLIPS_HOST = "clips.twitch.tv";
const TWITCH_CHANNEL = /^[A-Za-z0-9_]{3,25}$/;
const TWITCH_VIDEO = /^\d{6,12}$/;
const TWITCH_CLIP = /^[A-Za-z0-9_-]{8,100}$/;
/** First path segments that are Twitch pages, not channels. */
const TWITCH_RESERVED = new Set([
  "videos",
  "directory",
  "settings",
  "downloads",
  "jobs",
  "turbo",
  "subscriptions",
  "wallet",
  "friends",
  "inventory",
  "drops",
  "search",
  "store",
  "login",
  "signup",
  "popout",
  "embed",
  "moderator",
  "dashboard",
  "broadcast",
  "team",
  "prime",
  "bits",
  "legal",
  "help",
  "support",
  "privacy",
  "security",
  "user",
  "clips",
  "event",
  "events",
  "collections",
  "following",
  "followers",
  "partners",
  "products",
  "p",
  "u",
]);

/** Hosts of short links the parser does not follow (a server fetch of a stranger's URL is not an option). */
const SHORT_LINK_HOSTS = new Set([
  "vm.tiktok.com",
  "vt.tiktok.com",
  "on.soundcloud.com",
  "spotify.link",
  "instagr.am",
  "www.instagr.am",
]);

function youtube(id: string | null | undefined): ParsedEmbed | null {
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return {
    provider: "youtube",
    kind: "video",
    id,
    src: `https://www.youtube-nocookie.com/embed/${id}`,
  };
}

function vimeo(host: string, segments: string[], url: URL): ParsedEmbed | null {
  let id: string | undefined;
  let hash: string | null = null;
  if (host === "player.vimeo.com") {
    if (segments.length !== 2 || segments[0] !== "video") return null;
    id = segments[1];
  } else if (VIMEO_HOSTS.has(host)) {
    if (segments.length < 1 || segments.length > 2) return null;
    id = segments[0];
    hash = segments[1] ?? null;
  } else {
    return null;
  }
  if (!id || !VIMEO_ID.test(id)) return null;
  // An unlisted video's hash is the second path segment or the player's `?h=`; anything else there is not a video.
  if (hash === null) hash = url.searchParams.get("h");
  if (hash !== null && !VIMEO_HASH.test(hash)) return null;
  return {
    provider: "vimeo",
    kind: "video",
    id,
    src: `https://player.vimeo.com/video/${id}?dnt=1${hash === null ? "" : `&h=${hash}`}`,
  };
}

function tiktok(segments: string[]): ParsedEmbed | null {
  let id: string | undefined;
  if (segments.length === 3 && segments[1] === "video" && TIKTOK_USER.test(segments[0]!)) {
    id = segments[2];
  } else if (segments.length === 3 && segments[0] === "embed" && segments[1] === "v2") {
    id = segments[2];
  }
  if (!id || !TIKTOK_ID.test(id)) return null;
  return {
    provider: "tiktok",
    kind: "video",
    id,
    src: `https://www.tiktok.com/embed/v2/${id}`,
  };
}

function instagram(segments: string[]): ParsedEmbed | null {
  let path: string | undefined;
  let code: string | undefined;
  if (segments.length === 2) {
    [path, code] = segments;
  } else if (segments.length === 3 && INSTAGRAM_USER.test(segments[0]!)) {
    if (INSTAGRAM_RESERVED.has(segments[0]!.toLowerCase())) return null;
    [, path, code] = segments;
  } else {
    return null;
  }
  const kind = path ? INSTAGRAM_PATH[path] : undefined;
  if (!kind || !code || !INSTAGRAM_CODE.test(code)) return null;
  return {
    provider: "instagram",
    kind,
    id: code,
    src: `https://www.instagram.com/${path}/${code}/embed`,
  };
}

function soundcloud(segments: string[]): ParsedEmbed | null {
  if (segments.length < 1 || segments.length > 3) return null;
  if (!segments.every((segment) => SOUNDCLOUD_SLUG.test(segment))) return null;
  const [user, second, third] = segments as [string, string | undefined, string | undefined];
  if (SOUNDCLOUD_RESERVED.has(user.toLowerCase())) return null;
  let kind: "track" | "playlist" | "artist";
  let path: string;
  if (second === undefined) {
    kind = "artist";
    path = user;
  } else if (second === "sets") {
    if (third === undefined) return null;
    kind = "playlist";
    path = `${user}/sets/${third}`;
  } else {
    if (third !== undefined || SOUNDCLOUD_PROFILE_PAGES.has(second.toLowerCase())) return null;
    kind = "track";
    path = `${user}/${second}`;
  }
  return {
    provider: "soundcloud",
    kind,
    id: path,
    src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${path}`)}&auto_play=false`,
  };
}

/** A percent-escape that would smuggle a path separator or a control character into a rebuilt path. */
const UNSAFE_ESCAPE = /%(?:2f|5c|00|0a|0d)/i;

function appleMusic(segments: string[], url: URL): ParsedEmbed | null {
  if (segments.length !== 4) return null;
  const [storefront, kind, slug, id] = segments as [string, string, string, string];
  if (!APPLE_STOREFRONT.test(storefront) || !APPLE_KINDS.has(kind)) return null;
  if (!APPLE_SLUG.test(slug) || UNSAFE_ESCAPE.test(slug) || /^\.+$/.test(slug)) return null;
  // A `%` must start a two-digit escape: no stray percent signs in the rebuilt path.
  if (/%(?![0-9A-Fa-f]{2})/.test(slug)) return null;
  if (!APPLE_ID.test(id)) return null;
  const country = storefront.toLowerCase();
  // `?i={songId}` on an album link points at one song of that album.
  const songId = url.searchParams.get("i");
  if (songId !== null) {
    if (kind !== "album" || !APPLE_SONG_ID.test(songId)) return null;
    return {
      provider: "applemusic",
      kind: "song",
      id: songId,
      src: `https://embed.music.apple.com/${country}/song/${slug}/${songId}`,
    };
  }
  return {
    provider: "applemusic",
    kind: kind as "album" | "playlist" | "song",
    id,
    src: `https://embed.music.apple.com/${country}/${kind}/${slug}/${id}`,
  };
}

function twitch(host: string, segments: string[]): ParsedEmbed | null {
  if (host === TWITCH_CLIPS_HOST) {
    const [slug] = segments;
    if (segments.length !== 1 || !slug || !TWITCH_CLIP.test(slug)) return null;
    return {
      provider: "twitch",
      kind: "clip",
      id: slug,
      src: `https://clips.twitch.tv/embed?clip=${slug}`,
    };
  }
  if (!TWITCH_HOSTS.has(host)) return null;
  const [first, second, third] = segments;
  if (!first) return null;
  if (first.toLowerCase() === "videos") {
    if (segments.length !== 2 || !second || !TWITCH_VIDEO.test(second)) return null;
    return {
      provider: "twitch",
      kind: "video",
      id: second,
      src: `https://player.twitch.tv/?video=v${second}`,
    };
  }
  if (!TWITCH_CHANNEL.test(first) || TWITCH_RESERVED.has(first.toLowerCase())) return null;
  if (segments.length === 1) {
    return {
      provider: "twitch",
      kind: "channel",
      id: first,
      src: `https://player.twitch.tv/?channel=${first}`,
    };
  }
  if (segments.length === 3 && second === "clip" && third && TWITCH_CLIP.test(third)) {
    return {
      provider: "twitch",
      kind: "clip",
      id: third,
      src: `https://clips.twitch.tv/embed?clip=${third}`,
    };
  }
  return null;
}

function parts(input: string): { url: URL; host: string; segments: string[] } | null {
  if (!isHttpUrl(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.port !== "") return null;
  return {
    url,
    host: url.hostname.toLowerCase(),
    segments: url.pathname.split("/").filter((segment) => segment !== ""),
  };
}

/**
 * Parses an embeddable URL: YouTube (`youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`,
 * `youtube.com/embed/`), Spotify (`open.spotify.com/{track|album|playlist|episode|show|artist}/`),
 * Vimeo, TikTok, Instagram, SoundCloud, Apple Music and Twitch (the exact forms are in M6-26).
 * The host must be exactly one of the allowlisted hosts (no subdomain or suffix tricks, no
 * credentials, no custom port), and `src` is built from the parsed parts only, so the input never
 * reaches an iframe. Returns null for everything else, including channels, profiles, short links
 * (they are never followed) and other providers.
 */
export function parseEmbed(input: string): ParsedEmbed | null {
  const found = parts(input);
  if (!found) return null;
  const { url, host, segments } = found;

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

  if (host === "player.vimeo.com" || VIMEO_HOSTS.has(host)) return vimeo(host, segments, url);
  if (TIKTOK_HOSTS.has(host)) return tiktok(segments);
  if (INSTAGRAM_HOSTS.has(host)) return instagram(segments);
  if (SOUNDCLOUD_HOSTS.has(host)) return soundcloud(segments);
  if (host === APPLE_HOST) return appleMusic(segments, url);
  if (host === TWITCH_CLIPS_HOST || TWITCH_HOSTS.has(host)) return twitch(host, segments);

  return null;
}

/**
 * Whether `input` is a link from a short-link host the parser does not follow (`vm.tiktok.com`,
 * `vt.tiktok.com`, `tiktok.com/t/…`, `on.soundcloud.com`, `spotify.link`, `instagr.am`). The embed
 * field says so instead of the general message, because the fix is different: open the link, copy
 * the full address.
 */
export function isEmbedShortLink(input: string): boolean {
  const found = parts(input);
  if (!found) return false;
  if (SHORT_LINK_HOSTS.has(found.host)) return true;
  return TIKTOK_HOSTS.has(found.host) && found.segments[0] === "t" && found.segments.length >= 2;
}

/** The message for an embed link that does not parse: the short-link sentence, or the general one. */
export function embedErrorMessage(input: string): string {
  return isEmbedShortLink(input.trim()) ? EMBED_SHORT_LINK_MESSAGE : EMBED_ERROR_MESSAGE;
}

/**
 * What the embed form says it recognized under the URL field: "YouTube video", "Spotify track",
 * "Vimeo video", "TikTok video", "Instagram post", "Instagram reel", "SoundCloud track",
 * "SoundCloud playlist", "SoundCloud artist", "Apple Music album", "Apple Music song",
 * "Apple Music playlist", "Twitch channel", "Twitch video", "Twitch clip".
 */
export function embedLabel(embed: Pick<ParsedEmbed, "provider" | "kind">): string {
  switch (embed.provider) {
    case "youtube":
      return "YouTube video";
    case "vimeo":
      return "Vimeo video";
    case "tiktok":
      return "TikTok video";
    case "instagram":
      // An older IGTV link is a video: Instagram shows it as a reel now.
      return embed.kind === "post" ? "Instagram post" : "Instagram reel";
    default:
      return `${EMBED_PROVIDER_NAMES[embed.provider]} ${embed.kind}`;
  }
}

/**
 * The height of each player once it is playing, in one table (M6-27, M8-05). `"16:9"` is an aspect
 * ratio (the player fills the column width); a number is pixels. Spotify's two heights (152 for a
 * single track or episode, 352 for the rest) are listed like every other provider's, so one table
 * serves the renderer's facade, the editor's and the tenant script's player. Keys are `provider` or
 * `provider:kind` (see `embedHeight`).
 */
export const EMBED_HEIGHTS = {
  youtube: "16:9",
  vimeo: "16:9",
  twitch: "16:9",
  "spotify:track": 152,
  "spotify:episode": 152,
  "spotify:album": 352,
  "spotify:playlist": 352,
  "spotify:show": 352,
  "spotify:artist": 352,
  tiktok: 740,
  "instagram:post": 560,
  "instagram:reel": 640,
  "instagram:tv": 640,
  "soundcloud:track": 166,
  "soundcloud:playlist": 352,
  "soundcloud:artist": 352,
  "applemusic:song": 175,
  "applemusic:album": 450,
  "applemusic:playlist": 450,
} as const satisfies Record<string, "16:9" | number>;

/** The playing height of an embed: `"16:9"` or pixels. Anything unknown: 16:9. */
export function embedHeight(embed: Pick<ParsedEmbed, "provider" | "kind">): "16:9" | number {
  const table: Record<string, "16:9" | number> = EMBED_HEIGHTS;
  return table[`${embed.provider}:${embed.kind}`] ?? table[embed.provider] ?? "16:9";
}

/** Whether a tapped player's height is a fixed pixel height and not the 16:9 box. */
export function hasFixedHeight(embed: Pick<ParsedEmbed, "provider" | "kind">): boolean {
  return typeof embedHeight(embed) === "number";
}

/** Height of the facade bar for the tall players (TikTok, Instagram): the page grows after a tap. */
export const EMBED_BAR_HEIGHT = 120;

/**
 * The facade's height before a tap: the 16:9 box for the video players, the player's own height
 * for SoundCloud and Apple Music (tapping shifts nothing), a short bar for TikTok and Instagram
 * (their players are tall, so the page grows after a tap: a shift the visitor asked for).
 */
export function embedFacadeHeight(embed: Pick<ParsedEmbed, "provider" | "kind">): "16:9" | number {
  if (embed.provider === "tiktok" || embed.provider === "instagram") return EMBED_BAR_HEIGHT;
  return embedHeight(embed);
}

/** Twitch only plays inside a site it knows: the hostname the visitor is on, nothing else. */
export const TWITCH_PARENT_PATTERN = /^[a-z0-9.-]{1,253}$/;

/**
 * The iframe `src` once the visitor taps Play: the parsed `src` plus the provider's autoplay flag
 * (`autoplay=1` Vimeo, `auto_play=true` SoundCloud, `autoplay=true` Twitch; TikTok, Instagram and
 * Apple Music add nothing) and, for Twitch, `parent={hostname}`. Returns null for Twitch when
 * `parent` is not a plain hostname: no iframe is mounted then. `parent` only ever comes from
 * `window.location.hostname`, never from the document.
 */
export function embedPlayerSrc(
  embed: Pick<ParsedEmbed, "provider" | "src">,
  parent?: string,
): string | null {
  switch (embed.provider) {
    case "youtube":
      return `${embed.src}?autoplay=1`;
    case "vimeo":
      return `${embed.src}&autoplay=1`;
    case "soundcloud": {
      const url = new URL(embed.src);
      url.searchParams.set("auto_play", "true");
      return url.toString();
    }
    case "twitch":
      if (parent === undefined || !TWITCH_PARENT_PATTERN.test(parent)) return null;
      return `${embed.src}&autoplay=true&parent=${parent}`;
    default:
      return embed.src;
  }
}

/** The `allow` list of a provider's player iframe. */
export function embedAllow(provider: EmbedProvider): string {
  switch (provider) {
    case "youtube":
      return "autoplay; encrypted-media; picture-in-picture";
    case "vimeo":
      return "autoplay; fullscreen; picture-in-picture; encrypted-media";
    case "twitch":
      return "autoplay; fullscreen";
    case "tiktok":
      return "encrypted-media";
    case "instagram":
      return "encrypted-media";
    case "soundcloud":
      return "autoplay";
    case "applemusic":
      return "autoplay; encrypted-media; fullscreen; clipboard-write";
    default:
      return "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  }
}

/** Whether the provider's player has a full-screen button (`allowfullscreen`). */
export function embedAllowsFullscreen(provider: EmbedProvider): boolean {
  return (
    provider === "youtube" ||
    provider === "vimeo" ||
    provider === "twitch" ||
    provider === "applemusic"
  );
}

/**
 * The accessible name of the facade's Play button: "Play video: {caption}" (Vimeo, TikTok, a Twitch
 * video or clip, YouTube), "Watch stream: {caption}" (a Twitch channel), "Show post: {caption}"
 * (Instagram), "Play music: {caption}" (SoundCloud, Apple Music); without the colon and caption when
 * the caption is empty.
 */
export function embedPlayLabel(
  embed: Pick<ParsedEmbed, "provider" | "kind">,
  caption: string,
): string {
  let verb: string;
  switch (embed.provider) {
    case "twitch":
      verb = embed.kind === "channel" ? "Watch stream" : "Play video";
      break;
    case "instagram":
      verb = "Show post";
      break;
    case "soundcloud":
    case "applemusic":
    case "spotify":
      verb = "Play music";
      break;
    default:
      verb = "Play video";
  }
  const text = caption.trim();
  return text === "" ? verb : `${verb}: ${text}`;
}

/** The title of a playing iframe: "{caption} ({Provider} player)", or "{Provider} player". YouTube keeps its older wording. */
export function embedPlayerTitle(provider: EmbedProvider, caption: string): string {
  const text = caption.trim();
  if (provider === "youtube") return text === "" ? "YouTube video" : `${text} (YouTube video)`;
  const name = EMBED_PROVIDER_NAMES[provider];
  return text === "" ? `${name} player` : `${text} (${name} player)`;
}
