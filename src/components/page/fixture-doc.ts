import type { PublishDoc } from "@/lib/document";
import { resolveTokens } from "@/lib/theme";

/**
 * The renderer's stress document (M2-05): a 60-character unbroken display name, a bio at its
 * limit, a long link label, long unbroken words in a grid, a 600-character text, eight social
 * icons, a YouTube and a Spotify embed. Built from the default tokens, so this file holds no
 * colors. A plain module (no React, no CSS) so that Playwright specs can publish it to a test page.
 */

export const FIXTURE_PAGE_ID = "00000000-0000-4000-8000-0000000000f1";

const LONG_NAME = "Abcdefghij".repeat(6);
const LONG_BIO =
  "Portrait and studio photographer based in Orlando, shooting worldwide, with a very long bio that keeps going until it reaches its limit.".slice(
    0,
    160,
  );
const LONG_LABEL =
  "A long link label that keeps going so that it has to wrap inside the button now";
const LONG_TEXT = "Line one of the long text.\n".concat("word ".repeat(113)).slice(0, 600);

export function rendererFixtureDoc(): PublishDoc {
  return {
    version: 1,
    profile: { name: LONG_NAME, bio: LONG_BIO, photo: null },
    theme: { ref: null, overrides: {} },
    tokens: resolveTokens(),
    blocks: [
      {
        id: "fx-social-01",
        type: "social",
        visible: true,
        icons: [
          { id: "fx-ic-ig-01", platform: "instagram", url: "https://instagram.com/fixture" },
          { id: "fx-ic-tt-01", platform: "tiktok", url: "https://tiktok.com/@fixture" },
          { id: "fx-ic-yt-01", platform: "youtube", url: "https://youtube.com/@fixture" },
          { id: "fx-ic-x-001", platform: "x", url: "https://x.com/fixture" },
          { id: "fx-ic-fb-01", platform: "facebook", url: "https://facebook.com/fixture" },
          { id: "fx-ic-li-01", platform: "linkedin", url: "https://linkedin.com/in/fixture" },
          { id: "fx-ic-gh-01", platform: "github", url: "https://github.com/fixture" },
          { id: "fx-ic-em-01", platform: "email", address: "hello@fixture.example" },
        ],
      },
      { id: "fx-header-01", type: "header", visible: true, text: "Book a session" },
      {
        id: "fx-link-0001",
        type: "link",
        visible: true,
        label: LONG_LABEL,
        url: "https://fixture.example/long-label",
      },
      {
        id: "fx-link-0002",
        type: "link",
        visible: true,
        label: "Studio rental by the hour",
        url: "https://fixture.example/studio",
        overrides: { buttonStyle: "pill" },
      },
      {
        id: "fx-card-0001",
        type: "card",
        visible: true,
        title: "Night Market",
        caption: "View the gallery",
        url: "https://fixture.example/night-market",
        image: null,
      },
      {
        id: "fx-embed-yt1",
        type: "embed",
        visible: true,
        url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        caption: "Behind the lens, ep. 4",
      },
      {
        id: "fx-embed-sp1",
        type: "embed",
        visible: true,
        url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        caption: "Studio playlist",
      },
      {
        id: "fx-grid-0001",
        type: "grid",
        visible: true,
        cells: [
          {
            id: "fx-cell-0001",
            title: "Supercalifragilisticexpialidocious",
            subtitle: "Thequickbrownfoxjumpsoverthelazydogagainandagain",
            url: "https://fixture.example/prints",
          },
          {
            id: "fx-cell-0002",
            title: "Workshops",
            subtitle: "Small groups",
            url: "https://fixture.example/workshops",
          },
          {
            id: "fx-cell-0003",
            title: "Gift cards",
            subtitle: "",
            url: "https://fixture.example/gifts",
          },
        ],
      },
      { id: "fx-divide-01", type: "divider", visible: true },
      { id: "fx-text-0001", type: "text", visible: true, text: LONG_TEXT },
    ],
  };
}
