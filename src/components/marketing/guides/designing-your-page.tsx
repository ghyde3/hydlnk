import Link from "next/link";
import type { GuideBody } from "./types";

export const designingYourPage: GuideBody = {
  toc: [
    ["theme", "Start from a theme"],
    ["colour", "Colour"],
    ["type", "Type"],
    ["shape", "Shape and buttons"],
    ["space", "Space"],
    ["background", "Backgrounds"],
    ["stand-out", "Make one thing stand out"],
    ["save", "Save it as a theme"],
    ["check", "Check it on a phone"],
  ],
  content: (
    <>
      <p>
        Everything you see on a HYDLNK page is set by a token: 23 of them, in five groups. You
        don’t need to touch all of them. Start from a theme, change three or four, and you’ll have
        a page that looks like yours. The <Link href="/design">design page</Link> lets you try
        this on a demo first.
      </p>

      <h2 id="theme">Start from a theme</h2>
      <p>
        A theme is a complete set of tokens. Apply one of the system themes in the Design tab and
        the whole page changes at once. Applying a theme also clears any tokens you had changed on
        the page, and you can undo it if you change your mind.
      </p>
      <p>
        Like everything else, a new theme only changes your draft. Visitors see it after you press
        Publish.
      </p>

      <h2 id="colour">Colour</h2>
      <p>Eight tokens cover every colour on the page:</p>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Where it shows</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>bg</code></td><td>The page background</td></tr>
          <tr><td><code>surface</code></td><td>Cards and grid tiles</td></tr>
          <tr><td><code>text</code>, <code>textMuted</code></td><td>Main text; bio, captions and subtitles</td></tr>
          <tr><td><code>accent</code></td><td>Avatar ring, card titles, outlines</td></tr>
          <tr><td><code>buttonBg</code>, <code>buttonText</code></td><td>Filled buttons and the text on them</td></tr>
          <tr><td><code>border</code></td><td>Edges of cards, tiles and icons</td></tr>
        </tbody>
      </table>
      <p>
        Keep text readable. Text against its background should have a contrast ratio of at least
        4.5 to 1, and so should button text against its button. Light grey on white and mid-grey
        on black are the usual mistakes. When in doubt, make the text darker (or lighter) than
        feels necessary: your visitors are reading on phones, often outdoors.
      </p>

      <h2 id="type">Type</h2>
      <p>
        Pick a heading font and a body font from the eighteen Google Fonts on offer. Headings are
        your name, your headers and your card titles; body is everything else.
      </p>
      <ul>
        <li>A serif heading over a sans body is the classic pairing: Fraunces with Inter, Instrument Serif with Geist.</li>
        <li>One sans for both is clean and modern: Geist and Geist, Manrope and Manrope.</li>
        <li>Monospaced faces (Space Mono, Geist Mono) suit short headings, not paragraphs.</li>
      </ul>
      <p>
        <code>scale</code> makes all text larger or smaller, <code>weightHeading</code> sets how
        bold headings are, and <code>letterCase</code> can set headings in capitals. Capitals work
        for short headers; avoid them for long names.
      </p>

      <h2 id="shape">Shape and buttons</h2>
      <p>
        <code>radius</code> rounds every corner, from square (0) to soft (32 px), and{" "}
        <code>borderWidth</code> sets how heavy edges are. <code>buttonStyle</code> picks one of
        five button styles:
      </p>
      <ul>
        <li><strong>Fill</strong>: solid buttons. The clearest call to action.</li>
        <li><strong>Outline</strong>: an edge in your accent colour. Calm and editorial.</li>
        <li><strong>Soft</strong>: a light tint of the button colour. Quiet, good on photos.</li>
        <li><strong>Shadow</strong>: a hard offset shadow. Playful.</li>
        <li><strong>Pill</strong>: fully rounded ends, whatever the radius.</li>
      </ul>

      <h2 id="space">Space</h2>
      <p>
        <code>density</code> sets the spacing between blocks: compact, regular or airy.{" "}
        <code>maxWidth</code> sets how wide the column gets on large screens, from 360 to 720 px,
        and <code>align</code> centres the page or aligns it left. Airy spacing and a narrow column
        feel calm; compact suits pages with many links.
      </p>

      <h2 id="background">Backgrounds</h2>
      <p>
        <code>bgType</code> is a solid colour, a gradient or an image. For an image:
      </p>
      <ul>
        <li>Choose a calm photo without much detail where your text will sit.</li>
        <li>Raise <code>overlayOpacity</code> to wash the photo with your background colour until text is easy to read.</li>
        <li>Add some <code>blur</code> (up to 20 px) to soften a busy picture.</li>
      </ul>
      <p>
        Images you upload count toward your plan’s storage: 10 MB on Free, 100 MB on Pro and 1 GB
        on Studio.
      </p>

      <h2 id="stand-out">Make one thing stand out</h2>
      <p>
        A link or a card can override the page’s colours, button style and corner radius. Use it
        for the one action that matters most, such as a filled “Book now” among outlined links.
        Use it sparingly: if everything stands out, nothing does.
      </p>

      <h2 id="save">Save it as a theme</h2>
      <p>
        When you like the result, choose Save as theme. That copies every token into a theme of
        your own, which you can apply to any of your pages. Free accounts keep up to 3 saved
        themes; Pro and Studio keep as many as they like.
      </p>
      <p>
        Editing a saved theme updates the drafts of every page that uses it. Live pages keep their
        published look until you publish them again, so you can review each one first.
      </p>

      <h2 id="check">Check it on a phone</h2>
      <p>
        Most of your visitors arrive from a social app on a phone. Before you publish, look at
        the preview at phone size, or open your published page on your own phone, and check that
        every button is easy to read and easy to tap.
      </p>
    </>
  ),
};
