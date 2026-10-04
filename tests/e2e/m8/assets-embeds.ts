/**
 * The embeds the M8 asset specs publish on their fixture pages: one of each provider and of each kind
 * that has a height of its own. Plain data, shared by the Playwright specs and the renderer script.
 */

export const FIXTURE_PAGE_ID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

/** One embed of each provider (and the kinds with their own height), with a caption. */
export const EMBEDS = [
  {
    name: "YouTube",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    host: "youtube-nocookie.com",
    height: null,
  },
  {
    name: "Spotify track",
    url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    host: "open.spotify.com",
    height: 152,
  },
  {
    name: "Spotify album",
    url: "https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC",
    host: "open.spotify.com",
    height: 352,
  },
  { name: "Vimeo", url: "https://vimeo.com/76979871", host: "player.vimeo.com", height: null },
  {
    name: "TikTok",
    url: "https://www.tiktok.com/@mara/video/7234567890123456789",
    host: "www.tiktok.com",
    height: 740,
  },
  {
    name: "Instagram post",
    url: "https://www.instagram.com/p/CxYz12AbCde/",
    host: "www.instagram.com",
    height: 560,
  },
  {
    name: "Instagram reel",
    url: "https://www.instagram.com/reel/CxYz12AbCde/",
    host: "www.instagram.com",
    height: 640,
  },
  {
    name: "SoundCloud track",
    url: "https://soundcloud.com/mara/night-market",
    host: "w.soundcloud.com",
    height: 166,
  },
  {
    name: "SoundCloud playlist",
    url: "https://soundcloud.com/mara/sets/field-recordings",
    host: "w.soundcloud.com",
    height: 352,
  },
  {
    name: "Apple Music song",
    url: "https://music.apple.com/us/album/the-album/1440857781?i=1440857790",
    host: "embed.music.apple.com",
    height: 175,
  },
  {
    name: "Apple Music album",
    url: "https://music.apple.com/us/album/the-album/1440857781",
    host: "embed.music.apple.com",
    height: 450,
  },
  {
    name: "Twitch channel",
    url: "https://www.twitch.tv/mara_plays",
    host: "player.twitch.tv",
    height: null,
  },
  {
    name: "Twitch clip",
    url: "https://clips.twitch.tv/FamousHappyCaterpillar-AbCd",
    host: "clips.twitch.tv",
    height: null,
  },
] as const;

export type FixtureEmbed = (typeof EMBEDS)[number];
