import { describe, expect, it } from "vitest";
import { draftDocSchema, parseEmbed, publishDocSchema } from "@/lib/document";
import { blocks, draftWith } from "./fixtures/page-document";

const YT = "jNQXAC9IVRw";
const SP = "37i9dQZF1DXcBWIGoYBM5M";
const ytSrc = `https://www.youtube-nocookie.com/embed/${YT}`;

describe("parseEmbed accepts", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`],
    [`https://youtube.com/watch?v=${YT}`],
    [`https://m.youtube.com/watch?v=${YT}&t=10s`],
    [`https://www.youtube.com/watch?feature=share&v=${YT}`],
    [`http://www.youtube.com/watch?v=${YT}`],
    [`https://youtu.be/${YT}`],
    [`https://youtu.be/${YT}?si=abc&t=3`],
    [`https://youtu.be/${YT}/`],
    [`https://www.youtube.com/shorts/${YT}`],
    [`https://www.youtube.com/embed/${YT}`],
    [`HTTPS://WWW.YOUTUBE.COM/watch?v=${YT}`],
  ])("YouTube %s", (url) => {
    expect(parseEmbed(url)).toEqual({ provider: "youtube", kind: "video", id: YT, src: ytSrc });
  });

  it("YouTube ids may contain - and _", () => {
    const id = "aqz-KE_bpKQ";
    expect(parseEmbed(`https://youtu.be/${id}`)?.src).toBe(
      `https://www.youtube-nocookie.com/embed/${id}`,
    );
  });

  it.each(["track", "album", "playlist", "episode", "show", "artist"])("Spotify %s", (kind) => {
    expect(parseEmbed(`https://open.spotify.com/${kind}/${SP}`)).toEqual({
      provider: "spotify",
      kind,
      id: SP,
      src: `https://open.spotify.com/embed/${kind}/${SP}`,
    });
  });

  it("Spotify links with a locale segment or tracking query", () => {
    const expected = `https://open.spotify.com/embed/track/${SP}`;
    expect(parseEmbed(`https://open.spotify.com/intl-de/track/${SP}?si=abc123`)?.src).toBe(
      expected,
    );
    expect(parseEmbed(`https://open.spotify.com/track/${SP}?si=x#frag`)?.src).toBe(expected);
  });
});

describe("parseEmbed rejects", () => {
  it.each([
    // Vimeo and SoundCloud links parse since M6-26 (tests/unit/m6-embeds-parse.test.ts); the old rows are gone.
    ["a Vimeo channel", "https://vimeo.com/channels/staffpicks"],
    ["a YouTube channel", "https://www.youtube.com/@maraokafor"],
    ["a YouTube channel page", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"],
    ["a YouTube user page", "https://www.youtube.com/user/mara"],
    ["a YouTube playlist", "https://www.youtube.com/playlist?list=PLabcdefghijk"],
    ["the YouTube home page", "https://www.youtube.com/"],
    ["a watch URL without v", "https://www.youtube.com/watch"],
    ["a watch URL with an empty v", "https://www.youtube.com/watch?v="],
    ["a too-short YouTube id", "https://youtu.be/abc"],
    ["a too-long YouTube id", `https://youtu.be/${YT}x`],
    ["a YouTube id with a bad character", "https://youtu.be/jNQXAC9IV.w"],
    [
      "a YouTube id that tries to break the src",
      "https://www.youtube.com/embed/jNQXAC9IVRw%2f..%2fx",
    ],
    ["a suffix host", `https://youtube.com.evil.example/watch?v=${YT}`],
    ["a suffix short host", `https://youtu.be.evil.example/${YT}`],
    ["a prefix host", `https://evilyoutube.com/watch?v=${YT}`],
    ["a subdomain host", `https://evil.www.youtube.com/watch?v=${YT}`],
    ["a URL in the query", `https://evil.example/?u=youtube.com/watch?v=${YT}`],
    ["a URL in the path", `https://evil.example/youtube.com/watch?v=${YT}`],
    ["a URL in the fragment", `https://evil.example/#https://youtu.be/${YT}`],
    ["userinfo on YouTube", `https://user:pw@www.youtube.com/watch?v=${YT}`],
    ["userinfo trick", `https://www.youtube.com@evil.example/watch?v=${YT}`],
    ["a custom port", `https://www.youtube.com:8443/watch?v=${YT}`],
    ["javascript:", "javascript:alert(1)"],
    ["a data: URL", `data:text/html,<iframe src="https://youtu.be/${YT}">`],
    ["mailto:", "mailto:a@b.co"],
    ["a protocol-relative URL", `//www.youtube.com/watch?v=${YT}`],
    ["a bare YouTube address", `www.youtube.com/watch?v=${YT}`],
    ["a YouTube address with a space", `https://www.youtube.com/watch?v=${YT} x`],
    ["the nocookie host itself", `https://www.youtube-nocookie.com/embed/${YT}`],
    ["a Spotify user", "https://open.spotify.com/user/mara"],
    ["an unknown Spotify type", `https://open.spotify.com/podcast/${SP}`],
    ["a Spotify URI", `spotify:track:${SP}`],
    ["a short Spotify id", "https://open.spotify.com/track/abc"],
    ["a Spotify id with a bad character", `https://open.spotify.com/track/${SP.slice(0, 21)}!`],
    ["a Spotify suffix host", `https://open.spotify.com.evil.example/track/${SP}`],
    ["a Spotify subdomain", `https://evil.open.spotify.com/track/${SP}`],
    ["Spotify over a custom port", `https://open.spotify.com:444/track/${SP}`],
    ["the Spotify embed host path", `https://open.spotify.com/embed/track/${SP}`],
    ["a SoundCloud page that is not a sound", "https://soundcloud.com/discover"],
    ["an evil iframe", "https://evil.example/x"],
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("%s", (_name, url) => {
    expect(parseEmbed(url)).toBeNull();
  });

  it("never copies the input into src", () => {
    const parsed = parseEmbed(`https://www.youtube.com/watch?v=${YT}&autoplay=1&list=evil`);
    expect(parsed?.src).toBe(ytSrc);
    expect(parsed?.src).not.toContain("autoplay");
    expect(parseEmbed(`https://open.spotify.com/track/${SP}?utm_source=x`)?.src).toBe(
      `https://open.spotify.com/embed/track/${SP}`,
    );
  });
});

describe("the embed block", () => {
  const embed = (url: string) => draftWith({ ...blocks.embed, url });

  it("a draft keeps any URL, publish needs an embeddable one", () => {
    for (const url of [
      "",
      "https://evil.example/x",
      "https://www.youtube.com/@maraokafor",
      "javascript:alert(1)",
    ]) {
      expect(draftDocSchema.safeParse(embed(url)).success, url).toBe(true);
      expect(publishDocSchema.safeParse(embed(url)).success, url).toBe(false);
    }
    expect(publishDocSchema.safeParse(embed(`https://youtu.be/${YT}`)).success).toBe(true);
    expect(publishDocSchema.safeParse(embed(`https://open.spotify.com/album/${SP}`)).success).toBe(
      true,
    );
  });

  it("an invalid embed URL gets the editor message", () => {
    const issue = publishDocSchema.safeParse(embed("https://evil.example/x")).error?.issues[0];
    expect(issue?.path).toEqual(["blocks", 0, "url"]);
    expect(issue?.message).toBe(
      "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.",
    );
  });
});
