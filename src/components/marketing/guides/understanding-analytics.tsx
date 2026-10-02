import Link from "next/link";
import type { GuideBody } from "./types";

export const understandingAnalytics: GuideBody = {
  toc: [
    ["where", "Where to find them"],
    ["numbers", "The four headline numbers"],
    ["links", "Reading clicks by link"],
    ["sources", "Referrers, devices and countries"],
    ["differences", "Why numbers differ between tools"],
    ["privacy", "How your visitors stay private"],
  ],
  content: (
    <>
      <p>
        Analytics tell you which parts of your page work. You don’t need to check them daily: once
        a week, or after you change something, is plenty.
      </p>

      <h2 id="where">Where to find them</h2>
      <p>
        Open Analytics in the editor (Stats in the bar at the bottom on a phone). Choose a date
        range at the top: the last 30 days on every plan, and 7 days, 90 days or a year on Pro and
        Studio.
      </p>

      <h2 id="numbers">The four headline numbers</h2>
      <ul>
        <li>
          <strong>Views</strong>: how many times your page was opened.
        </li>
        <li>
          <strong>Clicks</strong>: how many times visitors tapped a link, a card or a grid tile.
        </li>
        <li>
          <strong>Click-through rate</strong>: clicks divided by views. If 1,000 people opened your
          page and 250 tapped a link, that link’s rate is 25%.
        </li>
        <li>
          <strong>Unique visitors</strong>: an estimate of how many different people visited each
          day.
        </li>
      </ul>

      <h2 id="links">Reading clicks by link</h2>
      <p>The clicks-by-link table is where the useful decisions are:</p>
      <ul>
        <li>
          <strong>Order matters.</strong> Links near the top usually get more taps. If an
          important link sits low and underperforms, move it up and compare the next weeks.
        </li>
        <li>
          <strong>Words matter.</strong> “Book a class” tells people what happens next; “Classes”
          doesn’t. Try a clearer label before you remove a link.
        </li>
        <li>
          <strong>Change one thing at a time.</strong> If you reorder, relabel and restyle at once,
          you won’t know which change helped.
        </li>
        <li>
          <strong>Retire what nobody taps.</strong> Hide it first; if nobody misses it, delete it.
        </li>
      </ul>

      <h2 id="sources">Referrers, devices and countries</h2>
      <p>On Pro and Studio you also see where visitors came from and what they used:</p>
      <ul>
        <li>
          <strong>Referrers</strong> name the site that sent a visitor, such as{" "}
          <code>instagram.com</code>. “Direct” means the browser didn’t say, which is common for
          links opened from apps, email and messages.
        </li>
        <li>
          <strong>Devices</strong> split visits into mobile, desktop and tablet. If most visitors
          are on phones, design for phones first.
        </li>
        <li>
          <strong>Countries</strong> come from the network a visitor connects through. Useful for
          timing posts and choosing which shop link to show first.
        </li>
      </ul>

      <h2 id="differences">Why numbers differ between tools</h2>
      <ul>
        <li>
          A social app counts taps on your bio link; HYDLNK counts visits that reach your page.
          Someone who taps and closes the page before it loads counts in one and not the other.
        </li>
        <li>
          Views are counted by a small beacon, which some browser blockers stop. Clicks are counted
          on our side, so clicks are the more complete number.
        </li>
        <li>
          Known bots and crawlers are filtered out, so link previews and search engines don’t
          inflate your views.
        </li>
        <li>
          Unique visitors are estimated per day without cookies, so they’re approximate.
        </li>
      </ul>

      <h2 id="privacy">How your visitors stay private</h2>
      <p>
        HYDLNK sets no cookies on your page and loads no tracking scripts. Visitor IP addresses
        are never stored: unique visitors come from a one-way hash of the IP address and browser,
        mixed with a value that changes every day. Individual events are kept for 90 days and then
        rolled up into daily totals. The details are in the{" "}
        <Link href="/privacy">privacy policy</Link>.
      </p>
    </>
  ),
};
