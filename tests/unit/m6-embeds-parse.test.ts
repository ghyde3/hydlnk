import { describe, expect, it, vi } from "vitest";
import {
  EMBED_ERROR_MESSAGE,
  EMBED_HEIGHTS,
  EMBED_SHORT_LINK_MESSAGE,
  collectPublishErrors,
  draftDocSchema,
  embedAllow,
  embedErrorMessage,
  embedFacadeHeight,
  embedHeight,
  embedLabel,
  embedPlayLabel,
  embedPlayerSrc,
  embedPlayerTitle,
  isEmbedShortLink,
  parseEmbed,
  publishDocSchema,
} from "@/lib/document";
import { TENANT_CONTENT_SECURITY_POLICY } from "@/lib/routing/tenant-headers";
import { blocks, draftWith } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M6-26: six more embed providers. Parsing rebuilds `src` from validated parts only, every
 * rejection in the table returns null, short links are recognized but never followed, and the
 * tenant CSP names exactly the nine frame origins.
 */

const ID = "76979871";
const TT = "7234567890123456789";
const IG = "CxYz12AbCde";
const AM = "1440857781";
const PL = "pl.u-d2b05GGOK1Zm0";

describe("M6-26 parseEmbed accepts", () => {
  it.each([
    [`https://vimeo.com/${ID}`, `https://player.vimeo.com/video/${ID}?dnt=1`],
    [`https://www.vimeo.com/${ID}`, `https://player.vimeo.com/video/${ID}?dnt=1`],
    [`HTTPS://VIMEO.COM/${ID}`, `https://player.vimeo.com/video/${ID}?dnt=1`],
    [
      `https://vimeo.com/${ID}/abcdef1234`,
      `https://player.vimeo.com/video/${ID}?dnt=1&h=abcdef1234`,
    ],
    [`https://vimeo.com/${ID}/ABCDEF12`, `https://player.vimeo.com/video/${ID}?dnt=1&h=ABCDEF12`],
    [
      `https://vimeo.com/${ID}/0123456789abcdef`,
      `https://player.vimeo.com/video/${ID}?dnt=1&h=0123456789abcdef`,
    ],
    [`https://player.vimeo.com/video/${ID}`, `https://player.vimeo.com/video/${ID}?dnt=1`],
    [
      `https://player.vimeo.com/video/${ID}?h=abcdef1234&autoplay=1`,
      `https://player.vimeo.com/video/${ID}?dnt=1&h=abcdef1234`,
    ],
    [`https://vimeo.com/123456`, `https://player.vimeo.com/video/123456?dnt=1`],
    [`https://vimeo.com/123456789012`, `https://player.vimeo.com/video/123456789012?dnt=1`],
    [`https://vimeo.com/${ID}?share=copy#t=10`, `https://player.vimeo.com/video/${ID}?dnt=1`],
  ])("Vimeo %s", (url, src) => {
    const parsed = parseEmbed(url);
    expect(parsed).toMatchObject({ provider: "vimeo", kind: "video", src });
    expect(parsed?.id).toMatch(/^\d{6,12}$/);
  });

  it.each([
    [`https://www.tiktok.com/@mara/video/${TT}`],
    [`https://tiktok.com/@mara/video/${TT}`],
    [`https://m.tiktok.com/@mara.okafor_1/video/${TT}`],
    [`https://www.tiktok.com/@mara/video/${TT}?is_from_webapp=1&sender_device=pc`],
    [`https://www.tiktok.com/embed/v2/${TT}`],
    [`https://tiktok.com/embed/v2/${TT}`],
    [`https://www.tiktok.com/@mara/video/123456789012345`],
    [`https://www.tiktok.com/@mara/video/12345678901234567890`],
  ])("TikTok %s", (url) => {
    const parsed = parseEmbed(url);
    expect(parsed).toMatchObject({ provider: "tiktok", kind: "video" });
    expect(parsed?.src).toBe(`https://www.tiktok.com/embed/v2/${parsed?.id}`);
    expect(parsed?.id).toMatch(/^\d{15,20}$/);
  });

  it.each([
    [`https://www.instagram.com/p/${IG}/`, "post", "p"],
    [`https://instagram.com/p/${IG}`, "post", "p"],
    [`https://www.instagram.com/p/${IG}/?utm_source=ig_web_copy_link&igsh=abc`, "post", "p"],
    [`https://www.instagram.com/reel/${IG}/`, "reel", "reel"],
    [`https://www.instagram.com/tv/${IG}/`, "tv", "tv"],
    [`https://www.instagram.com/mara.okafor/p/${IG}/`, "post", "p"],
    [`https://www.instagram.com/p/AbC-_`, "post", "p"],
    [`https://www.instagram.com/p/${"a".repeat(20)}`, "post", "p"],
  ])("Instagram %s", (url, kind, path) => {
    const parsed = parseEmbed(url);
    expect(parsed).toMatchObject({ provider: "instagram", kind });
    expect(parsed?.src).toBe(`https://www.instagram.com/${path}/${parsed?.id}/embed`);
  });

  it.each([
    [
      "https://soundcloud.com/maraokafor/night-market-mix",
      "artist-less track",
      "track",
      "maraokafor/night-market-mix",
    ],
    [
      "https://www.soundcloud.com/mara_okafor/track-1?si=abc",
      "www and query",
      "track",
      "mara_okafor/track-1",
    ],
    ["https://m.soundcloud.com/mara/track-1", "m. host", "track", "mara/track-1"],
    [
      "https://soundcloud.com/maraokafor/sets/field-recordings",
      "a set",
      "playlist",
      "maraokafor/sets/field-recordings",
    ],
    ["https://soundcloud.com/maraokafor", "an artist", "artist", "maraokafor"],
    ["https://soundcloud.com/maraokafor/", "an artist with a slash", "artist", "maraokafor"],
    [
      `https://soundcloud.com/${"a".repeat(100)}/${"b".repeat(100)}`,
      "slugs of 100",
      "track",
      `${"a".repeat(100)}/${"b".repeat(100)}`,
    ],
  ])("SoundCloud %s (%s)", (url, _name, kind, path) => {
    const parsed = parseEmbed(url);
    expect(parsed).toMatchObject({ provider: "soundcloud", kind, id: path });
    expect(parsed?.src).toBe(
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${path}`)}&auto_play=false`,
    );
  });

  it.each([
    [
      `https://music.apple.com/us/album/the-album/${AM}`,
      "album",
      AM,
      `https://embed.music.apple.com/us/album/the-album/${AM}`,
    ],
    [
      `https://music.apple.com/gb/album/the-album/${AM}?uo=4`,
      "album",
      AM,
      `https://embed.music.apple.com/gb/album/the-album/${AM}`,
    ],
    [
      `https://music.apple.com/US/album/the-album/${AM}`,
      "album",
      AM,
      `https://embed.music.apple.com/us/album/the-album/${AM}`,
    ],
    [
      `https://music.apple.com/us/album/the-album/${AM}?i=1440857790`,
      "song",
      "1440857790",
      "https://embed.music.apple.com/us/song/the-album/1440857790",
    ],
    [
      `https://music.apple.com/us/song/a-song/${AM}`,
      "song",
      AM,
      `https://embed.music.apple.com/us/song/a-song/${AM}`,
    ],
    [
      `https://music.apple.com/us/playlist/todays-hits/${PL}`,
      "playlist",
      PL,
      `https://embed.music.apple.com/us/playlist/todays-hits/${PL}`,
    ],
    [
      `https://music.apple.com/fr/album/l%C3%A9a-bien/${AM}`,
      "album",
      AM,
      `https://embed.music.apple.com/fr/album/l%C3%A9a-bien/${AM}`,
    ],
    [
      `https://music.apple.com/us/album/a.b_c~d-e/12345`,
      "album",
      "12345",
      "https://embed.music.apple.com/us/album/a.b_c~d-e/12345",
    ],
    [
      `https://music.apple.com/us/album/a/123456789012345`,
      "album",
      "123456789012345",
      "https://embed.music.apple.com/us/album/a/123456789012345",
    ],
  ])("Apple Music %s", (url, kind, id, src) => {
    expect(parseEmbed(url)).toEqual({ provider: "applemusic", kind, id, src });
  });

  it.each([
    [
      "https://www.twitch.tv/mara_plays",
      "channel",
      "mara_plays",
      "https://player.twitch.tv/?channel=mara_plays",
    ],
    [
      "https://twitch.tv/Mara_Plays",
      "channel",
      "Mara_Plays",
      "https://player.twitch.tv/?channel=Mara_Plays",
    ],
    ["https://m.twitch.tv/abc", "channel", "abc", "https://player.twitch.tv/?channel=abc"],
    [
      "https://www.twitch.tv/mara_plays?sr=a",
      "channel",
      "mara_plays",
      "https://player.twitch.tv/?channel=mara_plays",
    ],
    [
      "https://www.twitch.tv/videos/123456789",
      "video",
      "123456789",
      "https://player.twitch.tv/?video=v123456789",
    ],
    [
      "https://www.twitch.tv/videos/123456",
      "video",
      "123456",
      "https://player.twitch.tv/?video=v123456",
    ],
    [
      "https://clips.twitch.tv/FamousHappyCaterpillar-AbCd",
      "clip",
      "FamousHappyCaterpillar-AbCd",
      "https://clips.twitch.tv/embed?clip=FamousHappyCaterpillar-AbCd",
    ],
    [
      "https://www.twitch.tv/mara_plays/clip/FamousHappyCaterpillar-AbCd?filter=clips",
      "clip",
      "FamousHappyCaterpillar-AbCd",
      "https://clips.twitch.tv/embed?clip=FamousHappyCaterpillar-AbCd",
    ],
    [
      "https://clips.twitch.tv/abcdefgh",
      "clip",
      "abcdefgh",
      "https://clips.twitch.tv/embed?clip=abcdefgh",
    ],
  ])("Twitch %s", (url, kind, id, src) => {
    expect(parseEmbed(url)).toEqual({ provider: "twitch", kind, id, src });
  });
});

describe("M6-26 id and slug boundaries", () => {
  it.each([
    ["Vimeo id of 5 digits", "https://vimeo.com/12345"],
    ["Vimeo id of 13 digits", "https://vimeo.com/1234567890123"],
    ["Vimeo hash of 7 characters", `https://vimeo.com/${ID}/abcdef1`],
    ["Vimeo hash of 17 characters", `https://vimeo.com/${ID}/0123456789abcdef0`],
    ["Vimeo hash that is not hex", `https://vimeo.com/${ID}/abcdefgh12`],
    ["Vimeo player with a bad ?h=", `https://player.vimeo.com/video/${ID}?h=zzzzzzzzzz`],
    ["Vimeo with a third segment", `https://vimeo.com/${ID}/abcdef1234/extra`],
    ["TikTok id of 14 digits", "https://www.tiktok.com/@mara/video/12345678901234"],
    ["TikTok id of 21 digits", "https://www.tiktok.com/@mara/video/123456789012345678901"],
    ["TikTok user without @", `https://www.tiktok.com/mara/video/${TT}`],
    ["TikTok user with a bad character", `https://www.tiktok.com/@ma%2Fra/video/${TT}`],
    ["Instagram code of 4 characters", "https://www.instagram.com/p/AbCd"],
    ["Instagram code of 21 characters", `https://www.instagram.com/p/${"a".repeat(21)}`],
    ["Instagram code with a bad character", "https://www.instagram.com/p/Ab.Cd1234"],
    ["SoundCloud slug of 101 characters", `https://soundcloud.com/${"a".repeat(101)}/x`],
    ["SoundCloud track slug of 101 characters", `https://soundcloud.com/a/${"b".repeat(101)}`],
    ["Apple Music id of 4 digits", "https://music.apple.com/us/album/a/1234"],
    ["Apple Music id of 16 digits", "https://music.apple.com/us/album/a/1234567890123456"],
    [
      "Apple Music playlist id of 7 characters after pl.",
      "https://music.apple.com/us/playlist/a/pl.abcdefg",
    ],
    [
      "Apple Music slug of 121 characters",
      `https://music.apple.com/us/album/${"a".repeat(121)}/${AM}`,
    ],
    ["Apple Music storefront of 3 letters", `https://music.apple.com/usa/album/a/${AM}`],
    ["Apple Music storefront with a digit", `https://music.apple.com/u1/album/a/${AM}`],
    ["Apple Music ?i= that is not a song id", `https://music.apple.com/us/album/a/${AM}?i=abc`],
    ["Apple Music ?i= on a playlist", `https://music.apple.com/us/playlist/a/${PL}?i=1440857790`],
    ["Twitch channel of 2 characters", "https://www.twitch.tv/ab"],
    ["Twitch channel of 26 characters", `https://www.twitch.tv/${"a".repeat(26)}`],
    ["Twitch channel with a dash", "https://www.twitch.tv/ma-ra"],
    ["Twitch video of 5 digits", "https://www.twitch.tv/videos/12345"],
    ["Twitch video of 13 digits", "https://www.twitch.tv/videos/1234567890123"],
    ["Twitch clip slug of 7 characters", "https://clips.twitch.tv/abcdefg"],
    ["Twitch clip slug of 101 characters", `https://clips.twitch.tv/${"a".repeat(101)}`],
  ])("rejects %s", (_name, url) => {
    expect(parseEmbed(url)).toBeNull();
  });

  it("accepts the limits themselves", () => {
    expect(parseEmbed("https://vimeo.com/123456")).not.toBeNull();
    expect(parseEmbed("https://vimeo.com/123456789012")).not.toBeNull();
    expect(parseEmbed(`https://vimeo.com/${ID}/abcdef12`)).not.toBeNull();
    expect(parseEmbed(`https://vimeo.com/${ID}/0123456789abcdef`)).not.toBeNull();
    expect(parseEmbed("https://www.tiktok.com/@m/video/123456789012345")).not.toBeNull();
    expect(parseEmbed(`https://www.instagram.com/p/${"a".repeat(5)}`)).not.toBeNull();
    expect(parseEmbed(`https://music.apple.com/us/album/${"a".repeat(120)}/${AM}`)).not.toBeNull();
    expect(parseEmbed("https://music.apple.com/us/album/a/12345")).not.toBeNull();
    expect(parseEmbed("https://music.apple.com/us/playlist/a/pl.abcdefgh")).not.toBeNull();
    expect(parseEmbed("https://www.twitch.tv/abc")).not.toBeNull();
    expect(parseEmbed(`https://www.twitch.tv/${"a".repeat(25)}`)).not.toBeNull();
    expect(parseEmbed("https://clips.twitch.tv/abcdefgh")).not.toBeNull();
    expect(parseEmbed(`https://clips.twitch.tv/${"a".repeat(100)}`)).not.toBeNull();
  });
});

describe("M6-26 parseEmbed rejects (the table, all null)", () => {
  it.each([
    // Hosts: compared exactly, in lower case.
    ["a Vimeo suffix host", `https://vimeo.com.evil.example/${ID}`],
    ["a Vimeo prefix host", `https://evilvimeo.com/${ID}`],
    ["a Vimeo player suffix host", `https://player.vimeo.com.evil.example/video/${ID}`],
    ["a Vimeo subdomain", `https://evil.vimeo.com/${ID}`],
    ["a protocol-relative Vimeo URL", `//vimeo.com/${ID}`],
    ["userinfo on Vimeo", `https://user@vimeo.com/${ID}`],
    ["userinfo with a password on Vimeo", `https://user:pw@vimeo.com/${ID}`],
    ["a Vimeo userinfo trick", `https://vimeo.com@evil.example/${ID}`],
    ["a Vimeo custom port", `https://vimeo.com:8443/${ID}`],
    ["a Vimeo channel", "https://vimeo.com/channels/staffpicks"],
    ["a Vimeo user page", "https://vimeo.com/mara"],
    ["a Vimeo player URL without video", `https://player.vimeo.com/${ID}`],
    ["a TikTok suffix host", `https://tiktok.com.evil.example/@mara/video/${TT}`],
    ["a TikTok prefix host", `https://eviltiktok.com/@mara/video/${TT}`],
    ["a TikTok profile", "https://tiktok.com/@mara"],
    ["a TikTok profile with a slash", "https://www.tiktok.com/@mara/"],
    ["a TikTok photo post", `https://www.tiktok.com/@mara/photo/${TT}`],
    ["a TikTok tag page", "https://www.tiktok.com/tag/art"],
    ["an Instagram profile", "https://www.instagram.com/mara/"],
    ["an Instagram story", "https://www.instagram.com/stories/mara/3141592653589793238/"],
    ["an Instagram explore page", "https://www.instagram.com/explore/tags/art/"],
    ["an Instagram suffix host", `https://instagram.com.evil.example/p/${IG}`],
    ["an Instagram prefix host", `https://evilinstagram.com/p/${IG}`],
    ["an Instagram post by a reserved name", `https://www.instagram.com/stories/p/${IG}`],
    ["a SoundCloud discover page", "https://soundcloud.com/discover"],
    ["a SoundCloud stream page", "https://soundcloud.com/stream"],
    ["a SoundCloud upload page", "https://soundcloud.com/upload"],
    ["a SoundCloud pages path", "https://soundcloud.com/pages/contact"],
    ["a SoundCloud you page", "https://soundcloud.com/you/likes"],
    ["a SoundCloud search page", "https://soundcloud.com/search?q=mara"],
    ["a SoundCloud account's likes page", "https://soundcloud.com/mara/likes"],
    ["a SoundCloud account's tracks page", "https://soundcloud.com/mara/tracks"],
    ["a SoundCloud account's sets page", "https://soundcloud.com/mara/sets"],
    ["a SoundCloud private link", "https://soundcloud.com/mara/track/s-AbCdEfGh"],
    ["a SoundCloud suffix host", "https://soundcloud.com.evil.example/mara/track"],
    ["a SoundCloud subdomain", "https://evil.soundcloud.com/mara/track"],
    [
      "the SoundCloud player host itself",
      "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb",
    ],
    ["the SoundCloud home page", "https://soundcloud.com/"],
    ["an Apple Music artist page", "https://music.apple.com/us/artist/mara/123456789"],
    ["an Apple Music browse page", "https://music.apple.com/us/browse"],
    ["an Apple Music station", `https://music.apple.com/us/station/radio/ra.${AM}`],
    ["an Apple Music album without a slug", `https://music.apple.com/us/album/${AM}`],
    ["an Apple Music suffix host", `https://music.apple.com.evil.example/us/album/a/${AM}`],
    ["an Apple Music subdomain", `https://evil.music.apple.com/us/album/a/${AM}`],
    ["the Apple Music embed host", `https://embed.music.apple.com/us/album/a/${AM}`],
    ["an Apple Music slug with an encoded slash", `https://music.apple.com/us/album/a%2Fb/${AM}`],
    [
      "an Apple Music slug with an encoded backslash",
      `https://music.apple.com/us/album/a%5Cb/${AM}`,
    ],
    ["an Apple Music slug with a stray percent", `https://music.apple.com/us/album/a%zz/${AM}`],
    ["an Apple Music id with a tag", `https://music.apple.com/us/album/a/${AM}"><script>`],
    ["a Twitch directory", "https://www.twitch.tv/directory"],
    ["a Twitch directory game", "https://www.twitch.tv/directory/game/Art"],
    ["a Twitch settings page", "https://www.twitch.tv/settings"],
    ["a Twitch videos list", "https://www.twitch.tv/videos"],
    ["a Twitch channel's videos page", "https://www.twitch.tv/mara_plays/videos"],
    ["a Twitch channel's about page", "https://www.twitch.tv/mara_plays/about"],
    ["a Twitch suffix host", "https://twitch.tv.evil.example/mara_plays"],
    ["a Twitch prefix host", "https://eviltwitch.tv/mara_plays"],
    ["a Twitch clip on another host", "https://evil.twitch.tv/abcdefgh"],
    ["the Twitch player host itself", "https://player.twitch.tv/?channel=mara_plays"],
    ["a Twitch clips embed URL", "https://clips.twitch.tv/embed?clip=abcdefgh"],
    // Injection and encoding tricks.
    ["an id with a tag", `https://vimeo.com/${ID}"><script>alert(1)</script>`],
    [
      "a TikTok id that breaks the attribute",
      'https://www.tiktok.com/@mara/video/1"onload="alert(1)',
    ],
    ["an Instagram code with a tag", "https://www.instagram.com/p/<script>alert(1)"],
    ["a percent-encoded slash in a Vimeo id", "https://vimeo.com/123456%2f..%2fx"],
    ["a percent-encoded slash in an Instagram code", "https://www.instagram.com/p/AbCdE%2F12345"],
    ["a percent-encoded slash in a Twitch clip", "https://clips.twitch.tv/abcdefgh%2f.."],
    ["a percent-encoded slash in a SoundCloud slug", "https://soundcloud.com/a%2Fb/track"],
    ["a space in a URL", `https://vimeo.com/${ID} x`],
    // Other schemes.
    ["javascript:", "javascript:alert(1)"],
    ["a data: URL", `data:text/html,<iframe src="https://vimeo.com/${ID}">`],
    ["a blob: URL", `blob:https://vimeo.com/${ID}`],
    ["ftp:", `ftp://vimeo.com/${ID}`],
    ["a bare Vimeo address", `vimeo.com/${ID}`],
    // Short links are not followed.
    ["a vm.tiktok.com short link", "https://vm.tiktok.com/ZMabc123/"],
    ["a vt.tiktok.com short link", "https://vt.tiktok.com/ZSabc123/"],
    ["a tiktok.com/t/ short link", "https://www.tiktok.com/t/ZTabc123/"],
    ["an on.soundcloud.com short link", "https://on.soundcloud.com/abc123"],
    ["a spotify.link short link", "https://spotify.link/abc123"],
    ["an instagr.am short link", `https://instagr.am/p/${IG}`],
  ])("%s", (_name, url) => {
    expect(parseEmbed(url)).toBeNull();
  });

  it("every old M2-19 rejection still rejects", () => {
    for (const url of [
      "https://www.youtube.com/@maraokafor",
      "https://youtube.com.evil.example/watch?v=jNQXAC9IVRw",
      "https://youtu.be.evil.example/jNQXAC9IVRw",
      "https://evil.example/?u=youtube.com/watch?v=jNQXAC9IVRw",
      "https://user:pw@www.youtube.com/watch?v=jNQXAC9IVRw",
      "javascript:alert(1)",
      "https://evil.example/x",
      "",
    ]) {
      expect(parseEmbed(url), url).toBeNull();
    }
  });

  it("YouTube and Spotify parse exactly as before", () => {
    expect(parseEmbed("https://youtu.be/jNQXAC9IVRw")).toEqual({
      provider: "youtube",
      kind: "video",
      id: "jNQXAC9IVRw",
      src: "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw",
    });
    expect(parseEmbed("https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
      provider: "spotify",
      kind: "track",
      id: "37i9dQZF1DXcBWIGoYBM5M",
      src: "https://open.spotify.com/embed/track/37i9dQZF1DXcBWIGoYBM5M",
    });
  });

  it("never copies the input into src: no query, no fragment, no parent", () => {
    const evil = "&parent=evil.example&autoplay=1&x=%22%3E";
    for (const url of [
      `https://vimeo.com/${ID}?foo=1${evil}#frag`,
      `https://www.tiktok.com/@mara/video/${TT}?a=1${evil}`,
      `https://www.instagram.com/p/${IG}/?a=1${evil}`,
      `https://soundcloud.com/mara/track-1?a=1${evil}`,
      `https://music.apple.com/us/album/a/${AM}?a=1${evil}`,
      `https://www.twitch.tv/mara_plays?parent=evil.example${evil}`,
      `https://www.twitch.tv/videos/123456789?parent=evil.example${evil}`,
      `https://clips.twitch.tv/abcdefgh?parent=evil.example${evil}`,
    ]) {
      const parsed = parseEmbed(url);
      expect(parsed, url).not.toBeNull();
      expect(parsed!.src, url).not.toMatch(/evil|foo|frag|%22|autoplay|parent=|a=1/);
    }
  });

  it("the rebuilt src is always an https URL on the provider's own origin", () => {
    const origins = new Set([
      "https://www.youtube-nocookie.com",
      "https://open.spotify.com",
      "https://player.vimeo.com",
      "https://www.tiktok.com",
      "https://www.instagram.com",
      "https://w.soundcloud.com",
      "https://embed.music.apple.com",
      "https://player.twitch.tv",
      "https://clips.twitch.tv",
    ]);
    for (const url of [
      `https://vimeo.com/${ID}`,
      `https://www.tiktok.com/@mara/video/${TT}`,
      `https://www.instagram.com/reel/${IG}`,
      "https://soundcloud.com/mara/track-1",
      `https://music.apple.com/us/album/a/${AM}`,
      "https://www.twitch.tv/mara_plays",
      "https://clips.twitch.tv/abcdefgh",
    ]) {
      expect(origins.has(new URL(parseEmbed(url)!.src).origin), url).toBe(true);
    }
  });
});

describe("M6-26 short links and messages", () => {
  it.each([
    "https://vm.tiktok.com/ZMabc123/",
    "https://vt.tiktok.com/ZSabc123/",
    "https://tiktok.com/t/ZTabc123/",
    "https://www.tiktok.com/t/ZTabc123",
    "https://on.soundcloud.com/abc123",
    "https://spotify.link/abc123",
    "https://instagr.am/p/CxYz12AbCde",
    "http://spotify.link/abc123?si=x",
  ])("%s is a short link", (url) => {
    expect(parseEmbed(url)).toBeNull();
    expect(isEmbedShortLink(url)).toBe(true);
    expect(embedErrorMessage(url)).toBe(EMBED_SHORT_LINK_MESSAGE);
  });

  it.each([
    "https://vimeo.com/76979871",
    "https://www.tiktok.com/@mara",
    "https://www.tiktok.com/t",
    "https://evil.example/x",
    "https://bit.ly/abc",
    "javascript:alert(1)",
    "vm.tiktok.com/abc",
    "",
  ])("%j is not a short link", (url) => {
    expect(isEmbedShortLink(url)).toBe(false);
    expect(embedErrorMessage(url)).toBe(EMBED_ERROR_MESSAGE);
  });

  it("the two sentences are plain text, exactly as specified", () => {
    expect(EMBED_ERROR_MESSAGE).toBe(
      "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.",
    );
    expect(EMBED_SHORT_LINK_MESSAGE).toBe(
      "That’s a short link. Open it in your browser, then copy the full address from the address bar.",
    );
    for (const message of [EMBED_ERROR_MESSAGE, EMBED_SHORT_LINK_MESSAGE]) {
      expect(message).not.toMatch(/please/i);
      expect(message).not.toContain("!");
    }
  });
});

describe("M6-26 the embed block at Publish", () => {
  const embed = (url: string) => draftWith({ ...blocks.embed, url });

  it.each([
    `https://vimeo.com/${ID}`,
    `https://www.tiktok.com/@mara/video/${TT}`,
    `https://www.instagram.com/p/${IG}/`,
    "https://soundcloud.com/mara/track-1",
    `https://music.apple.com/us/album/a/${AM}`,
    "https://www.twitch.tv/mara_plays",
  ])("publishes %s", (url) => {
    expect(publishDocSchema.safeParse(embed(url)).success).toBe(true);
  });

  it.each([
    "https://vimeo.com.evil.example/123456",
    "https://evil.example/x",
    'https://www.tiktok.com/@mara/video/1"onload="alert(1)',
    "javascript:alert(1)",
  ])("a draft keeps %s but Publish refuses it, naming the block", (url) => {
    expect(draftDocSchema.safeParse(embed(url)).success).toBe(true);
    const errors = collectPublishErrors(embed(url));
    expect(errors).toEqual([
      { blockId: blocks.embed.id, field: "url", message: EMBED_ERROR_MESSAGE },
    ]);
  });

  it("Publish names a short link with the short-link sentence", () => {
    expect(collectPublishErrors(embed("https://vm.tiktok.com/ZMabc123/"))).toEqual([
      { blockId: blocks.embed.id, field: "url", message: EMBED_SHORT_LINK_MESSAGE },
    ]);
  });
});

describe("M6-26 the tenant Content Security Policy", () => {
  it("is exactly the nine frame origins plus the unchanged directives", () => {
    expect(TENANT_CONTENT_SECURITY_POLICY).toBe(
      "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; img-src 'self' http://localhost:3000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(TENANT_CONTENT_SECURITY_POLICY).not.toMatch(/script-src|nonce|default-src/);
  });

  it("does not allow the bare origins that are not players", () => {
    const frameSrc = TENANT_CONTENT_SECURITY_POLICY.split(";")[0]!.split(" ").slice(1);
    for (const origin of [
      "https://vimeo.com",
      "https://tiktok.com",
      "https://twitch.tv",
      "https://soundcloud.com",
      "https://music.apple.com",
      "*",
      "https:",
    ]) {
      expect(frameSrc).not.toContain(origin);
    }
    expect(frameSrc).toHaveLength(9);
  });
});

describe("M6-27 helpers", () => {
  it("lists the heights in one table", () => {
    expect(EMBED_HEIGHTS).toMatchObject({
      vimeo: "16:9",
      twitch: "16:9",
      tiktok: 740,
      "instagram:post": 560,
      "instagram:reel": 640,
      "soundcloud:track": 166,
      "soundcloud:playlist": 352,
      "soundcloud:artist": 352,
      "applemusic:song": 175,
      "applemusic:album": 450,
      "applemusic:playlist": 450,
      // M8-05: Spotify's heights live in the same table.
      "spotify:track": 152,
      "spotify:episode": 152,
      "spotify:album": 352,
      "spotify:playlist": 352,
      "spotify:show": 352,
      "spotify:artist": 352,
    });
  });

  it("gives each embed its playing height and its facade height", () => {
    const of = (url: string) => parseEmbed(url)!;
    expect(embedHeight(of(`https://vimeo.com/${ID}`))).toBe("16:9");
    expect(embedHeight(of("https://www.twitch.tv/mara_plays"))).toBe("16:9");
    expect(embedHeight(of(`https://www.tiktok.com/@mara/video/${TT}`))).toBe(740);
    expect(embedHeight(of(`https://www.instagram.com/p/${IG}`))).toBe(560);
    expect(embedHeight(of(`https://www.instagram.com/reel/${IG}`))).toBe(640);
    expect(embedHeight(of("https://soundcloud.com/mara/track-1"))).toBe(166);
    expect(embedHeight(of("https://soundcloud.com/mara/sets/mix"))).toBe(352);
    expect(embedHeight(of("https://soundcloud.com/mara"))).toBe(352);
    expect(embedHeight(of(`https://music.apple.com/us/album/a/${AM}?i=1440857790`))).toBe(175);
    expect(embedHeight(of(`https://music.apple.com/us/album/a/${AM}`))).toBe(450);
    expect(embedHeight(of(`https://music.apple.com/us/playlist/a/${PL}`))).toBe(450);
    expect(embedHeight(of("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"))).toBe(152);
    expect(embedHeight(of("https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC"))).toBe(352);
    expect(embedFacadeHeight(of("https://open.spotify.com/episode/4uLU6hMCjMI75M1A2tKUQC"))).toBe(152);
    // Before a tap: 16:9, the player's own height, or a 120px bar.
    expect(embedFacadeHeight(of(`https://vimeo.com/${ID}`))).toBe("16:9");
    expect(embedFacadeHeight(of("https://soundcloud.com/mara/track-1"))).toBe(166);
    expect(embedFacadeHeight(of(`https://music.apple.com/us/album/a/${AM}`))).toBe(450);
    expect(embedFacadeHeight(of(`https://www.tiktok.com/@mara/video/${TT}`))).toBe(120);
    expect(embedFacadeHeight(of(`https://www.instagram.com/reel/${IG}`))).toBe(120);
  });

  it("names what was recognized", () => {
    const label = (url: string) => embedLabel(parseEmbed(url)!);
    expect(label("https://youtu.be/jNQXAC9IVRw")).toBe("YouTube video");
    expect(label("https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M")).toBe("Spotify album");
    expect(label(`https://vimeo.com/${ID}`)).toBe("Vimeo video");
    expect(label(`https://www.tiktok.com/@mara/video/${TT}`)).toBe("TikTok video");
    expect(label(`https://www.instagram.com/p/${IG}`)).toBe("Instagram post");
    expect(label(`https://www.instagram.com/reel/${IG}`)).toBe("Instagram reel");
    expect(label("https://soundcloud.com/mara/track-1")).toBe("SoundCloud track");
    expect(label("https://soundcloud.com/mara/sets/mix")).toBe("SoundCloud playlist");
    expect(label("https://soundcloud.com/mara")).toBe("SoundCloud artist");
    expect(label(`https://music.apple.com/us/album/a/${AM}`)).toBe("Apple Music album");
    expect(label(`https://music.apple.com/us/album/a/${AM}?i=1440857790`)).toBe("Apple Music song");
    expect(label(`https://music.apple.com/us/playlist/a/${PL}`)).toBe("Apple Music playlist");
    expect(label("https://www.twitch.tv/mara_plays")).toBe("Twitch channel");
    expect(label("https://www.twitch.tv/videos/123456789")).toBe("Twitch video");
    expect(label("https://clips.twitch.tv/abcdefgh")).toBe("Twitch clip");
  });

  it("names the Play button by what it does", () => {
    const play = (url: string, caption: string) => embedPlayLabel(parseEmbed(url)!, caption);
    expect(play(`https://vimeo.com/${ID}`, "Reel")).toBe("Play video: Reel");
    expect(play(`https://www.tiktok.com/@mara/video/${TT}`, "Clip")).toBe("Play video: Clip");
    expect(play("https://www.twitch.tv/mara_plays", "Live")).toBe("Watch stream: Live");
    expect(play("https://www.twitch.tv/videos/123456789", "VOD")).toBe("Play video: VOD");
    expect(play("https://clips.twitch.tv/abcdefgh", "Clip")).toBe("Play video: Clip");
    expect(play(`https://www.instagram.com/p/${IG}`, "Post")).toBe("Show post: Post");
    expect(play("https://soundcloud.com/mara/track-1", "Mix")).toBe("Play music: Mix");
    expect(play(`https://music.apple.com/us/album/a/${AM}`, "Album")).toBe("Play music: Album");
    // No caption: no colon either.
    expect(play(`https://vimeo.com/${ID}`, "")).toBe("Play video");
    expect(play("https://www.twitch.tv/mara_plays", "")).toBe("Watch stream");
    expect(play(`https://www.instagram.com/p/${IG}`, "  ")).toBe("Show post");
    expect(play("https://soundcloud.com/mara/track-1", "")).toBe("Play music");
  });

  it("titles the player '{caption} ({Provider} player)'", () => {
    expect(embedPlayerTitle("vimeo", "Reel")).toBe("Reel (Vimeo player)");
    expect(embedPlayerTitle("applemusic", "Album")).toBe("Album (Apple Music player)");
    expect(embedPlayerTitle("twitch", "")).toBe("Twitch player");
    expect(embedPlayerTitle("youtube", "Behind the lens")).toBe("Behind the lens (YouTube video)");
  });

  it("builds the tapped src from the parsed src and the provider's autoplay flag", () => {
    const of = (url: string) => parseEmbed(url)!;
    expect(embedPlayerSrc(of("https://youtu.be/jNQXAC9IVRw"))).toBe(
      "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?autoplay=1",
    );
    expect(embedPlayerSrc(of(`https://vimeo.com/${ID}`))).toBe(
      `https://player.vimeo.com/video/${ID}?dnt=1&autoplay=1`,
    );
    expect(embedPlayerSrc(of(`https://vimeo.com/${ID}/abcdef1234`))).toBe(
      `https://player.vimeo.com/video/${ID}?dnt=1&h=abcdef1234&autoplay=1`,
    );
    const sc = embedPlayerSrc(of("https://soundcloud.com/mara/track-1"))!;
    expect(new URL(sc).searchParams.get("auto_play")).toBe("true");
    expect(new URL(sc).searchParams.getAll("auto_play")).toHaveLength(1);
    expect(new URL(sc).searchParams.get("url")).toBe("https://soundcloud.com/mara/track-1");
    expect(embedPlayerSrc(of(`https://www.tiktok.com/@mara/video/${TT}`))).toBe(
      `https://www.tiktok.com/embed/v2/${TT}`,
    );
    expect(embedPlayerSrc(of(`https://www.instagram.com/p/${IG}`))).toBe(
      `https://www.instagram.com/p/${IG}/embed`,
    );
    expect(embedPlayerSrc(of(`https://music.apple.com/us/album/a/${AM}`))).toBe(
      `https://embed.music.apple.com/us/album/a/${AM}`,
    );
  });

  it("adds the Twitch parent only from a plain hostname", () => {
    const channel = parseEmbed("https://www.twitch.tv/mara_plays")!;
    expect(embedPlayerSrc(channel, "mara.localhost")).toBe(
      "https://player.twitch.tv/?channel=mara_plays&autoplay=true&parent=mara.localhost",
    );
    const video = parseEmbed("https://www.twitch.tv/videos/123456789")!;
    expect(embedPlayerSrc(video, "links.example.com")).toBe(
      "https://player.twitch.tv/?video=v123456789&autoplay=true&parent=links.example.com",
    );
    const clip = parseEmbed("https://clips.twitch.tv/abcdefgh")!;
    expect(embedPlayerSrc(clip, "a-b.example")).toBe(
      "https://clips.twitch.tv/embed?clip=abcdefgh&autoplay=true&parent=a-b.example",
    );
    for (const bad of [
      undefined,
      "",
      "[::1]",
      "evil.example/x",
      "a b",
      "A.EXAMPLE",
      "x".repeat(254),
      "a&parent=evil.example",
      'a"b',
    ]) {
      expect(embedPlayerSrc(channel, bad), String(bad)).toBeNull();
    }
    expect(embedPlayerSrc(channel, "a".repeat(253))).not.toBeNull();
  });

  it("gives every provider an allow list", () => {
    for (const provider of [
      "youtube",
      "spotify",
      "vimeo",
      "tiktok",
      "instagram",
      "soundcloud",
      "applemusic",
      "twitch",
    ] as const) {
      expect(embedAllow(provider).length).toBeGreaterThan(0);
    }
    expect(embedAllow("youtube")).toBe("autoplay; encrypted-media; picture-in-picture");
  });
});
