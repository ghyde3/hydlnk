import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { marketingMetadata } from "@/components/marketing/metadata";
import { POSTAL_ADDRESS, PRIVACY_EMAIL, SUPPORT_EMAIL } from "@/components/marketing/site-map";
import { RAW_EVENT_RETENTION_DAYS } from "@/lib/analytics/retention";

export const metadata: Metadata = marketingMetadata({
  path: "/privacy",
  title: "Privacy policy",
  description:
    "What HYDLNK collects, why, who processes it and for how long: accounts, page content, uploaded images, cookieless visitor analytics, payments and your rights.",
  image: "legal",
});

const TOC = [
  ["summary", "The short version"],
  ["who", "Who we are"],
  ["collect", "What we collect"],
  ["visitors", "Visitors to HYDLNK pages"],
  ["use", "How we use information"],
  ["legal-bases", "Legal bases"],
  ["cookies", "Cookies"],
  ["processors", "Service providers"],
  ["sharing", "When we share information"],
  ["transfers", "Where data is stored"],
  ["retention", "How long we keep data"],
  ["rights", "Your rights"],
  ["children", "Children"],
  ["security", "Security"],
  ["page-owners", "If you run a page"],
  ["changes", "Changes to this policy"],
  ["contact", "Contact"],
] as const;

const mail = (address: string) => <a href={`mailto:${address}`}>{address}</a>;

export default function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      title="Privacy policy"
      toc={TOC}
      intro={
        <p>
          This policy explains what information HYDLNK collects when you use hydlnk.com, the editor
          at app.hydlnk.com and the pages people publish with it, why we collect it and what you
          can do about it.
        </p>
      }
    >
      <h2 id="summary">The short version</h2>
      <ul>
        <li>We collect what we need to run your account and your pages, and nothing for advertising.</li>
        <li>Pages published with HYDLNK set no cookies. Visitor analytics are counted without cookies and without storing IP addresses.</li>
        <li>The only cookies we use are the essential ones that keep you signed in to the editor at app.hydlnk.com.</li>
        <li>We don’t sell personal information, and we don’t share it for advertising.</li>
        <li>Payments go through Stripe. We never see your full card number.</li>
        <li>You can see, correct, export or delete your information. Deleting your account deletes your pages and their analytics.</li>
      </ul>

      <h2 id="who">Who we are</h2>
      <p>
        HYDLNK (“HYDLNK”, “we”, “us”) provides a service for building link-in-bio pages. We
        operate hydlnk.com, app.hydlnk.com, the pages at <code>handle.hydlnk.com</code> addresses
        and the custom domains our customers connect. For the information described here, HYDLNK
        is the controller. You can reach us about privacy at {mail(PRIVACY_EMAIL)}, or by post at
        HYDLNK, {POSTAL_ADDRESS}.
      </p>

      <h2 id="collect">What we collect</h2>
      <h3>When you create an account</h3>
      <ul>
        <li>
          <strong>Your email address</strong>, to sign you in with an emailed link and to send you
          messages about your account.
        </li>
        <li>
          <strong>Your Google account details</strong>, if you choose to sign in with Google:
          your email address and the basic profile information Google shares with us, such as your
          name.
        </li>
        <li>
          <strong>Your handle</strong>, which becomes part of your page’s public address.
        </li>
      </ul>
      <p>We don’t use passwords, so we never store one.</p>

      <h3>When you build and publish pages</h3>
      <ul>
        <li>
          <strong>Page content</strong>: your display name, bio, profile photo, links, text,
          images, embeds and design choices, both the draft you edit and the version you publish.
        </li>
        <li>
          <strong>Uploaded images</strong>, stored in our file storage. Published pages and the
          images on them are public.
        </li>
        <li>
          <strong>Saved themes</strong> and <strong>custom domains</strong> you add. A custom
          domain is shared with our hosting provider so it can serve your page and issue its
          certificate.
        </li>
      </ul>

      <h3>When you pay</h3>
      <p>
        Payments are handled by Stripe. Stripe collects your card details directly; we receive a
        customer reference, your plan and its status, and billing details such as the invoice
        amounts and dates. We never receive or store your full card number.
      </p>

      <h3>When you use the editor</h3>
      <p>
        Like any website, our hosting provider processes technical information when your browser
        talks to our servers, including your IP address, browser type and the pages requested. We
        use it to deliver the service, keep it secure and fix problems.
      </p>

      <h3>When you contact us or report a page</h3>
      <p>
        If you email us, we keep the conversation so we can help you. If you report a page, we
        keep the report, including any contact details you give, so we can review it and follow
        up.
      </p>

      <h2 id="visitors">Visitors to HYDLNK pages</h2>
      <p>
        When someone visits a page published with HYDLNK, we record anonymous statistics so the
        page’s owner can see how it performs. We designed this to work without identifying
        anyone:
      </p>
      <ul>
        <li>
          <strong>No cookies or local storage.</strong> Pages don’t store anything in visitors’
          browsers, so they don’t need a cookie banner for HYDLNK.
        </li>
        <li>
          <strong>No stored IP addresses.</strong> To estimate unique visitors, we combine the
          visitor’s IP address and user agent with a secret value that changes every day and keep
          only a one-way hash of the result. The hash can’t be turned back into an IP address, and
          because the secret changes daily, visits can’t be linked from one day to the next.
        </li>
        <li>
          <strong>What we record for each view or click:</strong> the page and the link that was
          tapped, the time, the referring site, the type of device (mobile, desktop or tablet) and
          the country, which our hosting provider derives from the connection.
        </li>
        <li>
          <strong>Retention.</strong> These individual events are kept for {RAW_EVENT_RETENTION_DAYS} days, then combined
          into daily totals that contain no visitor-level information.
        </li>
        <li>
          <strong>Bots.</strong> Known bots and crawlers are filtered out before anything is
          recorded.
        </li>
      </ul>
      <p>
        Page owners see only these statistics in aggregate. They never see visitor hashes or any
        visitor-level data.
      </p>
      <p>
        Pages can include content from other services. A YouTube video loads from
        youtube-nocookie.com only after a visitor presses play. Vimeo, TikTok, Instagram,
        SoundCloud, Apple Music and Twitch embeds also load only after a visitor taps to play. A
        Spotify player loads from Spotify when it comes into view. Those services handle what they receive under their own privacy
        policies. Where a page’s fonts are served by Google Fonts, the visitor’s browser fetches
        them from Google.
      </p>

      <h2 id="use">How we use information</h2>
      <ul>
        <li>To provide the service: sign you in, save your drafts, publish your pages, serve them on your addresses and show you your analytics.</li>
        <li>To bill paid plans and manage subscriptions.</li>
        <li>To keep HYDLNK safe: preventing fraud, phishing and abuse, checking links against blocklists, limiting excessive requests and enforcing our <Link href="/terms">terms</Link>.</li>
        <li>To support you when you contact us.</li>
        <li>To send service messages, such as sign-in links, receipts and notices about important changes. We don’t send marketing email without your permission.</li>
        <li>To meet legal obligations, such as tax records.</li>
      </ul>
      <p>We don’t sell personal information, use it for advertising or let advertisers track people on HYDLNK pages.</p>

      <h2 id="legal-bases">Legal bases</h2>
      <p>If you’re in the European Economic Area or the UK, we rely on these legal bases:</p>
      <ul>
        <li><strong>Contract</strong>: to provide the account and pages you signed up for, and to bill paid plans.</li>
        <li><strong>Legitimate interests</strong>: to keep the service secure, prevent abuse and give page owners anonymous statistics about their pages. We’ve designed the analytics so they don’t identify visitors.</li>
        <li><strong>Legal obligation</strong>: to keep financial records and respond to lawful requests.</li>
        <li><strong>Consent</strong>: for anything optional we ask you about. You can withdraw consent at any time.</li>
      </ul>

      <h2 id="cookies">Cookies</h2>
      <p>
        hydlnk.com and the pages published with HYDLNK set no cookies. The editor at
        app.hydlnk.com uses only cookies that are essential for it to work:
      </p>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Purpose</th>
            <th>Lasts</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>sb-…-auth-token</code></td>
            <td>Keeps you signed in</td>
            <td>Until you sign out or the session expires</td>
          </tr>
          <tr>
            <td><code>hl-pending-handle</code></td>
            <td>Remembers the handle you’re claiming while you sign in with Google</td>
            <td>15 minutes</td>
          </tr>
          <tr>
            <td><code>hl-page</code></td>
            <td>Remembers which of your pages you were editing</td>
            <td>1 year</td>
          </tr>
        </tbody>
      </table>
      <p>These cookies are set only on app.hydlnk.com, so they’re never sent to published pages.</p>

      <h2 id="processors">Service providers</h2>
      <p>We use these companies to run HYDLNK. They process information on our behalf and only as we instruct.</p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>What they do for us</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Vercel</td><td>Hosting, content delivery and custom-domain certificates</td></tr>
          <tr><td>Supabase</td><td>Sign-in, database and image storage, in the United States</td></tr>
          <tr><td>Stripe</td><td>Payments, subscriptions and the billing portal</td></tr>
          <tr><td>Resend</td><td>Sending sign-in links and other service email</td></tr>
          <tr><td>Google</td><td>Sign-in with Google, if you choose it</td></tr>
        </tbody>
      </table>

      <h2 id="sharing">When we share information</h2>
      <ul>
        <li><strong>With the public</strong>, when you publish: published pages, including your profile, links and images, are visible to anyone.</li>
        <li><strong>With service providers</strong>, as listed above.</li>
        <li><strong>When the law requires it</strong>, for example in response to a valid legal order, or to protect people from harm or fraud.</li>
        <li><strong>In a business transfer</strong>, if HYDLNK is acquired or merged, in which case this policy continues to apply to your information.</li>
        <li><strong>With your permission</strong>, in any other case.</li>
      </ul>

      <h2 id="transfers">Where data is stored</h2>
      <p>
        Your account, page content and images are stored in the United States. Our hosting
        provider serves pages from locations around the world. If you’re outside the United States,
        your information is transferred there; for transfers from the EEA, the UK and Switzerland
        we rely on the safeguards our providers offer, such as the European Commission’s Standard
        Contractual Clauses.
      </p>

      <h2 id="retention">How long we keep data</h2>
      <ul>
        <li><strong>Account information and page content</strong>: until you delete them or your account.</li>
        <li><strong>Individual visitor events</strong>: {RAW_EVENT_RETENTION_DAYS} days, then only daily totals remain, for as long as the page exists.</li>
        <li><strong>Billing records</strong>: as long as tax and accounting law requires.</li>
        <li><strong>Server logs</strong>: kept by our hosting provider for a short period for security and debugging.</li>
        <li><strong>Support emails and reports</strong>: as long as needed to deal with them and any follow-up.</li>
      </ul>
      <p>
        When you delete your account, we delete your pages, themes, domains and analytics, and free
        your handles. Copies in backups are overwritten in the normal backup cycle, within 30 days.
      </p>

      <h2 id="rights">Your rights</h2>
      <p>Depending on where you live, you have the right to:</p>
      <ul>
        <li>access the personal information we hold about you and get a copy of it,</li>
        <li>correct information that’s wrong,</li>
        <li>delete your information,</li>
        <li>receive your information in a portable format,</li>
        <li>object to or restrict some processing, and withdraw consent you gave,</li>
        <li>complain to your data protection authority.</li>
      </ul>
      <p>
        <strong>California residents</strong> have the right to know what personal information we
        collect and how we use it, to delete it, to correct it and not to be discriminated against
        for using these rights. We don’t sell personal information or share it for cross-context
        behavioral advertising.
      </p>
      <p>
        You can change or delete most information yourself in the editor, and delete your account
        in your account settings. For anything else, email {mail(PRIVACY_EMAIL)} or write to us at
        the postal address under Contact. We may need to confirm your identity first, and we reply
        within one month.
      </p>

      <h2 id="children">Children</h2>
      <p>
        HYDLNK isn’t for children. You must be at least 13 to create an account, or 16 if you live
        in the European Economic Area or the UK. If you believe a child has given us personal
        information, contact {mail(PRIVACY_EMAIL)} and we’ll delete it.
      </p>

      <h2 id="security">Security</h2>
      <p>
        Everything is served over https. Access to account data is controlled per user in the
        database itself, sign-in links expire, and only the people who run HYDLNK can reach
        production systems. No system is perfectly secure; if we learn of a breach that affects
        your information, we’ll tell you and the authorities as the law requires.
      </p>

      <h2 id="page-owners">If you run a page</h2>
      <p>
        HYDLNK’s analytics don’t use cookies or identify visitors, so your page doesn’t need a
        cookie banner because of HYDLNK. If you add content from other services, such as embedded
        players, or link to sites that track visitors, it’s up to you to explain that to your
        visitors where the law requires it.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We’ll update this policy when the service or the law changes. The date at the top shows
        the latest version. If a change matters, we’ll tell you by email or in the editor before it
        takes effect.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Privacy questions and requests: {mail(PRIVACY_EMAIL)}, or by post to HYDLNK,{" "}
        {POSTAL_ADDRESS}. Everything else: {mail(SUPPORT_EMAIL)}.
      </p>
    </LegalPage>
  );
}
