import Link from "next/link";
import type { GuideBody } from "./types";

export const gettingStarted: GuideBody = {
  toc: [
    ["sign-up", "Claim your handle and sign in"],
    ["profile", "Add your profile"],
    ["blocks", "Add your blocks"],
    ["look", "Pick a look"],
    ["publish", "Publish"],
    ["share", "Share your link"],
    ["next", "What to do next"],
  ],
  content: (
    <>
      <p>
        A HYDLNK page is a profile at the top and a column of blocks under it, styled by a theme.
        This guide takes you from nothing to a published page. Give yourself about ten minutes.
      </p>

      <h2 id="sign-up">Claim your handle and sign in</h2>
      <p>
        Your handle is the first part of your address: claim <code>fennmoor</code> and your page
        lives at <code>fennmoor.hydlnk.com</code>. Type the handle you want into any “Claim it”
        field on this site. The sign-up page checks it as you type and tells you if it’s taken or
        reserved.
      </p>
      <p>Then sign in one of two ways:</p>
      <ul>
        <li>
          <strong>Email link.</strong> Enter your email address and we send you a sign-in link.
          Open it and you’re in. There’s no password to create.
        </li>
        <li>
          <strong>Google.</strong> Continue with your Google account.
        </li>
      </ul>
      <p>
        Signing in claims the handle for your first page. Not sure what to pick? Read{" "}
        <Link href="/learn/choosing-a-handle">Choosing a handle</Link> first.
      </p>

      <h2 id="profile">Add your profile</h2>
      <p>The profile sits at the top of the page and is the first thing visitors see.</p>
      <ul>
        <li>
          <strong>Photo.</strong> Upload a JPEG, PNG or WebP image. Without one, your initials stand
          in, drawn in your accent color.
        </li>
        <li>
          <strong>Display name.</strong> Up to 60 characters. It’s set in your heading font.
        </li>
        <li>
          <strong>Bio.</strong> Up to 160 characters. Say what you do and what you’d like people to
          tap: “Small-batch stoneware. Spring kiln opening on Saturday.”
        </li>
      </ul>

      <h2 id="blocks">Add your blocks</h2>
      <p>
        Use the Add a block chips to add links, cards, headers, text, images, social icons, video
        and music embeds, grids and dividers. A few habits help:
      </p>
      <ul>
        <li>Start with three to five links. The fewer there are, the easier each one is to find.</li>
        <li>Put the one thing you most want people to do first, and consider a card for it: a picture earns attention.</li>
        <li>Use a header to group related links, such as “Shop” and “Classes”.</li>
        <li>Drag blocks to reorder them, with a mouse, a finger or the keyboard.</li>
        <li>Switch a block off to hide it without deleting it, for things that come and go.</li>
      </ul>
      <p>
        Every change is saved to your draft as you work, and the preview shows exactly what the
        page will look like. On a phone, switch between Blocks and Preview at the top of the
        editor.
      </p>

      <h2 id="look">Pick a look</h2>
      <p>
        Open Design and apply one of the system themes. Then change whatever you like: accent
        color, fonts, button style, corner radius, spacing or background. Change any of them and
        the whole page follows. <Link href="/learn/designing-your-page">Designing your page</Link>{" "}
        covers every option.
      </p>

      <h2 id="publish">Publish</h2>
      <p>
        Nothing you do in the editor reaches your live page until you press Publish. Until then
        the editor shows Unpublished changes, and visitors keep seeing the last version you
        published.
      </p>
      <p>
        Publish checks the page first: every link needs a complete address starting with
        <code>http://</code> or <code>https://</code>, and every visible block needs its content.
        If something is missing, it tells you what and where. Once it’s published, your page is
        live at your handle’s address.
      </p>

      <h2 id="share">Share your link</h2>
      <ul>
        <li>Put it in the bio of your social profiles: that’s what a link in bio is for.</li>
        <li>Add it to your email signature, your newsletter footer and your printed cards.</li>
        <li>When someone shares it, the link shows your page’s own preview image.</li>
      </ul>

      <h2 id="next">What to do next</h2>
      <ul>
        <li>
          Check <Link href="/learn/understanding-analytics">your analytics</Link> after a few days
          to see which links get tapped.
        </li>
        <li>
          Save your design as a theme, so you can reuse it on another page.
        </li>
        <li>
          On Pro, <Link href="/learn/connecting-a-domain">connect your own domain</Link>.
        </li>
      </ul>
    </>
  ),
};
